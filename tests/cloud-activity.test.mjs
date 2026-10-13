import assert from 'node:assert/strict';
import test, { beforeEach, after } from 'node:test';
import { register } from 'node:module';
register(new URL('./helpers/cloud-activity-loader.mjs', import.meta.url));
globalThis.__cloudTest = {};
const { GET } = await import('../app/api/admin/future-stars/route.ts');
const originalFetch = globalThis.fetch;
let calls;
const actor = { isAdmin: true, ndaCompleted: true, memberId: 'admin', accountUserId: 'account', memberMutationRevision: 'rev', user: { email: 'admin@example.invalid' } };
const data = { source: 'cloud', trackingStartedAt: 1, summary: { onlineCounts: {} }, records: [], pagination: {} };
const request = (query='view=cloud') => GET(new Request('https://oa.omindos.cn/api/admin/future-stars?' + query));
beforeEach(() => {
  calls = [];
  globalThis.__cloudTest = { actor, env: { CLOUD_ACTIVITY_TOKEN: 'a'.repeat(64) } };
  globalThis.fetch = async (...args) => { calls.push(args); return Response.json(data); };
});
after(() => { globalThis.fetch = originalFetch; delete globalThis.__cloudTest; });
test('anonymous, non-admin and incomplete membership cannot fetch Cloud records', async () => {
  for (const [user, status] of [[null, 401], [{ ...actor, isAdmin: false }, 403], [{ ...actor, ndaCompleted: false }, 403]]) {
    globalThis.__cloudTest.actor = user;
    assert.equal((await request()).status, status);
  }
  assert.equal(calls.length, 0);
});
test('authorized read forwards only fixed Cloud URL and private server token', async () => {
  const result = await request('view=cloud&window=3d&kind=account&q=alice&sort=visits&page=2');
  assert.equal(result.status, 200);
  assert.deepEqual(await result.json(), data);
  assert.match(result.headers.get('cache-control'), /private, no-store/);
  const [url, options] = calls[0];
  assert.equal(new URL(url).origin, 'https://cloud.omindos.cn');
  assert.equal(new URL(url).searchParams.get('window'), '3d');
  assert.equal(options.headers.authorization, 'Bearer ' + 'a'.repeat(64));
  assert.equal(options.redirect, 'error');
  assert.equal(options.credentials, 'omit');
});
test('duplicate and unsupported filters never reach the upstream', async () => {
  for (const suffix of ['&view=cloud', '&window=all', '&window=24h&window=7d', '&page=0', '&sort=best', '&q=' + 'x'.repeat(101), '&url=https://wrong.invalid']) {
    assert.equal((await request('view=cloud' + suffix)).status, 400);
  }
  assert.equal(calls.length, 0);
});
test('missing key, failed upstream and oversized responses are errors rather than zero counts', async () => {
  globalThis.__cloudTest.env = {};
  assert.equal((await request()).status, 503);
  assert.equal(calls.length, 0);
  globalThis.__cloudTest.env.CLOUD_ACTIVITY_TOKEN = 'a'.repeat(64);
  for (const value of [new Response('bad', { status: 502 }), Response.json({ source: 'arena' }), Response.json({ pad: 'x'.repeat(140000) })]) {
    globalThis.fetch = async () => value;
    const response = await request();
    assert.equal(response.status, 503);
    assert.equal((await response.json()).summary, undefined);
  }
});
