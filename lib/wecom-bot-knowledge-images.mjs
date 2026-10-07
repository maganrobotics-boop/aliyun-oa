import { createHash } from 'node:crypto';

export const MAX_WECOM_KNOWLEDGE_IMAGES = 4;
export const MAX_WECOM_KNOWLEDGE_IMAGE_INPUT_BYTES = 8 * 1024 * 1024;
export const MAX_WECOM_KNOWLEDGE_IMAGE_BYTES = 2 * 1024 * 1024;
export const MAX_WECOM_KNOWLEDGE_IMAGES_BYTES = 6 * 1024 * 1024;
const MIME_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);
const SAFE_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const SAFE_ASSET_PATH = /^assets\/[A-Za-z0-9][A-Za-z0-9._/-]*\.(?:webp|png|jpe?g)$/iu;
const CONTROL_ERRORS = new Set(['WECOM_IMAGES_REVOKED', 'WECOM_IMAGES_CANCELLED', 'WECOM_IMAGES_AUTH_UNAVAILABLE']);
const controlError = code => Object.assign(new Error(code), { code });
function checkAbort(signal) { if (signal?.aborted) throw controlError('WECOM_IMAGES_CANCELLED'); }

function parseImage(image, selected) {
  if (!image || typeof image.url !== 'string' || image.url.length > 2048 || image.url.includes('#') || image.url.includes('\\')) return null;
  const parts = image.url.split('?');
  if (parts.length !== 2) return null;
  const match = /^\/api\/knowledge\/([^/]+)\/assets\/(.+)$/u.exec(parts[0]);
  if (!match || !SAFE_ID.test(match[1])) return null;
  const query = new URLSearchParams(parts[1]);
  if ([...query].length !== 2 || query.getAll('forChat').length !== 1 || query.getAll('revision').length !== 1
    || query.get('forChat') !== '1' || [...query.keys()].some(key => !['forChat', 'revision'].includes(key))) return null;
  const itemId = match[1], revisionId = query.get('revision');
  if (!SAFE_ID.test(revisionId || '') || !selected.some(chunk => chunk?.itemId === itemId && chunk?.revisionId === revisionId)) return null;
  let assetPath;
  try {
    const segments = match[2].split('/').map(segment => decodeURIComponent(segment));
    if (segments.some(segment => !segment || segment.includes('/') || segment.includes('\\'))) return null;
    assetPath = segments.join('/');
  } catch { return null; }
  if (!SAFE_ASSET_PATH.test(assetPath) || assetPath.includes('../') || assetPath.includes('//')) return null;
  if (!MIME_TYPES.has(image.mimeType)) return null;
  return { itemId, revisionId, assetPath, mimeType: image.mimeType };
}

