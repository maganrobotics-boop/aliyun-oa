import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { zip, png } from './helpers/oa-attachment-fixtures.mjs';
import { readChatAttachments, unpackChatAttachmentZip } from '../lib/oa-chat-attachments.mjs';
import { prepareKnowledgePackage, unpackKnowledgeZip, submitKnowledgePackage } from '../lib/knowledge-package.mjs';

const first = '# 第一章\n正文、公式 $x^2$ 和图注。\n![图一](assets/one.png)\n';
const second = '# 第二章\n```python\nprint("完整代码")\n```\n保留完整结尾。\n';
const chapters = [
  ['README.md', '# 导入说明\n这些说明不作为教材正文。'],
  ['manifest.json', JSON.stringify({ title: '分章教材', documents: [{file:'02.md'}, {file:'01.md'}] })],
  ['01.md', first], ['02.md', second], ['assets/one.png', png],
];
test('both upload entrances preserve manifest chapter order and image bytes without OCR', async () => {
  const archive = zip(chapters, {method:8});
  const standard = await prepareKnowledgePackage(await unpackKnowledgeZip(archive));
  const generic = await readChatAttachments([archive], { extract() { throw Error('must not use OCR'); } });
  assert.equal(standard.body, second+'\n\n'+first);
  assert.equal(generic.pkg.body, standard.body);
  assert.equal(generic.pkg.title, '分章教材');
  assert.equal(generic.parts.length, 2);
  assert.deepEqual(generic.warnings, []);
  assert.equal(generic.pkg.images[0].path, 'assets/one.png');
  assert.deepEqual(new Uint8Array(await generic.pkg.images[0].file.arrayBuffer()), new Uint8Array(png));
});
test('a single renamed Markdown and a wrapped folder work through either entrance', async () => {
  const files = [new File([first], '教材/机器人技术.md'), new File([png], '教材/assets/one.png')];
  const pkg = await prepareKnowledgePackage(files);
  assert.equal(pkg.body, first);
  const bundle = await readChatAttachments([zip(files.map((f, i) => [f.name, i ? png : first]))]);
  assert.equal(bundle.pkg.body, first);
  for (const f of files) Object.defineProperty(f, 'webkitRelativePath', {value:f.name});
  assert.equal((await readChatAttachments(files, {folder:true})).pkg.body, first);
});
test('chapter-only archives use natural filename ordering and exclude README guidance', async () => {
  const pkg = await prepareKnowledgePackage(await unpackKnowledgeZip(zip([['10.md', second], ['README.md','只用于导入说明'], ['2.md', first], ['assets/one.png',png]])));
  assert.equal(pkg.body, first+'\n\n'+second);
});
test('invalid, missing, duplicate and incomplete manifest entries fail before submission', async () => {
  for (const documents of [[], [{file:'missing.md'}], [{file:'01.md'},{file:'01.md'}], [{file:'../01.md'}], [{file:'01.md'}]]) {
    const archive = zip(chapters.map(([name, body]) => [name, name === 'manifest.json' ? JSON.stringify({documents}) : body]));
    await assert.rejects(readChatAttachments([archive]), /manifest/);
  }
  await assert.rejects(readChatAttachments([zip([['manifest.json','not json'],['01.md', first]])]), /manifest/);
});
test('missing images and oversized combined prose are rejected without truncation', async () => {
  await assert.rejects(readChatAttachments([zip(chapters.filter(([name])=>name!=='assets/one.png'))]), /缺失图片/);
  const piece = '字'.repeat(900000);
  await assert.rejects(prepareKnowledgePackage([new File([piece],'1.md'),new File([piece],'2.md')]), /合并后的正文/);
});
test('100 MB ZIP allowance is enforced consistently before reading oversized archives', async () => {
  for (const unpack of [unpackKnowledgeZip, unpackChatAttachmentZip]) {
    await assert.rejects(unpack({size:100*1024*1024+1, arrayBuffer(){throw Error('must not read');}}), /限制|100 MB/);
    await assert.rejects(unpack({size:75*1024*1024, arrayBuffer(){throw Error('size accepted');}}), /size accepted/);
  }
});
test('the supplied textbook retains all 22 chapters and 5 images through the existing audited protocol', {skip:!process.env.OA_UPLOAD_FIXTURE}, async () => {
  const source = new File([await readFile(process.env.OA_UPLOAD_FIXTURE)], '教材.zip');
  const bundle = await readChatAttachments([source], {extract(){throw Error('must not use OCR');}});
  const standard = await prepareKnowledgePackage(await unpackKnowledgeZip(source));
  assert.equal(bundle.parts.length,22); assert.equal(bundle.pkg.images.length,5);
  assert.equal(bundle.pkg.body,standard.body); assert.equal(bundle.pkg.title,'机器人技术与应用：从基础到前沿');
  assert.equal(bundle.pkg.body,bundle.parts.map(p=>p.text).join('\n\n'));
  assert.deepEqual(bundle.warnings,[]); assert.deepEqual(bundle.pkg.unusedPaths,[]);
  const calls=[];
  await submitKnowledgePackage(bundle.pkg, {fetcher:async (url,init)=>{
    calls.push({url,init});
    return Response.json({received:true,item:{id:'test-item',status:'pending'},assetUpload:{revisionId:'test-revision',uploadToken:'test-token'}});
  }});
  assert.equal(calls.length,7);
  assert.equal(JSON.parse(calls[0].init.body).document.body,bundle.pkg.body);
  assert.deepEqual(JSON.parse(calls.at(-1).init.body).expectedPaths,bundle.pkg.images.map(i=>i.path));
  assert.ok(calls.every(c=>c.init.credentials==='same-origin' && c.init.method!=='PATCH'));
});
