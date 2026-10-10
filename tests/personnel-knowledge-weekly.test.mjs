import test, { after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import { localDocumentAi } from '../aliyun/local-document-ai.mjs';
import { readChatAttachments, validateBinaryAttachment } from '../lib/oa-chat-attachments.mjs';
import { submitKnowledgePackage } from '../lib/knowledge-package.mjs';
import { zip, docxParts } from './helpers/oa-attachment-fixtures.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const key = '__knowledgeWeeklyTest';
globalThis[key] = {};
const vite = await createServer({ appType: 'custom', configFile: false, root, resolve: { alias: { '@': root } },
  server: { middlewareMode: true, hmr: false }, optimizeDeps: { noDiscovery: true }, plugins: [{ name: 'weekly-runtime-boundaries', enforce: 'pre',
    resolveId(source) {
      if (source.endsWith('/_lib/auth')) return '\0weekly-auth';
      if (/^(?:\.\.\/)+db$/.test(source)) return '\0weekly-db';
      if (source.endsWith('knowledge-assets-env')) return '\0weekly-bucket';
      if (source.endsWith('write-rate-limit')) return '\0weekly-rate';
      return null;
    },
    load(id) {
      if (id === '\0weekly-auth') return `export const getAuthorizedUser=async()=>globalThis.${key}.user; export const isProjectOwner=()=>false;`;
      if (id === '\0weekly-db') return `export const getD1Database=async()=>globalThis.${key}.adapter; export const getDb=async()=>({$client:globalThis.${key}.adapter});`;
      if (id === '\0weekly-bucket') return 'export const getKnowledgeAssetsBucket=async()=>null;';
      if (id === '\0weekly-rate') return 'export const consumeWriteRateLimit=async()=>true;';
    },
  }] });
const api = await vite.ssrLoadModule('/app/api/knowledge/[id]/participants/route.ts');
const importer = await vite.ssrLoadModule('/app/api/knowledge/import-chat/route.ts');
const store = await vite.ssrLoadModule('/lib/knowledge-store.ts');
const policy = await vite.ssrLoadModule('/lib/knowledge-policy.ts');
let db;
function authorize(id = 'a') {
  globalThis[key].user = { memberId: id, accountUserId: `email:${id}`, memberMutationRevision: 'v1', ndaCompleted: true,
    user: { email: `${id}@example.com`, displayName: `成员${id}` }, isAdmin: false };
}
function addMember(id) {
  db.prepare('INSERT INTO members(id,full_name,chatgpt_account,account_user_id,mutation_revision,nda_accepted_at,nda_approval_id,nda_agreement_version) VALUES(?,?,?,?,?,?,?,?)')
    .run(id, `成员${id}`, `${id}@example.com`, `email:${id}`, 'v1', 'now', `nda-${id}`, 'nda1');
  db.prepare(`INSERT INTO approvals(id,type,title,project,requester_name,requester_email,created_at,updated_at,status,current_step,owner,payload_json)
    VALUES(?,'保密协议','test','test',?,?,'2026-10-10','2026-10-10','已归档','已归档',?,?)`)
    .run(`nda-${id}`, id, `${id}@example.com`, id, JSON.stringify({ signerAccountUserId: `email:${id}`, agreementVersion: 'nda1' }));
}
beforeEach(() => {
  db?.close(); db = new DatabaseSync(':memory:'); db.exec('PRAGMA foreign_keys=ON');
  for (const name of readdirSync(new URL('../drizzle/', import.meta.url)).filter(n => /^\d{4}.*\.sql$/.test(n)).sort()) db.exec(readFileSync(new URL('../drizzle/' + name, import.meta.url), 'utf8'));
  for (const name of ['oa/0002_ai_workbench.sql', 'oa/0003_ai_workbench_artifacts.sql', 'expense-ledger-20261007.sql', 'personnel-auto-weekly-20261010.sql', 'personnel-knowledge-weekly-20261010.sql']) db.exec(readFileSync(new URL('../migrations/' + name, import.meta.url), 'utf8'));
  for (const id of ['a', 'b', 'c']) addMember(id);
  function prepare(sql, args = []) { return {
    bind(...values) { return prepare(sql, values); },
    execute() { return { success: true, results: db.prepare(sql).all(...args) }; },
    async all() { return this.execute(); }, async first() { return this.execute().results[0] || null; },
    async run() { return { success: true, meta: { changes: db.prepare(sql).run(...args).changes } }; },
  }; }
  globalThis[key] = { adapter: { prepare, async batch(statements) {
    const hook = globalThis[key].beforeBatch; globalThis[key].beforeBatch = null; hook?.();
    db.exec('BEGIN IMMEDIATE'); try { const results = statements.map(s => s.execute()); db.exec('COMMIT'); return results; }
    catch (error) { db.exec('ROLLBACK'); throw error; }
  } } };
  authorize();
});
after(async () => { db?.close(); await vite.close(); delete globalThis[key]; });

const context = id => ({ params: Promise.resolve({ id }) });
function request(id, memberIds = ['b', 'c'], options = {}) {
  const mutationRevision = options.mutationRevision || db.prepare('SELECT mutation_revision FROM knowledge_items WHERE id=?').get(id).mutation_revision;
  return new Request(`https://oa.test/api/knowledge/${id}/participants`, { method: 'POST', headers: { origin: options.origin || 'https://oa.test', 'content-type': 'application/json' },
    body: JSON.stringify({ memberIds, mutationRevision }) });
}
async function create({ title = '第40周周会', category = '周会', content = '本周完成导航接口联调，参会者分别核对自己的工作量。', parts, sourceLabel = '' } = {}) {
  const actor = { memberId: 'a', accountUserId: 'email:a', memberMutationRevision: 'v1', email: 'a@example.com', name: '成员a', isAdmin: false };
  const submission = { title, category, content, summary: '', sourceLabel, sourceUrl: '' };
  return store.createKnowledgeItem(actor, submission, await policy.hashKnowledgeSubmission(submission), crypto.randomUUID(), parts);
}
const entries = () => db.prepare('SELECT * FROM personnel_weekly_entries ORDER BY member_id').all();

test('actual knowledge store automatically creates owner record only after complete multipart text is saved', async () => {
  const text = '导航联调记录。'.repeat(3500) + '完整结尾';
  const parts = policy.splitKnowledgeStorageParts(text).map(p => p.content);
  assert.ok(parts.length > 1);
  const item = await create({ content: text, parts });
  assert.equal(entries().length, 1); assert.equal(entries()[0].source_text, text); assert.equal(entries()[0].content, '');
  const response = await api.POST(request(item.id), context(item.id)); assert.equal(response.status, 200, await response.text());
  assert.equal(entries().length, 3); assert.ok(entries().every(e => e.source_text === text && e.content === '' && !e.confirmed_at));
  assert.equal(db.prepare("SELECT count(*) n FROM expense_events WHERE action='work_auto_create'").get().n, 3);
});
test('ordinary materials and AI archive copies do not generate additional work records', async () => {
  await create({ title: '设备使用说明', category: '设备' }); await create({ sourceLabel: 'OA AI 成果归档 · 周会' }); assert.equal(entries().length, 0);
});
test('weekly category works without title keywords, while meetings never assign all group text as individual work', async () => {
  await create({ title: '10月9日进展', category: '周报' }); assert.match(entries()[0].content, /导航接口/);
  await create({ title: '10月9日讨论', category: '周会' }); assert.equal(entries().filter(e => e.content === '').length, 1);
});
test('delivery is idempotent and later source edits preserve the same source snapshot for all participants', async () => {
  const item = await create(); const original = entries()[0].source_text;
  assert.equal((await api.POST(request(item.id, ['b']), context(item.id))).status, 200);
  db.prepare("UPDATE personnel_weekly_entries SET content='本人确认过的实际贡献',state='submitting',confirmed_at='now' WHERE member_id='b'").run();
  assert.equal((await api.POST(request(item.id, ['b']), context(item.id))).status, 200);
  assert.equal(entries().find(e => e.member_id === 'b').content, '本人确认过的实际贡献');
  assert.equal(entries().find(e => e.member_id === 'b').confirmed_at, 'now');
  const owner = { memberId: 'a', accountUserId: 'email:a', memberMutationRevision: 'v1', email: 'a@example.com', name: '成员a', isAdmin: false };
  const reviewer = { memberId: 'b', accountUserId: 'email:b', memberMutationRevision: 'v1', email: 'b@example.com', name: '成员b', isAdmin: true };
  await store.reviewKnowledgeItem(await store.findKnowledgeItem(item.id, reviewer), reviewer, 'return', '请更新正文');
  const updated = { title: '第40周周会', category: '周会', content: '更新后的正文，不应覆盖已发确认单', summary: '', sourceLabel: '', sourceUrl: '' };
  await store.resubmitKnowledgeItem(await store.findKnowledgeItem(item.id, owner), owner, updated, await policy.hashKnowledgeSubmission(updated));
  assert.equal((await api.POST(request(item.id, ['c'], { mutationRevision: item.mutationRevision }), context(item.id))).status, 409);
  const info = await (await api.GET(new Request('https://oa.test'), context(item.id))).json(); assert.equal(info.sourceChanged, true); assert.equal(info.members.length, 1);
  assert.equal((await api.POST(request(item.id, ['c']), context(item.id))).status, 200);
  assert.equal(entries().length, 3); assert.ok(entries().every(e => e.source_text === original));
});
test('only the source owner may distribute; admin status, cross-origin requests and stale admission cannot bypass it', async () => {
  const item = await create();
  assert.equal((await api.POST(request(item.id, ['b'], { origin: 'https://other.test' }), context(item.id))).status, 403);
  authorize('b'); globalThis[key].user.isAdmin = true;
  assert.equal((await api.GET(new Request('https://oa.test'), context(item.id))).status, 404);
  assert.equal((await api.POST(request(item.id), context(item.id))).status, 404);
  authorize(); db.exec("UPDATE approvals SET status='已退回' WHERE id='nda-a'");
  assert.equal((await api.POST(request(item.id), context(item.id))).status, 404); assert.equal(entries().length, 1);
});
test('one ineligible recipient rejects the complete selected set', async () => {
  const item = await create(); db.exec("UPDATE approvals SET status='已退回' WHERE id='nda-c'");
  assert.equal((await api.POST(request(item.id), context(item.id))).status, 409); assert.equal(entries().length, 1);
});
test('recipient identity or source revision changes between read and transaction prevent delivery', async () => {
  const item = await create();
  globalThis[key].beforeBatch = () => db.exec("UPDATE members SET account_user_id='rebound' WHERE id='c'");
  assert.equal((await api.POST(request(item.id), context(item.id))).status, 409); assert.equal(entries().length, 1);
  db.exec("UPDATE members SET account_user_id='email:c' WHERE id='c'");
  globalThis[key].beforeBatch = () => db.prepare("UPDATE knowledge_items SET mutation_revision='changed' WHERE id=?").run(item.id);
  assert.equal((await api.POST(request(item.id), context(item.id))).status, 409); assert.equal(entries().length, 1);
});
test('revoked knowledge cannot be newly shared', async () => {
  const item = await create();
  const owner = { memberId: 'a', accountUserId: 'email:a', memberMutationRevision: 'v1', email: 'a@example.com', name: '成员a', isAdmin: false };
  const removed = await store.deleteOwnKnowledgeItems([{ id: item.id, mutationRevision: item.mutationRevision }], owner);
  assert.deepEqual(removed.deletedIds, [item.id]);
  assert.equal((await api.POST(request(item.id), context(item.id))).status, 404); assert.equal(entries().length, 1);
});
test('migration freezes prevent participant inserts and leave no partial delivery', async () => {
  const item = await create();
  db.exec("INSERT INTO migration_control(freeze_id,activated_at) VALUES('weekly-test','now')");
  assert.equal((await api.POST(request(item.id), context(item.id))).status, 503); assert.equal(entries().length, 1);
});
test('existing source can be explicitly distributed after upgrade, without automatic historical backfill', async () => {
  db.exec('DROP TRIGGER personnel_auto_knowledge_event'); const item = await create(); assert.equal(entries().length, 0);
  db.exec(readFileSync(new URL('../migrations/personnel-knowledge-weekly-20261010.sql', import.meta.url), 'utf8')); assert.equal(entries().length, 0);
  assert.equal((await api.POST(request(item.id), context(item.id))).status, 200); assert.equal(entries().length, 3);
});
test('over-limit and duplicate recipient lists are rejected without adding work', async () => {
  const item = await create(); assert.equal((await api.POST(request(item.id, ['b', 'b']), context(item.id))).status, 400);
  assert.equal((await api.POST(request(item.id, Array.from({ length: 51 }, (_, i) => `p${i}`)), context(item.id))).status, 400);
  assert.equal(entries().length, 1);
});
test('the 50-member cap also applies across successive deliveries', async () => {
  const item = await create(); const ids = Array.from({ length: 51 }, (_, i) => `p${i}`); ids.forEach(addMember);
  assert.equal((await api.POST(request(item.id, ids.slice(0, 50)), context(item.id))).status, 200);
  assert.equal((await api.POST(request(item.id, [ids[50]]), context(item.id))).status, 409);
  assert.equal(entries().length, 51);
  assert.equal((await api.POST(request(item.id, [ids[0]]), context(item.id))).status, 200); assert.equal(entries().length, 51);
});

async function importBundle(bundle) {
  const pkg = { ...bundle.pkg, category: 'meeting_minutes' };
  return submitKnowledgePackage(pkg, { fetcher: async (url, options) => {
    assert.equal(url, '/api/knowledge/import-chat');
    return importer.POST(new Request(`https://oa.test${url}`, { ...options, headers: { ...options.headers, origin: 'https://oa.test' } }));
  } });
}
const extract = async file => (await localDocumentAi.extractValidatedDocument(await validateBinaryAttachment(file), new Uint8Array(await file.arrayBuffer()))).text;
test('real DOCX extraction → original upload API → owner record → separate participant work records', async () => {
  const text = '成员乙完成控制接口，成员丙完成导航测试，各自核对本周工作。';
  const parts = docxParts.map(([name, body]) => [name, body.replace('测试文档', text)]);
  const bundle = await readChatAttachments([zip(parts, { name: '10月9日讨论.docx' })], { extract });
  assert.ok(bundle.pkg.body.includes(text));
  const receipt = await importBundle(bundle); assert.equal(receipt.received, true); assert.equal(entries().length, 1);
  const repeat = await importBundle(bundle); assert.equal(repeat.item.id, receipt.item.id); assert.equal(entries().length, 1);
  const response = await api.POST(request(receipt.item.id), context(receipt.item.id)); assert.equal(response.status, 200, await response.text());
  assert.deepEqual(entries().map(e => e.member_id), ['a', 'b', 'c']);
  for (const entry of entries()) { assert.ok(entry.source_text.includes(policy.normalizeKnowledgeText(text)), entry.source_text); assert.equal(entry.content, ''); }
});
function textPdf(text) {
  const stream = `BT /F1 12 Tf 40 700 Td (${text}) Tj ET`;
  const objects = ['<< /Type /Catalog /Pages 2 0 R >>', '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>', `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`];
  let pdf = '%PDF-1.4\n'; const offsets = [0];
  objects.forEach((object, i) => { offsets.push(Buffer.byteLength(pdf)); pdf += `${i + 1} 0 obj\n${object}\nendobj\n`; });
  const xref = Buffer.byteLength(pdf); pdf += `xref\n0 6\n0000000000 65535 f \n${offsets.slice(1).map(n => `${String(n).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return new File([pdf], 'meeting.pdf', { type: 'application/pdf' });
}
test('real text PDF extraction preserves material through the same knowledge upload flow', async () => {
  const bundle = await readChatAttachments([textPdf('Weekly meeting: navigation integration completed.')], { extract });
  const receipt = await importBundle(bundle); assert.ok(receipt.item.id); assert.match(entries()[0].source_text, /navigation integration completed/);
});
test('an attachment conversion failure cannot create a knowledge item or a participant record', async () => {
  await assert.rejects(readChatAttachments([new File(['%PDF-1.4\ninvalid\n%%EOF'], 'bad.pdf')], { extract }));
  assert.equal(db.prepare('SELECT count(*) n FROM knowledge_items').get().n, 0); assert.equal(entries().length, 0);
});
