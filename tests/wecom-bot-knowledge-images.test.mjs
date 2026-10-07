import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { prepareWecomKnowledgeImages, transformWecomKnowledgeImage,
  MAX_WECOM_KNOWLEDGE_IMAGE_INPUT_BYTES, MAX_WECOM_KNOWLEDGE_IMAGE_BYTES } from '../lib/wecom-bot-knowledge-images.mjs';

// Synthetic 1x1 PNG: no production storage, credentials or business data.
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4//9/AwAJfAN+TrsbXQAAAABJRU5ErkJggg==', 'base64');
const itemId = '11111111-1111-4111-8111-111111111111';
const revisionId = '22222222-2222-4222-8222-222222222222';
function asset(index = 1) {
  return { id: `asset-${index}`, itemId, revisionId, assetPath: `assets/figure-${index}.png`, mimeType: 'image/png', byteSize: PNG.length,
    storageKey: `knowledge/${itemId}/${revisionId}/figure-${index}.png`, uploadState: 'ready' };
}
function image(a) { return { url: `/api/knowledge/${a.itemId}/assets/${a.assetPath}?forChat=1&revision=${a.revisionId}`, mimeType: a.mimeType, alt: '合成图片' }; }
function object(bytes = PNG) {
  return { size: bytes.length, httpMetadata: { contentType: 'image/png' }, body: new Blob([bytes]).stream(),
    arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) };
}
function harness(overrides = {}, count = 1) {
  const current = Array.from({ length: count }, (_, index) => asset(index + 1));
  const calls = { read: 0, authorize: 0, transform: 0 };
  const options = {
    images: current.map(image), selected: [{ itemId, revisionId }],
    authorize: async () => { calls.authorize++; return true; },
    listAssets: async () => current.map(value => ({ ...value })),
    getObject: async () => { calls.read++; return object(); },
    transform: async () => { calls.transform++; return PNG; },
    ...overrides,
  };
  return { options, current, calls, run: () => prepareWecomKnowledgeImages(options) };
}
const rejected = (promise, code) => assert.rejects(promise, error => error.message === code && error.code === code);

test('authorized selected ready image returns exact bytes and final-byte MD5 without a URL', async () => {
  const h = harness();
  const output = await h.run();
  assert.deepEqual(output, [{ base64: PNG.toString('base64'), md5: createHash('md5').update(PNG).digest('hex') }]);
  assert.equal(h.calls.read, 1);
  assert.ok(h.calls.authorize >= 4);
});

test('external, malformed, traversal and unselected image URLs cannot read objects', async () => {
  const valid = image(asset()).url;
  for (const url of [
    `https://oa.omindos.cn${valid}`, `//oa.omindos.cn${valid}`, valid.replace('/assets/assets/', '/assets/'),
    valid.replace('figure-1.png', '../figure-1.png'), valid.replace('figure-1.png', 'dir%2Ffigure-1.png'),
    valid.replace('forChat=1', 'forChat=0'), `${valid}&forChat=1`, `${valid}&extra=1`, `${valid}#fragment`,
    valid.replace(revisionId, '33333333-3333-4333-8333-333333333333'), valid.replace(itemId, '44444444-4444-4444-8444-444444444444'),
  ]) {
    const h = harness({ images: [{ url, mimeType: 'image/png' }] });
    assert.deepEqual(await h.run(), []);
    assert.equal(h.calls.read, 0);
  }
});

test('duplicate images are read once and unknown or unready metadata is withheld', async () => {
  const duplicate = harness({ images: [image(asset()), image(asset())] });
  assert.equal((await duplicate.run()).length, 1);
  assert.equal(duplicate.calls.read, 1);
  for (const mutate of [a => { a.uploadState = 'staged'; }, a => { a.storageKey = 'another/object.png'; },
    a => { a.mimeType = 'image/jpeg'; }, a => { a.byteSize = MAX_WECOM_KNOWLEDGE_IMAGE_INPUT_BYTES + 1; }]) {
    const h = harness(); mutate(h.current[0]);
    assert.deepEqual(await h.run(), []);
    assert.equal(h.calls.read, 0);
  }
});

test('object size, MIME, actual bytes and optional SHA-256 must match metadata', async () => {
  for (const modify of [o => { o.size++; }, o => { o.httpMetadata.contentType = 'image/jpeg'; },
    o => { o.body = new Blob([Buffer.concat([PNG, Buffer.from([0])])]).stream(); },
    o => { o.sha256 = '0'.repeat(64); }, o => { o.body = new Blob([Buffer.from('not an image')]).stream(); }]) {
    const h = harness({ getObject: async () => { const o = object(); modify(o); return o; } });
    assert.deepEqual(await h.run(), []);
  }
  const matched = harness({ getObject: async () => ({ ...object(), sha256: createHash('sha256').update(PNG).digest('hex') }) });
  assert.equal((await matched.run()).length, 1);
});

test('oversized body is cancelled despite a small advertised object size', async () => {
  let cancelled = false;
  const h = harness({ getObject: async () => ({ ...object(), body: new ReadableStream({
    start(controller) { controller.enqueue(Buffer.concat([PNG, Buffer.from([0])])); }, cancel() { cancelled = true; },
  }) }) });
  assert.deepEqual(await h.run(), []);
  assert.equal(cancelled, true);
});

test('ordinary storage and transform failures skip the picture while remaining authorized', async () => {
  for (const overrides of [{ getObject: async () => { throw new Error('fixture read failure'); } },
    { transform: async () => { throw new Error('fixture decode failure'); } }, { getObject: async () => null }]) {
    assert.deepEqual(await harness(overrides).run(), []);
  }
});

