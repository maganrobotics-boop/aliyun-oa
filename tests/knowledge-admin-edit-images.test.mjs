import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test, { after, beforeEach } from 'node:test';
import { drizzle } from 'drizzle-orm/d1';
import { createServer } from 'vite';

const root = fileURLToPath(new URL('..', import.meta.url));
const key = '__oaAdminImageEditRegression';
globalThis[key] = {};
const vite = await createServer({ appType: 'custom', configFile: false, root,
  resolve: { alias: { '@': root } }, server: { middlewareMode: true, hmr: false },
  plugins: [{ name: 'admin-image-edit-isolated-fixture', enforce: 'pre',
    resolveId(source) {
      if (/(^|\/)\_lib\/auth$/.test(source)) return '\0image-edit-auth';
      if (/^(?:\.\.\/)+db$/.test(source)) return '\0image-edit-db';
      if (source.endsWith('knowledge-assets-env')) return '\0image-edit-bucket';
      return null;
    },
    load(id) {
      if (id === '\0image-edit-db') return `export async function getD1Database(){return globalThis.${key}.database;} export async function getDb(){return globalThis.${key}.db;}`;
      if (id === '\0image-edit-auth') return `export async function getAuthorizedUser(){return globalThis.${key}.authorized;}`;
      if (id === '\0image-edit-bucket') return `export async function getKnowledgeAssetsBucket(){return globalThis.${key}.bucket;}`;
      return null;
    },
  }],
});
const { NodeD1Database } = await vite.ssrLoadModule('/aliyun/d1-adapter.ts');
const store = await vite.ssrLoadModule('/lib/knowledge-store.ts');
const policy = await vite.ssrLoadModule('/lib/knowledge-policy.ts');
const assets = await vite.ssrLoadModule('/lib/knowledge-assets.ts');
const route = await vite.ssrLoadModule('/app/api/knowledge/[id]/edit/route.ts');
let directory, database;
after(async () => { database?.sqlite.close(); if (directory) rmSync(directory, { recursive: true, force: true }); delete globalThis[key]; await vite.close(); });
class MemoryBucket {
  objects = new Map();
  onPut = null;
  async put(key, body, options) {
    if (this.objects.has(key)) return null;
    const bytes = new Uint8Array(body).slice();
    this.objects.set(key, { bytes, httpMetadata: options.httpMetadata, customMetadata: options.customMetadata });
    this.onPut?.(key);
    return { key, size: bytes.byteLength };
  }
  async get(key) {
    const object = this.objects.get(key);
    return object ? { ...object, size: object.bytes.byteLength, arrayBuffer: async () => object.bytes.slice().buffer } : null;
  }
  async delete(keys) { for (const key of Array.isArray(keys) ? keys : [keys]) this.objects.delete(key); }
}
const actor = id => ({ memberId: id, accountUserId: 'email:'+id+'@example.com', memberMutationRevision: 'member-r1',
  name: id, email: id+'@example.com', isAdmin: id === 'admin' });
