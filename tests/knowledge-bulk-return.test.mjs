import assert from 'node:assert/strict';
import test from 'node:test';
import { DEFAULT_KNOWLEDGE_RETURN_NOTE, returnKnowledgeBatch } from '../lib/knowledge-bulk-return.mjs';

const item = id => ({ id, title: `资料 ${id}`, status: 'pending', mutationRevision: `version-${id}`, canReview: true, canReturn: true });
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
function harness(list, patch = entry => json({ item: { ...entry, status: 'returned' } }), detail = entry => json({ item: entry })) {
  const calls = [];
  const waits = [];
  const request = async (url, options) => {
    const entry = list.find(value => url.endsWith(`/${value.id}`));
    calls.push({ url, ...options });
    return options.method === 'PATCH' ? patch(entry, options) : detail(entry, options);
  };
  return { calls, waits, options: { request, wait: async ms => { waits.push(ms); } } };
}

test('returns selected pending items with a shared default note and exact versions, without publication fields', async () => {
  const list = [item('a'), item('b')];
  const h = harness(list);
  const result = await returnKnowledgeBatch(list, '  ', h.options);
  assert.deepEqual(result, { succeededIds: ['a', 'b'], failures: [], unprocessed: 0 });
  const writes = h.calls.filter(call => call.method === 'PATCH');
  assert.equal(writes.length, 2);
  for (const [index, call] of writes.entries()) {
    assert.deepEqual(JSON.parse(call.body), { action: 'return', mutationRevision: list[index].mutationRevision, note: DEFAULT_KNOWLEDGE_RETURN_NOTE });
    assert.equal(call.credentials, 'same-origin');
  }
  assert.deepEqual(h.waits, [3200]);
});

test('supports all 83 selected records and preserves a custom return reason', async () => {
  const list = Array.from({ length: 83 }, (_, index) => item(String(index)));
  const h = harness(list);
  const result = await returnKnowledgeBatch(list, '  请补充实验数据  ', h.options);
  assert.equal(result.succeededIds.length, 83);
  assert.equal(h.waits.length, 82);
  assert.equal(JSON.parse(h.calls[1].body).note, '请补充实验数据');
});

test('never writes an updated record and continues other eligible selections', async () => {
  const list = [item('a'), item('b')];
  const h = harness(list, undefined, entry => json({ item: entry.id === 'a' ? { ...entry, mutationRevision: 'new-version' } : entry }));
  const result = await returnKnowledgeBatch(list, '', h.options);
  assert.deepEqual(result.succeededIds, ['b']);
  assert.equal(result.failures[0].id, 'a');
  assert.match(result.failures[0].message, /已更新/);
  assert.equal(h.calls.filter(call => call.method === 'PATCH' && call.url.endsWith('/a')).length, 0);
});

test('checks current return permission and status even if the original selection was eligible', async () => {
  for (const update of [{ canReturn: false }, { canReview: false }, { status: 'active' }, { id: 'another-record' }]) {
    const list = [item('a')];
    const h = harness(list, undefined, entry => json({ item: { ...entry, ...update } }));
    const result = await returnKnowledgeBatch(list, '', h.options);
    assert.equal(result.failures.length, 1);
    assert.equal(h.calls.length, 1);
  }
});

test('stops further work after authentication, permission, or rate-limit errors', async () => {
  for (const status of [401, 403, 429]) {
    const list = [item('a'), item('b')];
    const h = harness(list, () => json({ error: '请稍后重试' }, status));
    const result = await returnKnowledgeBatch(list, '', h.options);
    assert.equal(result.failures[0].uncertain, false);
    assert.equal(result.unprocessed, 1);
    assert.equal(h.calls.length, 2);
  }
});

test('a rejected detail request also stops before any write', async () => {
  const list = [item('a'), item('b')];
  const h = harness(list, undefined, () => json({ error: '权限变化' }, 403));
  const result = await returnKnowledgeBatch(list, '', h.options);
  assert.equal(h.calls.length, 1);
  assert.equal(result.unprocessed, 1);
});

test('does not retry or continue after an uncertain write outcome', async () => {
  for (const patch of [() => { throw new Error('connection lost'); }, () => json({ error: '保存未完成' }, 500), () => json({ item: { id: 'a', status: 'active' } }), () => new Response('invalid json')]) {
    const list = [item('a'), item('b')];
    const h = harness(list, patch);
    const result = await returnKnowledgeBatch(list, '', h.options);
    assert.equal(result.failures[0].uncertain, true);
    assert.equal(result.unprocessed, 1);
    assert.equal(h.calls.length, 2);
    assert.deepEqual(h.waits, []);
  }
});

test('continues after a definitive conflict while preserving failure details', async () => {
  const list = [item('a'), item('b')];
  const h = harness(list, entry => entry.id === 'a' ? json({ error: '版本已更新' }, 409) : json({ item: { ...entry, status: 'returned' } }));
  const result = await returnKnowledgeBatch(list, '', h.options);
  assert.deepEqual(result.succeededIds, ['b']);
  assert.equal(result.failures[0].message, '版本已更新');
  assert.equal(result.failures[0].uncertain, false);
});

test('stop requested during detail loading prevents that record from being written', async () => {
  const list = [item('a'), item('b')];
  let stopped = false;
  const h = harness(list, undefined, entry => { stopped = true; return json({ item: entry }); });
  const result = await returnKnowledgeBatch(list, '', { ...h.options, shouldStop: () => stopped });
  assert.equal(h.calls.length, 1);
  assert.equal(result.unprocessed, 2);
  assert.deepEqual(result.succeededIds, []);
});

test('rejects invalid selections or notes before sending any request', async () => {
  let calls = 0;
  const options = { request: async () => { calls += 1; throw new Error('must not run'); } };
  for (const [list, note] of [[[], ''], [[item('a'), item('a')], ''], [[{ ...item('a'), mutationRevision: '' }], ''], [[{ ...item('a'), canReturn: false }], ''], [[item('a')], '字'], [[item('a')], '字'.repeat(1001)]]) {
    await assert.rejects(returnKnowledgeBatch(list, note, options));
  }
  assert.equal(calls, 0);
});
