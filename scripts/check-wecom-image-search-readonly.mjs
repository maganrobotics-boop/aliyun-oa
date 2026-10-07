import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';
import { stripTypeScriptTypes } from 'node:module';
import { BOT_SQL } from '../lib/wecom-bot-contract.mjs';
import { knowledgeImageReferences } from '../lib/knowledge-image-references.mjs';
import { rankKnowledgeImageChunks, knowledgeImageReferenceScore, relevantKnowledgeImageReferences, requestedKnowledgeImageKinds } from '../lib/knowledge-image-relevance.mjs';
import { prepareWecomKnowledgeImages, transformWecomKnowledgeImage } from '../lib/wecom-bot-knowledge-images.mjs';
import * as scope from '../chat-cloudflare/src/question-scope.mjs';
import sharp from 'sharp';

const fail = error => {
  const allowed = ['NO_CURRENT_CONFIRMED_LINK', 'LINK_NOT_AUTHORIZED', 'EVIDENCE_NOT_AUTHORIZED', 'REAL_ROBOT_PHOTO_NOT_SELECTED', 'PRIVATE_IMAGE_READ_FAILED'];
  console.error('READONLY_CHECK_FAILED', allowed.includes(error?.message) ? error.message : error?.name || 'Error');
  process.exit(1);
};
process.on('uncaughtException', fail);
process.on('unhandledRejection', fail);

const db = new DatabaseSync(process.env.OA_SQLITE_PATH || '/var/lib/originmind-oa/oa.sqlite', { readOnly: true });
const link = db.prepare(`SELECT l.*,m.mutation_revision,m.chatgpt_account,p.member_is_admin,
  p.member_nda_approval_id,p.member_nda_accepted_at,p.member_nda_agreement_version
  FROM wecom_bot_links l JOIN members m ON m.id=l.member_id AND m.account_user_id=l.account_user_id
  JOIN wecom_bot_pairings p ON p.bot_id=l.bot_id AND p.link_revision=l.revision
    AND p.member_id=m.id AND p.member_revision=m.mutation_revision AND p.state='confirmed'
  WHERE l.revoked_at IS NULL AND m.status='active' AND m.account_binding_previous_status IS NULL
  ORDER BY p.updated_at DESC LIMIT 1`).get();
assert.ok(link, 'NO_CURRENT_CONFIRMED_LINK');
const ctx = {
  botId: link.bot_id, userId: link.user_id, memberId: link.member_id, accountUserId: link.account_user_id,
  memberRevision: link.mutation_revision, linkRevision: link.revision, isAdmin: link.member_is_admin,
  email: link.chatgpt_account.trim().toLowerCase(), ndaApprovalId: link.member_nda_approval_id,
  ndaAcceptedAt: link.member_nda_accepted_at, ndaAgreementVersion: link.member_nda_agreement_version,
};
assert.ok(db.prepare(BOT_SQL.currentLink).get(JSON.stringify(ctx)), 'LINK_NOT_AUTHORIZED');

const policy = await import('data:text/javascript;base64,' + Buffer.from(stripTypeScriptTypes(await readFile(new URL('../lib/knowledge-policy.ts', import.meta.url), 'utf8'), { mode: 'strip' })).toString('base64'));
const listAssets = async revisionId => db.prepare(`SELECT id,item_id,revision_id,asset_path,mime_type,byte_size,storage_key,sha256,upload_state
  FROM knowledge_revision_assets WHERE revision_id=? AND upload_state='ready' ORDER BY asset_path`).all(revisionId).map(row => ({
    id: row.id, itemId: row.item_id, revisionId: row.revision_id, assetPath: row.asset_path,
    mimeType: row.mime_type, byteSize: row.byte_size, storageKey: row.storage_key, sha256: row.sha256, uploadState: row.upload_state,
  }));
globalThis.__wecomReadOnlyDeps = {
  getDb: async () => ({ $client: db }), listKnowledgeRevisionAssets: async (_db, revisionId) => listAssets(revisionId),
  knowledgeImageReferences, knowledgeImageReferenceScore, relevantKnowledgeImageReferences, requestedKnowledgeImageKinds,
  checkStreamAbort: () => {}, ...scope,
};
let clientSource = (await readFile(new URL('../lib/oa-chat-client.ts', import.meta.url), 'utf8'))
  .replace(/^import\s[\s\S]*?;\n/gmu, '').replace(/^export\s*\{[^}]*\}\s*from\s*[^;]+;\n/gmu, '');
