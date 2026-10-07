import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { stripTypeScriptTypes } from 'node:module';
import { knowledgeImageReferences } from '../lib/knowledge-image-references.mjs';
import { rankKnowledgeImageChunks, knowledgeChunkMayShowImages, knowledgeImageReferenceScore, relevantKnowledgeImageReferences } from '../lib/knowledge-image-relevance.mjs';

const question = '看看四足机器人的图片';
const chunk = (content, extra = {}) => ({ id: 'c1', itemId: 'item1', revisionId: 'revision1', title: '已审核机器人实验资料', category: '资料', sectionTitle: '', content, searchText: content, updatedAt: '2026-10-01', ...extra });
const photo = chunk('![四足机器人实验平台：Unitree Go2四足机器人实物](assets/image30.png)');
const asset = (path, extra = {}) => ({ itemId: 'item1', revisionId: 'revision1', assetPath: path, mimeType: 'image/png', ...extra });

let moduleId = 0;
async function loadClient(assets, failure = false) {
  let source = await readFile(new URL('../lib/oa-chat-client.ts', import.meta.url), 'utf8');
  source = source.replace(/^import\s[\s\S]*?;\n/gmu, '').replace(/^export\s*\{[^}]*\}\s*from\s*[^;]+;\n/gmu, '');
  source = stripTypeScriptTypes(source, { mode: 'strip' });
  const key = `__knowledgeImageTest${++moduleId}`;
  globalThis[key] = {
    getDb: async () => ({ $client: {} }),
    listKnowledgeRevisionAssets: async () => { if (failure) throw new Error('simulated_database_unavailable'); return assets; },
    knowledgeImageReferences, knowledgeImageReferenceScore, relevantKnowledgeImageReferences,
    requestedKnowledgeImageKinds: q => [...new Set(q.match(/四足/gu) || [])],
    checkStreamAbort: () => {}, questionRequestsKnowledgeImages: () => true,
    questionPrefersGeneralKnowledge: () => false, questionAllowsGeneralKnowledge: () => false,
    questionRequiresKnowledgeEvidence: () => true,
  };
  try {
    return await import('data:text/javascript;base64,' + Buffer.from(`const {getDb,listKnowledgeRevisionAssets,knowledgeImageReferences,knowledgeImageReferenceScore,relevantKnowledgeImageReferences,requestedKnowledgeImageKinds,checkStreamAbort,questionRequestsKnowledgeImages,questionPrefersGeneralKnowledge,questionAllowsGeneralKnowledge,questionRequiresKnowledgeEvidence}=globalThis[${JSON.stringify(key)}];\n${source}\nexport {answerImages};`).toString('base64'));
  } finally { delete globalThis[key]; }
}

test('quadruped request excludes text-only results and cover with robot mentioned in index', () => {
  assert.equal(knowledgeChunkMayShowImages(question, chunk('四足机器人产品介绍')), false);
  assert.equal(knowledgeChunkMayShowImages(question, chunk('常用图片定位：四足机器人\n![硕士学位论文封面](assets/image1.png)')), false);
  assert.equal(knowledgeChunkMayShowImages(question, photo), true);
});

test('caption selects exact robot and rejects unrelated images in the same paragraph', () => {
  const mixed = chunk('![双臂机器人](assets/arm.png)\n![四足机器人实物](assets/go2.png)', { sectionTitle: '四足与双臂机器人' });
  assert.deepEqual([...relevantKnowledgeImageReferences(question, mixed).keys()], ['assets/go2.png']);
});

test('single original image can use its own OCR text while another image caption cannot', () => {
  assert.equal(knowledgeChunkMayShowImages(question, chunk('四足机器人实验平台\n![原图](assets/original.png)')), true);
  assert.equal(knowledgeChunkMayShowImages(question, chunk('四足机器人实验平台\n![导航成功率曲线](assets/chart.png)')), false);
});

test('HTML references are supported and fenced/path-traversal examples cannot be images', () => {
  assert.equal(knowledgeChunkMayShowImages(question, chunk('<img src="assets/go2.png" alt="四足机器人实物">')), true);
  assert.equal(knowledgeChunkMayShowImages(question, chunk('```md\n![四足机器人](assets/go2.png)\n```')), false);
  assert.equal(knowledgeChunkMayShowImages(question, chunk('![四足机器人](assets/../go2.png)')), false);
});