test('per-image 2MiB, total 6MiB and four-image limits are enforced on decoded output', async () => {
  const big = Buffer.alloc(MAX_WECOM_KNOWLEDGE_IMAGE_BYTES); PNG.copy(big);
  const h = harness({ transform: async () => big }, 4);
  const output = await h.run();
  assert.equal(output.length, 3);
  assert.equal(output.reduce((sum, item) => sum + Buffer.from(item.base64, 'base64').length, 0), 6 * 1024 * 1024);
  assert.deepEqual(await harness({ transform: async () => Buffer.alloc(MAX_WECOM_KNOWLEDGE_IMAGE_BYTES + 1) }).run(), []);
  const limited = harness({}, 5);
  assert.equal((await limited.run()).length, 4);
  assert.equal(limited.calls.read, 4);
});

test('downloaded asset metadata changes or removal prevent it from being returned', async () => {
  for (const change of [a => { a.id = 'changed'; }, a => { a.storageKey += '.changed'; }, a => { a.byteSize++; },
    a => { a.mimeType = 'image/jpeg'; }, a => { a.uploadState = 'staged'; }, a => { a.assetPath = 'assets/changed.png'; }]) {
    const h = harness();
    h.options.transform = async () => { change(h.current[0]); return PNG; };
    assert.deepEqual(await h.run(), []);
  }
});

test('an earlier image withdrawn while a later image is processed is removed by final recheck', async () => {
  const h = harness({}, 2);
  let transforms = 0;
  h.options.transform = async () => { if (++transforms === 2) h.current[0].uploadState = 'staged'; return PNG; };
  assert.equal((await h.run()).length, 1);
});

test('permission false before a read aborts the entire reply with a specific revoked error', async () => {
  const h = harness({ authorize: async () => false });
  await rejected(h.run(), 'WECOM_IMAGES_REVOKED');
  assert.equal(h.calls.read, 0);
});

test('permission revoked after download or during a later image never returns prior pictures', async () => {
  for (const revokeAt of [1, 2]) {
    const h = harness({}, 2);
    let allowed = true, transforms = 0;
    h.options.authorize = async () => allowed;
    h.options.transform = async () => { if (++transforms === revokeAt) allowed = false; return PNG; };
    await rejected(h.run(), 'WECOM_IMAGES_REVOKED');
  }
});

test('authorization exceptions fail closed with no raw exception in the diagnostic', async () => {
  const h = harness({ authorize: async () => { throw new Error('fixture private diagnostic'); } });
  await rejected(h.run(), 'WECOM_IMAGES_AUTH_UNAVAILABLE');
  assert.equal(h.calls.read, 0);
});

test('request cancellation before and during asynchronous work prevents all output', async () => {
  const before = new AbortController(); before.abort();
  await rejected(harness({ signal: before.signal }).run(), 'WECOM_IMAGES_CANCELLED');
  const during = new AbortController();
  await rejected(harness({ signal: during.signal, getObject: async () => { during.abort(); return object(); } }).run(), 'WECOM_IMAGES_CANCELLED');
});

test('arrayBuffer-only adapters remain bounded and compatible', async () => {
  const h = harness({ getObject: async () => { const o = object(); delete o.body; return o; } });
  assert.equal((await h.run()).length, 1);
  const bad = harness({ getObject: async () => ({ size: PNG.length, httpMetadata: { contentType: 'image/png' }, arrayBuffer: async () => new ArrayBuffer(PNG.length + 1) }) });
  assert.deepEqual(await bad.run(), []);
});

function mockSharp({ metadata = { format: 'png', width: 1, height: 1 }, output = PNG } = {}) {
  const calls = [];
  const pipeline = { metadata: async () => metadata,
    rotate() { calls.push(['rotate']); return this; }, resize(options) { calls.push(['resize', options]); return this; },
    flatten(options) { calls.push(['flatten', options]); return this; }, jpeg(options) { calls.push(['jpeg', options]); return this; }, toBuffer: async () => output };
  const factory = (_raw, options) => { calls.push(['create', options]); return pipeline; };
  return { factory, calls };
}
test('sharp conversion validates format and pixels then auto-rotates, resizes and flattens white', async () => {
  const sharp = mockSharp();
  assert.deepEqual(await transformWecomKnowledgeImage(PNG, 'image/png', sharp.factory), PNG);
  assert.deepEqual(sharp.calls, [
    ['create', { limitInputPixels: 16_000_000, sequentialRead: true, failOn: 'error' }], ['rotate'],
    ['resize', { width: 1600, height: 1600, fit: 'inside', withoutEnlargement: true }],
    ['flatten', { background: '#ffffff' }], ['jpeg', { quality: 80 }],
  ]);
  for (const metadata of [{ format: 'jpeg', width: 1, height: 1 }, { format: 'png', width: 4001, height: 4000 },
    { format: 'png', width: 1, height: 1, pages: 2 }]) {
    await assert.rejects(transformWecomKnowledgeImage(PNG, 'image/png', mockSharp({ metadata }).factory), /IMAGE_METADATA_INVALID/u);
  }
  await assert.rejects(transformWecomKnowledgeImage(PNG, 'image/png', mockSharp({ output: Buffer.alloc(MAX_WECOM_KNOWLEDGE_IMAGE_BYTES + 1) }).factory), /IMAGE_OUTPUT_TOO_LARGE/u);
});
