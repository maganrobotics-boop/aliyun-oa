import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { BOT_SQL } from '../lib/wecom-bot-contract.mjs';

// Execute the exported production statement in SQLite, rather than duplicating
// its WHERE clauses in a fixture implementation or inspecting SQL strings.
const python = String.raw`
import json, sqlite3, sys
data = json.load(sys.stdin)
db = sqlite3.connect(':memory:')
db.row_factory = sqlite3.Row
db.executescript('''
CREATE TABLE members (id TEXT PRIMARY KEY,status TEXT,account_user_id TEXT,mutation_revision INTEGER,account_binding_previous_status TEXT,chatgpt_account TEXT);
CREATE TABLE approvals (id TEXT PRIMARY KEY,type TEXT,status TEXT,requester_email TEXT,updated_at TEXT,payload_json TEXT);
CREATE TABLE wecom_bot_links (bot_id TEXT,user_id TEXT,member_id TEXT,account_user_id TEXT,revision TEXT,revoked_at TEXT);
CREATE TABLE knowledge_items (id TEXT PRIMARY KEY,status TEXT,visibility TEXT,active_revision_id TEXT,updated_at TEXT);
CREATE TABLE knowledge_revisions (id TEXT PRIMARY KEY,item_id TEXT,status TEXT,title TEXT,category TEXT,source_label TEXT,source_url TEXT);
CREATE TABLE knowledge_chunks (id TEXT PRIMARY KEY,item_id TEXT,revision_id TEXT,chunk_no INTEGER,is_active INTEGER,section_title TEXT,paragraph_ref TEXT,content TEXT,search_text TEXT);
CREATE TABLE knowledge_revision_assets (id TEXT PRIMARY KEY,item_id TEXT,revision_id TEXT,upload_state TEXT);
''')
for table, rows in data['tables'].items():
    for row in rows:
        names = list(row.keys())
        sql = 'INSERT INTO ' + table + ' (' + ','.join(names) + ') VALUES (' + ','.join('?' for _ in names) + ')'
        db.execute(sql, [row[name] for name in names])
rows = db.execute(data['sql'], (json.dumps(data['ctx']),)).fetchall()
print(json.dumps([dict(row) for row in rows]))
`;

function fixture() {
  return {
    ctx: { botId: 'fixture_bot', userId: 'fixture_wecom_user', memberId: 'member1',
      accountUserId: 'account1', memberRevision: 7, linkRevision: 'link7', isAdmin: 0,
      ndaApprovalId: 'nda1', ndaAcceptedAt: '2026-10-01T00:00:00Z', ndaAgreementVersion: 'nda-v2', terms: ['robot'] },
    tables: {
      members: [{ id: 'member1', status: 'active', account_user_id: 'account1', mutation_revision: 7,
        account_binding_previous_status: null, chatgpt_account: ' Member@Example.Test ' }],
      approvals: [{ id: 'nda1', type: '保密协议', status: '已归档', requester_email: 'member@example.test',
        updated_at: '2026-10-01T00:00:00Z', payload_json: JSON.stringify({ signerAccountUserId: 'account1', agreementVersion: 'nda-v2' }) }],
      wecom_bot_links: [{ bot_id: 'fixture_bot', user_id: 'fixture_wecom_user', member_id: 'member1',
        account_user_id: 'account1', revision: 'link7', revoked_at: null }],
      knowledge_items: [], knowledge_revisions: [], knowledge_chunks: [], knowledge_revision_assets: [],
    },
  };
}

function addItem(f, id, { image = false, visibility = 'internal', search = 'robot navigation',
  uploadState = 'ready', revision = `${id}_rev`, assetRevision = revision, assetItem = id } = {}) {
  f.tables.knowledge_items.push({ id, status: 'active', visibility, active_revision_id: revision, updated_at: '2026-10-01T00:00:00Z' });
  f.tables.knowledge_revisions.push({ id: revision, item_id: id, status: 'active', title: `${id} title`,
    category: 'robotics', source_label: 'fixture', source_url: '' });
  f.tables.knowledge_chunks.push({ id: `${id}_chunk`, item_id: id, revision_id: revision, chunk_no: 0,
    is_active: 1, section_title: 'section', paragraph_ref: 'paragraph1', content: `${id} authorized robot content`, search_text: search });
  if (image) f.tables.knowledge_revision_assets.push({ id: `${id}_asset`, item_id: assetItem, revision_id: assetRevision, upload_state: uploadState });
  return f;
}

function query(f) {
  const result = spawnSync('python3', ['-c', python], {
    input: JSON.stringify({ sql: BOT_SQL.activeKnowledge, ...f }), encoding: 'utf8', maxBuffer: 4 * 1024 * 1024,
  });
  assert.ifError(result.error);
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout);
}
const ids = (rows) => rows.map(({ item_id }) => item_id).sort();
function authorizedFixture({ admin = false } = {}) {
  const f = addItem(fixture(), 'authorized', { image: true });
  f.ctx.imagesOnly = true;
  if (admin) f.ctx.isAdmin = 1;
  return f;
}