test('actual photograph ranks before simulation unless the user explicitly asks for simulation', () => {
  const real = knowledgeImageReferenceScore(question, photo, '四足机器人实物');
  const simulated = knowledgeImageReferenceScore(question, photo, '四足机器人仿真环境');
  assert.ok(real > simulated);
  assert.equal(knowledgeImageReferenceScore('四足机器人仿真图片', photo, '四足机器人仿真环境'), 1000);
});

test('photograph ranking precedes the per-item paragraph limit and remains bounded', async () => {
  const policy = await import('data:text/javascript;base64,' + Buffer.from(stripTypeScriptTypes(await readFile(new URL('../lib/knowledge-policy.ts', import.meta.url), 'utf8'), { mode: 'strip' })).toString('base64'));
  const textHeavy = chunk('四足机器人 四足机器人 四足机器人 图片 机器人 图片\n![四足机器人仿真环境](assets/simulation.png)', { id: 'sim1' });
  const textHeavy2 = { ...textHeavy, id: 'sim2' };
  const lowTextPhoto = { ...photo, id: 'actual-photo' };
  assert.ok(!policy.rankKnowledgeChunks(question, [textHeavy, textHeavy2, lowTextPhoto]).some(c => c.id === 'actual-photo'));
  const ranked = rankKnowledgeImageChunks(question, [textHeavy, textHeavy2, lowTextPhoto], policy.rankKnowledgeChunks);
  assert.equal(ranked[0].id, 'actual-photo');
  assert.equal(ranked.length, 2);
  assert.throws(() => rankKnowledgeImageChunks(question, [], policy.rankKnowledgeChunks, 13), RangeError);
});

test('asset selection uses referenced robot photograph rather than lexicographically first cover', async () => {
  const client = await loadClient([asset('assets/image1.png'), asset('assets/image10.png'), asset('assets/image30.png')]);
  const images = await client.answerImages(question, [photo], true);
  assert.equal(images.length, 1);
  assert.match(images[0].url, /assets\/image30\.png/);
});

test('all selected chunks of the same revision contribute related images, deduplicated and capped', async () => {
  const related = chunk('![四足机器人爬楼梯](assets/image3.png)\n![四足机器人观测](assets/image27.png)', { id: 'c2' });
  const unrelated = chunk('![差速小车](assets/image31.png)', { id: 'c3' });
  const client = await loadClient(['image1', 'image3', 'image27', 'image30', 'image31'].map(name => asset(`assets/${name}.png`)));
  const images = await client.answerImages(question, [related, photo, photo, unrelated], true);
  assert.equal(images.length, 3);
  assert.match(images[0].url, /image30\.png/);
  assert.equal(new Set(images.map(image => image.url)).size, 3);
  assert.ok(images.every(image => !/image1\.png|image31\.png/u.test(image.url)));
});

test('wrong-item assets and uncited images are never substituted for a matching image', async () => {
  const client = await loadClient([asset('assets/image30.png', { itemId: 'another-item' }), asset('assets/image1.png')]);
  assert.deepEqual(await client.answerImages(question, [photo], true), []);
});

test('lookup failure and a genuine empty result have different user-visible responses', async () => {
  const failed = await loadClient([], true);
  assert.match((await failed.answerOaChatQuestion(question, [photo])).answer, /暂时无法查询/u);
  const empty = await loadClient([]);
  assert.match((await empty.answerOaChatQuestion(question, [photo])).answer, /没有可展示的图片/u);
  assert.match((await empty.answerOaChatQuestion(question, [])).answer, /没有找到/u);
});

test('an unavailable high-score reference cannot mask another available image revision', async () => {
  const high = chunk('![四足机器人实验平台实物](assets/missing.png)', { title: 'OriginMind 实验平台' });
  const low = chunk('![四足机器人爬楼梯](assets/ready.png)', { itemId: 'item2', revisionId: 'revision2' });
  const client = await loadClient([asset('assets/cover.png'), asset('assets/ready.png', { itemId: 'item2', revisionId: 'revision2' })]);
  const images = await client.answerImages(question, [high, low], true);
  assert.equal(images.length, 1);
  assert.match(images[0].url, /ready\.png/);
});