beforeEach(() => {
  database?.sqlite.close(); if (directory) rmSync(directory, { recursive: true, force: true });
  directory = mkdtempSync(join(tmpdir(), 'oa-admin-image-edit-'));
  database = new NodeD1Database(join(directory, 'isolated.sqlite'));
  const sqlite = database.sqlite;
  const migrations = new URL('../drizzle/', import.meta.url);
  for (const name of readdirSync(migrations).filter(name => /^\d{4}_.+\.sql$/.test(name)).sort()) {
    for (const sql of readFileSync(new URL(name, migrations), 'utf8').split('--> statement-breakpoint').filter(part => part.trim())) sqlite.exec(sql);
  }
  sqlite.exec(readFileSync(new URL('./fixtures/aliyun-knowledge-admin-events.sql', import.meta.url), 'utf8'));
  sqlite.exec(readFileSync(new URL('./fixtures/aliyun-knowledge-image-staging.sql', import.meta.url), 'utf8'));
  for (const id of ['owner', 'admin']) sqlite.prepare(`INSERT INTO members
    (id,full_name,chatgpt_account,account_user_id,status,role,permissions_json,mutation_revision,nda_accepted_at,nda_agreement_version)
    VALUES(?,?,?,?, 'active',?,?,'member-r1','2026-09-01','TEST-NDA')`)
    .run(id,id,id+'@example.com','email:'+id+'@example.com',id==='admin'?'project_owner':'member',id==='admin'?'["project_owner"]':'[]');
  const admin = actor('admin');
  globalThis[key] = { database, db: drizzle(database), bucket: new MemoryBucket(),
    authorized: { ...admin, user: { email: admin.email, displayName: admin.name }, ndaCompleted: true } };
});
async function fixture(status = 'active', visibility = 'public', count = 13) {
  const content = '# 仅隔离测试的图文资料\n\n' + Array.from({ length: count }, (_, i) => '!['+'原图 '+i+'](assets/image-'+i+'.png)').join('\n\n');
  const original = { title: '隔离测试原题目', category: '科研交流', sourceLabel: '自动化测试', sourceUrl: '', summary: '本地合成资料', content };
  const item = await store.createKnowledgeItem(actor('owner'), original, await policy.hashKnowledgeSubmission(original));
  for (let i = 0; i < count; i++) await assets.persistKnowledgeAsset(database, globalThis[key].bucket, item.id, item.currentRevisionId,
    { path: 'assets/image-'+i+'.png', mimeType: 'image/png', bytes: new TextEncoder().encode('isolated fixture bytes '+i).buffer });
  if (status === 'active') await store.reviewKnowledgeItem(await store.findKnowledgeItem(item.id, actor('admin'), true),
    actor('admin'), 'approve', '仅测试审核', visibility, visibility === 'public' ? policy.PUBLIC_KNOWLEDGE_CONFIRMATION : undefined);
  return { original, before: await store.findKnowledgeItem(item.id, actor('admin'), true) };
}
async function edit(before, original, title = '隔离测试修改题目') {
  const response = await route.PATCH(new Request('https://oa.omindos.cn/api/knowledge/'+before.id+'/edit',
    { method:'PATCH', headers:{ origin:'https://oa.omindos.cn','content-type':'application/json' },
      body:JSON.stringify({ title, body:original.content.replace('原图 0','修改后的图片说明'), mutationRevision:before.mutation_revision }) }),
    { params:Promise.resolve({ id:before.id }) });
  return { status:response.status, data:await response.json() };
}
test('approved public material with 13 images saves through the real API and SQLite constraints', async () => {
  const { original, before } = await fixture();
  const bucket = globalThis[key].bucket, previousKeys = [...bucket.objects.keys()];
  const result = await edit(before, original);
  assert.equal(result.status,200,JSON.stringify(result.data));
  assert.equal(result.data.received,true);
  const current = await store.findKnowledgeItem(before.id,actor('admin'),true);
  assert.equal(current.status,'active'); assert.equal(current.visibility,'public');
  assert.equal(current.current_revision_id,current.active_revision_id);
  assert.notEqual(current.current_revision_id,before.current_revision_id);
  assert.match(current.content,/修改后的图片说明/);
  const copies = await assets.listKnowledgeRevisionAssets(database,current.current_revision_id);
  assert.equal(copies.length,13);
  assert.ok(copies.every(image=>!previousKeys.includes(image.storageKey)));
  assert.equal(bucket.objects.size,26);
  for (const key of previousKeys) assert.ok(bucket.objects.has(key));
  for (const image of copies) {
    const source = database.sqlite.prepare('SELECT storage_key,sha256 FROM knowledge_revision_assets WHERE revision_id=? AND asset_path=?').get(before.current_revision_id,image.assetPath);
    assert.deepEqual(bucket.objects.get(image.storageKey).bytes,bucket.objects.get(source.storage_key).bytes);
    assert.equal(await assets.knowledgeAssetSha256(bucket.objects.get(image.storageKey).bytes.buffer),source.sha256);
  }
  const detail = await store.getKnowledgeItemDetail(before.id,actor('admin'),true);
  assert.equal(detail.revisions.length,2); assert.equal(detail.events.at(-1).action,'admin_edited');
  assert.equal(detail.revisions[1].content,original.content);
  const chunks = database.sqlite.prepare('SELECT revision_id FROM knowledge_chunks WHERE item_id=? AND is_active=1').all(before.id);
  assert.ok(chunks.length); assert.ok(chunks.every(row=>row.revision_id===current.current_revision_id));
});
test('pending images retain pending status and unique immutable object keys after editing', async () => {
  const { original,before }=await fixture('pending','internal',1);
  const result=await edit(before,original);assert.equal(result.status,200,JSON.stringify(result.data));
  const current=await store.findKnowledgeItem(before.id,actor('admin'),true);
  assert.equal(current.status,'pending');assert.equal(current.active_revision_id,null);
  assert.equal((await assets.listKnowledgeRevisionAssets(database,current.current_revision_id)).length,1);
  assert.equal(database.sqlite.prepare('SELECT COUNT(*) n FROM knowledge_chunks WHERE is_active=1').get().n,0);
});
test('revoking the member snapshot during image copying rolls back and removes only new objects', async () => {
  const { original,before }=await fixture('active','internal',2);
  const bucket=globalThis[key].bucket, keys=[...bucket.objects.keys()];
  bucket.onPut=()=>{bucket.onPut=null;database.sqlite.prepare("UPDATE members SET mutation_revision='revoked' WHERE id='admin'").run();};
  const result=await edit(before,original);assert.equal(result.status,409,JSON.stringify(result.data));
  assert.deepEqual([...bucket.objects.keys()].sort(),keys.sort());
  const row=database.sqlite.prepare('SELECT current_revision_id,active_revision_id FROM knowledge_items WHERE id=?').get(before.id);
  assert.equal(row.current_revision_id,before.current_revision_id);assert.equal(row.active_revision_id,before.active_revision_id);
  assert.equal(database.sqlite.prepare('SELECT COUNT(*) n FROM knowledge_revisions WHERE item_id=?').get(before.id).n,1);
});
test('audit failures roll back text and image metadata without leaking copied objects', async () => {
  const { original,before }=await fixture('active','internal',2);
  const bucket=globalThis[key].bucket, keys=[...bucket.objects.keys()];
  database.sqlite.exec("CREATE TRIGGER fail_admin_image_audit BEFORE INSERT ON knowledge_events WHEN NEW.action='admin_edited' BEGIN SELECT RAISE(ABORT,'test audit unavailable'); END");
  const result=await edit(before,original);assert.equal(result.status,500);
  assert.deepEqual([...bucket.objects.keys()].sort(),keys.sort());
  const current=await store.findKnowledgeItem(before.id,actor('admin'),true);
  assert.equal(current.current_revision_id,before.current_revision_id);assert.equal(current.content,original.content);
});