const deps = 'const {getDb,listKnowledgeRevisionAssets,knowledgeImageReferences,knowledgeImageReferenceScore,relevantKnowledgeImageReferences,requestedKnowledgeImageKinds,checkStreamAbort,questionRequestsKnowledgeImages,questionPrefersGeneralKnowledge,questionAllowsGeneralKnowledge,questionRequiresKnowledgeEvidence}=globalThis.__wecomReadOnlyDeps;\n';
const client = await import('data:text/javascript;base64,' + Buffer.from(deps + stripTypeScriptTypes(clientSource, { mode: 'strip' })).toString('base64'));
delete globalThis.__wecomReadOnlyDeps;

const bucketSourceUrl = new URL(process.env.OA_OSS_BUCKET ? '../aliyun/oss-r2.ts' : '../aliyun/fs-r2.ts', import.meta.url);
let bucketSource = await readFile(bucketSourceUrl, 'utf8');
if (process.env.OA_OSS_BUCKET) bucketSource = bucketSource.replace('from "ali-oss"', `from ${JSON.stringify(import.meta.resolve('ali-oss'))}`);
const bucketModule = await import('data:text/javascript;base64,' + Buffer.from(stripTypeScriptTypes(bucketSource, { mode: 'strip' })).toString('base64'));
const bucket = process.env.OA_OSS_BUCKET ? bucketModule.aliyunOssBucket() : bucketModule.fileSystemBucket(process.env.OA_ASSETS_PATH || '/var/lib/originmind-oa/assets');

for (const question of ['看看四足机器人的图片', '四足机器人图片']) {
  const terms = policy.knowledgeSearchTerms(question);
  const query = imagesOnly => db.prepare(BOT_SQL.activeKnowledge).all(JSON.stringify({ ...ctx, terms, imagesOnly })).map(row => ({
    id: row.id, itemId: row.item_id, revisionId: row.revision_id, title: row.title, category: row.category,
    sourceLabel: row.source_label, sourceUrl: row.source_url, sectionTitle: row.section_title,
    paragraphRef: row.paragraph_ref, content: row.content, searchText: row.search_text, updatedAt: row.updated_at,
  }));
  const old = policy.rankKnowledgeChunks(question, query(0));
  const oldAnswer = await client.answerOaChatQuestion(question, old);
  const candidates = query(1);
  const ranked = rankKnowledgeImageChunks(question, candidates, policy.rankKnowledgeChunks);
  const evidence = ranked.map(chunk => ({ id: chunk.id, itemId: chunk.itemId, revisionId: chunk.revisionId, content: chunk.content, title: chunk.title }));
  const authorize = async () => Boolean(db.prepare(BOT_SQL.currentLink).get(JSON.stringify(ctx)))
    && Number(db.prepare(BOT_SQL.currentEvidence).get(JSON.stringify({ ...ctx, evidence }))?.matched_count) === evidence.length;
  assert.ok(await authorize(), 'EVIDENCE_NOT_AUTHORIZED');
  const answer = await client.answerOaChatQuestion(question, ranked);
  assert.ok(answer.images.some(image => /image30\.png/u.test(image.url) && /四足/u.test(image.alt)), 'REAL_ROBOT_PHOTO_NOT_SELECTED');
  const images = await prepareWecomKnowledgeImages({ images: answer.images, selected: ranked, authorize, listAssets,
    getObject: key => bucket.get(key), transform: (bytes, mimeType) => transformWecomKnowledgeImage(bytes, mimeType,
      (input, options) => sharp(Buffer.from(input), options)), signal: new AbortController().signal });
  assert.equal(images.length, answer.images.length, 'PRIVATE_IMAGE_READ_FAILED');
  assert.ok(images.length > 0 && images.length <= 4);
  console.log(JSON.stringify({ query: question, beforeImages: oldAnswer.images.length, candidates: candidates.length,
    selectedChunks: ranked.length, readyImages: images.length, firstIsRealRobot: /image30\.png/u.test(answer.images[0].url),
    totalJpegBytes: images.reduce((sum, image) => sum + Buffer.from(image.base64, 'base64').length, 0) }));
}
db.close();
console.log('PRODUCTION_READONLY_IMAGE_PIPELINE_PASS');