function matchingAsset(assets, candidate) {
  if (!Array.isArray(assets)) return null;
  const matches = assets.filter(asset => asset?.itemId === candidate.itemId && asset?.revisionId === candidate.revisionId && asset?.assetPath === candidate.assetPath);
  if (matches.length !== 1) return null;
  const asset = matches[0];
  // listAssets must select ready rows, as listKnowledgeRevisionAssets does.
  // Honor an explicit uploadState if a caller also includes that field.
  if ((asset.uploadState !== undefined && asset.uploadState !== 'ready') || typeof asset.id !== 'string' || !asset.id
    || asset.mimeType !== candidate.mimeType || !Number.isSafeInteger(asset.byteSize) || asset.byteSize < 1
    || asset.byteSize > MAX_WECOM_KNOWLEDGE_IMAGE_INPUT_BYTES
    || asset.storageKey !== `knowledge/${candidate.itemId}/${candidate.revisionId}/${candidate.assetPath.slice('assets/'.length)}`) return null;
  return { ...asset };
}
function sameAsset(left, right) {
  return right && ['id', 'itemId', 'revisionId', 'assetPath', 'storageKey', 'mimeType', 'byteSize', 'sha256']
    .every(key => left[key] === right[key]);
}
function imageMime(bytes) {
  if (bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return 'image/png';
  if (bytes.length >= 3 && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) return 'image/jpeg';
  if (bytes.length >= 12 && bytes.subarray(0, 4).toString('ascii') === 'RIFF' && bytes.subarray(8, 12).toString('ascii') === 'WEBP') return 'image/webp';
  return null;
}
async function readObject(object, expectedBytes, signal) {
  checkAbort(signal);
  if (object.body?.getReader) {
    const reader = object.body.getReader(), parts = [];
    let total = 0;
    const cancel = () => { void reader.cancel().catch(() => {}); };
    signal?.addEventListener('abort', cancel, { once: true });
    try {
      for (;;) {
        checkAbort(signal);
        const { value, done } = await reader.read();
        checkAbort(signal);
        if (done) break;
        if (!(value instanceof Uint8Array)) throw new Error('INVALID_IMAGE_BYTES');
        total += value.byteLength;
        if (total > expectedBytes || total > MAX_WECOM_KNOWLEDGE_IMAGE_INPUT_BYTES) throw new Error('IMAGE_TOO_LARGE');
        parts.push(Buffer.from(value));
      }
      if (total !== expectedBytes) throw new Error('IMAGE_SIZE_MISMATCH');
      return Buffer.concat(parts, total);
    } finally {
      signal?.removeEventListener('abort', cancel);
      await reader.cancel().catch(() => {});
      reader.releaseLock();
    }
  }
  if (typeof object.arrayBuffer !== 'function') throw new Error('IMAGE_UNREADABLE');
  const value = await object.arrayBuffer();
  checkAbort(signal);
  if (!(value instanceof ArrayBuffer) || value.byteLength !== expectedBytes || value.byteLength > MAX_WECOM_KNOWLEDGE_IMAGE_INPUT_BYTES) throw new Error('IMAGE_SIZE_MISMATCH');
  return Buffer.from(value);
}
function checkSha256(raw, asset, object) {
  const hashes = [asset.sha256, object.sha256, object.customMetadata?.sha256];
  // The filesystem adapter exposes its stored SHA-256 as etag; OSS etags
  // are not SHA-256 and are therefore ignored unless they are 64 hex digits.
  if (typeof object.etag === 'string' && /^[a-f0-9]{64}$/iu.test(object.etag)) hashes.push(object.etag);
  const supplied = hashes.filter(value => value !== undefined && value !== '');
  if (!supplied.length) return;
  const digest = createHash('sha256').update(raw).digest('hex');
  if (supplied.some(value => typeof value !== 'string' || !/^[a-f0-9]{64}$/iu.test(value) || value.toLowerCase() !== digest)) throw new Error('IMAGE_HASH_MISMATCH');
}

/** Uses only server-selected approved assets; no URL fetches or public links. */
export async function prepareWecomKnowledgeImages({ images, selected, authorize, listAssets, getObject, transform, signal }) {
  const authorized = async () => {
    checkAbort(signal);
    let allowed;
    try { allowed = await authorize(); }
    catch { checkAbort(signal); throw controlError('WECOM_IMAGES_AUTH_UNAVAILABLE'); }
    checkAbort(signal);
    if (allowed !== true) throw controlError('WECOM_IMAGES_REVOKED');
  };
  const prepared = [], seen = new Set();
  let total = 0;
  await authorized();
  for (const image of (Array.isArray(images) ? images : []).slice(0, MAX_WECOM_KNOWLEDGE_IMAGES)) {
    await authorized();
    try {
      const candidate = parseImage(image, Array.isArray(selected) ? selected : []);
      if (!candidate) continue;
      const identity = `${candidate.itemId}:${candidate.revisionId}:${candidate.assetPath}`;
      if (seen.has(identity)) continue;
      seen.add(identity);
      const asset = matchingAsset(await listAssets(candidate.revisionId), candidate);
      checkAbort(signal);
      if (!asset) continue;
      const object = await getObject(asset.storageKey);
      checkAbort(signal);
      if (!object || object.size !== asset.byteSize || object.httpMetadata?.contentType?.trim().toLowerCase() !== asset.mimeType) continue;
      const raw = await readObject(object, asset.byteSize, signal);
      if (imageMime(raw) !== asset.mimeType) continue;
      checkSha256(raw, asset, object);
      const transformed = await transform(raw, asset.mimeType);
      checkAbort(signal);
      if (!(transformed instanceof Uint8Array)) continue;
      const bytes = Buffer.from(transformed);
      if (!bytes.length || bytes.length > MAX_WECOM_KNOWLEDGE_IMAGE_BYTES || total + bytes.length > MAX_WECOM_KNOWLEDGE_IMAGES_BYTES
        || !['image/jpeg', 'image/png'].includes(imageMime(bytes))) continue;
      await authorized();
      if (!sameAsset(asset, matchingAsset(await listAssets(candidate.revisionId), candidate))) continue;
      await authorized();
      total += bytes.length;
      prepared.push({ candidate, asset, bytes });
    } catch (error) {
      checkAbort(signal);
      if (CONTROL_ERRORS.has(error?.code)) throw error;
      // Ordinary unavailable/corrupt/oversized pictures cannot discard text.
    }
  }
  // Recheck earlier pictures after later asynchronous reads/transforms.
  const output = [];
  for (const item of prepared) {
    await authorized();
    try {
      if (sameAsset(item.asset, matchingAsset(await listAssets(item.candidate.revisionId), item.candidate))) {
        output.push({ base64: item.bytes.toString('base64'), md5: createHash('md5').update(item.bytes).digest('hex') });
      }
    } catch (error) { checkAbort(signal); if (CONTROL_ERRORS.has(error?.code)) throw error; }
    await authorized();
  }
  await authorized();
  return output;
}

/** Decode at most 16M pixels and return a bounded auto-oriented JPEG preview. */
export async function transformWecomKnowledgeImage(bytes, mimeType, sharpImpl) {
  if (!(bytes instanceof Uint8Array) || !bytes.length || bytes.byteLength > MAX_WECOM_KNOWLEDGE_IMAGE_INPUT_BYTES || !MIME_TYPES.has(mimeType)) throw new Error('IMAGE_INPUT_INVALID');
  const sharp = sharpImpl(bytes, { limitInputPixels: 16_000_000, sequentialRead: true, failOn: 'error' });
  const metadata = await sharp.metadata();
  const format = { 'image/jpeg': 'jpeg', 'image/png': 'png', 'image/webp': 'webp' }[mimeType];
  if (metadata.format !== format || !Number.isSafeInteger(metadata.width) || !Number.isSafeInteger(metadata.height)
    || metadata.width < 1 || metadata.height < 1 || metadata.width * metadata.height > 16_000_000 || (metadata.pages || 1) !== 1) throw new Error('IMAGE_METADATA_INVALID');
  const output = await sharp.rotate().resize({ width: 1600, height: 1600, fit: 'inside', withoutEnlargement: true }).flatten({ background: '#ffffff' }).jpeg({ quality: 80 }).toBuffer();
  if (!(output instanceof Uint8Array) || !output.length || output.byteLength > MAX_WECOM_KNOWLEDGE_IMAGE_BYTES) throw new Error('IMAGE_OUTPUT_TOO_LARGE');
  return Buffer.from(output);
}