test('omitted and false imagesOnly preserve the original text search over image and text-only records', () => {
  for (const imagesOnly of [undefined, false, 0, null]) {
    const f = fixture();
    if (imagesOnly !== undefined) f.ctx.imagesOnly = imagesOnly;
    addItem(f, 'image_internal', { image: true });
    addItem(f, 'text_internal');
    addItem(f, 'text_public', { visibility: 'public' });
    assert.deepEqual(ids(query(f)), ['image_internal', 'text_internal', 'text_public']);
  }
});

test('imagesOnly selects ready assets for the exact current item and revision', () => {
  const f = fixture();
  f.ctx.imagesOnly = true;
  addItem(f, 'ready_internal', { image: true });
  addItem(f, 'ready_public', { image: true, visibility: 'public' });
  addItem(f, 'text_only');
  for (const uploadState of ['staged', 'pending', 'failed', 'deleted', null]) {
    addItem(f, `wrong_state_${uploadState}`, { image: true, uploadState });
  }
  addItem(f, 'wrong_item', { image: true, assetItem: 'another_item' });
  addItem(f, 'wrong_revision', { image: true, assetRevision: 'another_revision' });
  addItem(f, 'private', { image: true, visibility: 'private' });
  assert.deepEqual(ids(query(f)), ['ready_internal', 'ready_public']);
});

test('the image predicate applies before LIMIT 256 so high-score text-only results cannot crowd out a matching image', () => {
  const f = fixture();
  f.ctx.terms = ['robot', 'long_keyword'];
  for (let index = 0; index < 300; index += 1) {
    addItem(f, `text_${String(index).padStart(3, '0')}`, { search: 'robot long_keyword' });
  }
  addItem(f, 'lower_score_image', { image: true, search: 'robot' });
  const ordinary = query(f);
  assert.equal(ordinary.length, 256);
  assert.equal(ordinary.some(({ item_id }) => item_id === 'lower_score_image'), false);
  f.ctx.imagesOnly = true;
  assert.deepEqual(ids(query(f)), ['lower_score_image']);
});

test('image availability cannot bypass inactive chunks, items, revisions, visibility or the current-revision requirement', () => {
  const mutations = [
    ['inactive chunk', (f) => { f.tables.knowledge_chunks[0].is_active = 0; }],
    ['inactive item', (f) => { f.tables.knowledge_items[0].status = 'archived'; }],
    ['inactive revision', (f) => { f.tables.knowledge_revisions[0].status = 'superseded'; }],
    ['private item', (f) => { f.tables.knowledge_items[0].visibility = 'private'; }],
    ['unknown visibility', (f) => { f.tables.knowledge_items[0].visibility = 'restricted'; }],
    ['old chunk revision', (f) => { f.tables.knowledge_items[0].active_revision_id = 'newer_revision'; }],
    ['wrong revision owner', (f) => { f.tables.knowledge_revisions[0].item_id = 'other_item'; }],
    ['no matching terms', (f) => { f.tables.knowledge_chunks[0].search_text = 'unrelated'; }],
  ];
  for (const [label, mutate] of mutations) {
    const f = authorizedFixture();
    mutate(f);
    assert.deepEqual(query(f), [], label);
  }
  assert.deepEqual(ids(query(authorizedFixture())), ['authorized']);
});

test('a ready image on an old revision does not make its newer active text revision image-searchable', () => {
  const f = authorizedFixture();
  const old = f.tables.knowledge_revisions[0];
  old.status = 'superseded';
  f.tables.knowledge_items[0].active_revision_id = 'authorized_rev2';
  f.tables.knowledge_revisions.push({ ...old, id: 'authorized_rev2', status: 'active' });
  f.tables.knowledge_chunks.push({ ...f.tables.knowledge_chunks[0], id: 'authorized_chunk2', revision_id: 'authorized_rev2' });
  assert.deepEqual(query(f), []);
  f.ctx.imagesOnly = false;
  assert.equal(query(f)[0].revision_id, 'authorized_rev2');
});

test('live member guard rejects account, revision, binding and status changes for both members and administrators', () => {
  const mutations = [
    ['missing member', (f) => { f.tables.members = []; }],
    ['member ID changed', (f) => { f.tables.members[0].id = 'other_member'; }],
    ['account changed', (f) => { f.tables.members[0].account_user_id = 'other_account'; }],
    ['mutation revision changed', (f) => { f.tables.members[0].mutation_revision = 8; }],
    ['binding in progress', (f) => { f.tables.members[0].account_binding_previous_status = 'active'; }],
    ['inactive member', (f) => { f.tables.members[0].status = 'inactive'; }],
    ['removed member', (f) => { f.tables.members[0].status = 'removed'; }],
    ['context account changed', (f) => { f.ctx.accountUserId = 'other_account'; }],
    ['context member revision changed', (f) => { f.ctx.memberRevision = 6; }],
  ];
  for (const admin of [false, true]) {
    assert.deepEqual(ids(query(authorizedFixture({ admin }))), ['authorized']);
    for (const [label, mutate] of mutations) {
      const f = authorizedFixture({ admin });
      mutate(f);
      assert.deepEqual(query(f), [], `${admin ? 'admin' : 'member'}: ${label}`);
    }
  }
});

