import assert from 'node:assert/strict';
import test, { after, beforeEach } from 'node:test';
import { createServer } from 'vite';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url)), key = '__oaAdminEditApiTest';
globalThis[key] = {};
const vite = await createServer({ appType: 'custom', configFile: false, root, server: { middlewareMode: true, hmr: false }, plugins: [{
  name: 'admin-edit-test-dependencies', enforce: 'pre',
  resolveId(source) {
    if (source.endsWith('/_lib/auth')) return '\0admin-auth';
    if (/lib\/knowledge-store$/u.test(source)) return '\0admin-store';
    if (/lib\/knowledge-assets$/u.test(source)) return '\0admin-assets';
    if (/lib\/write-rate-limit$/u.test(source)) return '\0admin-limit';
    if (/^(?:\.\.\/)+db$/u.test(source)) return '\0admin-db';
  },
  load(id) {
    if (id === '\0admin-auth') return `export async function getAuthorizedUser(){ return globalThis.${key}.authorized; }`;
    if (id === '\0admin-db') return `export async function getDb(){ return { $client: {} }; }`;
    if (id === '\0admin-limit') return 'export async function consumeWriteRateLimit(){ return true; }';
    if (id === '\0admin-assets') return `export { referencedKnowledgeAssetPaths } from '/lib/knowledge-assets.ts'; export async function listKnowledgeRevisionAssets(){ return globalThis.${key}.assets; }`;
    if (id === '\0admin-store') return `
      export async function findKnowledgeItem(){ globalThis.${key}.reads++; return globalThis.${key}.existing; }
      export async function knowledgeRevisionHashExists(){ return false; }
      export async function adminUpdateKnowledgeItem(existing,actor,submission,hash,parts){ globalThis.${key}.writes.push({existing,actor,submission,hash,parts}); return {id:existing.id,status:existing.status,visibility:existing.visibility}; }
    `;
  },
}] });
const route = await vite.ssrLoadModule('/app/api/knowledge/[id]/edit/route.ts');
after(() => vite.close());
const id = '11111111-1111-4111-8111-111111111111';
beforeEach(() => { globalThis[key] = {
  authorized: { isAdmin: true, ndaCompleted: true, memberId: 'admin-member', accountUserId: 'admin-account', memberMutationRevision: 'admin-revision', user: {displayName:'管理员',email:'admin@example.com'} },
  existing: { id, status: 'pending', visibility: 'internal', current_revision_id: 'revision-original', active_revision_id: null, mutation_revision: 'item-revision', category: '科研交流', source_label: '原资料', source_url: '' },
  assets: [{assetPath:'assets/one.png'}], reads: 0, writes: [],
}; });
function patch(body = {}, origin = 'https://oa.omindos.cn') {
  return route.PATCH(new Request(`https://oa.omindos.cn/api/knowledge/${id}/edit`, { method: 'PATCH', headers: {origin,'content-type':'application/json'}, body: JSON.stringify({title:'修改后的题目',body:'已人工核对的完整实验室正文。\n![图片说明](assets/one.png)',mutationRevision:'item-revision',...body}) }), { params: Promise.resolve({id}) });
}
test('only authenticated system admins with activated NDA identity can edit uploads', async () => {
  for (const authorized of [null, {...globalThis[key].authorized,isAdmin:false}, {...globalThis[key].authorized,ndaCompleted:false}]) {
    globalThis[key].authorized = authorized;
    const response = await patch(); assert.ok([401,403].includes(response.status));
  }
  assert.equal(globalThis[key].reads, 0); assert.equal(globalThis[key].writes.length, 0);
});
test('admin saves the actual edited text and storage parts with the original review state', async () => {
  const response = await patch(); assert.equal(response.status, 200);
  assert.equal((await response.json()).item.status, 'pending');
  const write = globalThis[key].writes[0]; assert.equal(write.actor.isAdmin, true);
  assert.equal(write.submission.title, '修改后的题目'); assert.ok(write.submission.content.includes('图片说明'));
  assert.equal(write.parts.map(part => part.content).join(''), write.submission.content);
  assert.equal(write.submission.sourceLabel, '原资料');
});
test('stale versions, missing images, foreign origins and status changes are rejected before saving', async () => {
  assert.equal((await patch({mutationRevision:'old-revision'})).status, 409);
  assert.equal((await patch({body:'完整正文以及未上传的图片。\n![说明](assets/missing.png)'})).status, 400);
  assert.equal((await patch({},'https://evil.test')).status, 403);
  assert.equal((await patch({status:'active'})).status, 400);
  assert.equal(globalThis[key].writes.length, 0);
});