test('production filesystem bucket preserves images and removes only uncommitted edit copies', async () => {
  const { FileSystemR2Bucket } = await vite.ssrLoadModule('/aliyun/fs-r2.ts');
  const bucket = new FileSystemR2Bucket(join(directory, 'assets'));
  globalThis[key].bucket = bucket;
  const { original, before } = await fixture('active', 'internal', 2);
  const saved = await edit(before, original);
  assert.equal(saved.status, 200, JSON.stringify(saved.data));
  const current = await store.findKnowledgeItem(before.id, actor('admin'), true);
  const previousAssets = await assets.listKnowledgeRevisionAssets(database, before.current_revision_id);
  const currentAssets = await assets.listKnowledgeRevisionAssets(database, current.current_revision_id);
  assert.equal(currentAssets.length, 2);
  for (const image of currentAssets) {
    const source = previousAssets.find(old => old.assetPath === image.assetPath);
    assert.notEqual(image.storageKey, source.storageKey);
    assert.deepEqual(new Uint8Array(await (await bucket.get(image.storageKey)).arrayBuffer()),
      new Uint8Array(await (await bucket.get(source.storageKey)).arrayBuffer()));
  }
  const attempted = [];
  const put = bucket.put.bind(bucket);
  bucket.put = async (key, ...args) => { attempted.push(key); return put(key, ...args); };
  database.sqlite.exec("CREATE TRIGGER fail_fs_image_audit BEFORE INSERT ON knowledge_events WHEN NEW.action='admin_edited' BEGIN SELECT RAISE(ABORT,'test audit unavailable'); END");
  const failed = await edit(current, { ...original, content: current.content }, '再次修改的隔离测试题目');
  assert.equal(failed.status, 500);
  assert.equal(attempted.length, 2);
  for (const key of attempted) assert.equal(await bucket.get(key), null);
  for (const image of [...previousAssets, ...currentAssets]) assert.ok(await bucket.get(image.storageKey));
  assert.equal((await store.findKnowledgeItem(before.id, actor('admin'), true)).current_revision_id, current.current_revision_id);
});
test('an interrupted image copy leaves the approved revision and original objects intact', async () => {
  const { original, before } = await fixture('active', 'internal', 3);
  const bucket = globalThis[key].bucket, keys = [...bucket.objects.keys()], put = bucket.put.bind(bucket);
  let copied = 0;
  bucket.put = async (...args) => {
    const written = await put(...args);
    if (++copied === 2) throw new Error('test lost storage acknowledgement');
    return written;
  };
  const result = await edit(before, original);
  assert.equal(result.status, 500);
  assert.deepEqual([...bucket.objects.keys()].sort(), keys.sort());
  const current = await store.findKnowledgeItem(before.id, actor('admin'), true);
  assert.equal(current.current_revision_id, before.current_revision_id);
  assert.equal(current.content, original.content);
});