test('NDA guard checks archived agreement type, requester, accepted timestamp, signer and version', () => {
  const mutations = [
    ['missing NDA', (f) => { f.tables.approvals = []; }],
    ['different NDA ID', (f) => { f.tables.approvals[0].id = 'other_nda'; }],
    ['wrong approval type', (f) => { f.tables.approvals[0].type = '技术审核'; }],
    ['unarchived NDA', (f) => { f.tables.approvals[0].status = '已通过'; }],
    ['rejected NDA', (f) => { f.tables.approvals[0].status = '已退回'; }],
    ['requester mismatch', (f) => { f.tables.approvals[0].requester_email = 'other@example.test'; }],
    ['accepted time changed', (f) => { f.tables.approvals[0].updated_at = '2026-10-01T01:00:00Z'; }],
    ['context accepted time changed', (f) => { f.ctx.ndaAcceptedAt = 'old_acceptance'; }],
    ['context approval ID changed', (f) => { f.ctx.ndaApprovalId = 'missing'; }],
    ['context agreement version changed', (f) => { f.ctx.ndaAgreementVersion = 'nda-v1'; }],
    ['signer mismatch', (f) => { f.tables.approvals[0].payload_json = JSON.stringify({ signerAccountUserId: 'other', agreementVersion: 'nda-v2' }); }],
    ['version mismatch', (f) => { f.tables.approvals[0].payload_json = JSON.stringify({ signerAccountUserId: 'account1', agreementVersion: 'nda-v1' }); }],
    ['missing signer', (f) => { f.tables.approvals[0].payload_json = JSON.stringify({ agreementVersion: 'nda-v2' }); }],
    ['missing version', (f) => { f.tables.approvals[0].payload_json = JSON.stringify({ signerAccountUserId: 'account1' }); }],
    ['invalid NDA JSON', (f) => { f.tables.approvals[0].payload_json = '{invalid'; }],
    ['null NDA JSON', (f) => { f.tables.approvals[0].payload_json = null; }],
  ];
  for (const [label, mutate] of mutations) {
    const f = authorizedFixture();
    mutate(f);
    assert.deepEqual(query(f), [], label);
  }
  const normalized = authorizedFixture();
  normalized.tables.approvals[0].requester_email = '  MEMBER@EXAMPLE.TEST  ';
  assert.deepEqual(ids(query(normalized)), ['authorized']);
});

test('administrator bypasses NDA only and still needs an active matching member and live link', () => {
  const f = authorizedFixture({ admin: true });
  f.tables.approvals = [];
  f.ctx.ndaApprovalId = null;
  f.ctx.ndaAcceptedAt = null;
  f.ctx.ndaAgreementVersion = null;
  assert.deepEqual(ids(query(f)), ['authorized']);
  f.tables.wecom_bot_links[0].revoked_at = '2026-10-01T01:00:00Z';
  assert.deepEqual(query(f), []);
  const member = authorizedFixture({ admin: true });
  member.tables.approvals = [];
  member.tables.members[0].status = 'inactive';
  assert.deepEqual(query(member), []);
});

test('live link guard rejects revocation and every bot, user, member, account or revision mismatch', () => {
  const mutations = [
    ['missing link', (f) => { f.tables.wecom_bot_links = []; }],
    ['link revoked', (f) => { f.tables.wecom_bot_links[0].revoked_at = '2026-10-01T01:00:00Z'; }],
    ['link bot changed', (f) => { f.tables.wecom_bot_links[0].bot_id = 'other_bot'; }],
    ['link user changed', (f) => { f.tables.wecom_bot_links[0].user_id = 'other_user'; }],
    ['link member changed', (f) => { f.tables.wecom_bot_links[0].member_id = 'other_member'; }],
    ['link account changed', (f) => { f.tables.wecom_bot_links[0].account_user_id = 'other_account'; }],
    ['link revision changed', (f) => { f.tables.wecom_bot_links[0].revision = 'link8'; }],
    ['context bot changed', (f) => { f.ctx.botId = 'other_bot'; }],
    ['context user changed', (f) => { f.ctx.userId = 'other_user'; }],
    ['context member changed', (f) => { f.ctx.memberId = 'other_member'; }],
    ['context link revision changed', (f) => { f.ctx.linkRevision = 'old_link'; }],
  ];
  for (const admin of [false, true]) {
    for (const [label, mutate] of mutations) {
      const f = authorizedFixture({ admin });
      mutate(f);
      assert.deepEqual(query(f), [], `${admin ? 'admin' : 'member'}: ${label}`);
    }
  }
});
