import { knowledgeImageReferences } from './knowledge-image-references.mjs';

const ROBOT_KINDS = /(?:四足|轮足|轮式|双臂|机械臂|开放式|人形|履带|无人机)/gu;
const normalize = value => String(value || '').normalize('NFKC');

export function requestedKnowledgeImageKinds(question) {
  return [...new Set(normalize(question).match(ROBOT_KINDS) || [])];
}

/** Scores only stored image references. Text mentioning a robot elsewhere in a
 * long document must not make an unrelated cover or plot a robot photograph. */
export function knowledgeImageReferenceScore(question, chunk, alt, referenceCount = 1) {
  const kinds = requestedKnowledgeImageKinds(question);
  const caption = normalize(alt);
  const heading = normalize(`${chunk.title}\n${chunk.sectionTitle || ''}`);
  const content = normalize(chunk.content);
  const questionText = normalize(question);
  if (kinds.length) {
    if (/(?:封面|外封|模板|校徽|目录)/u.test(caption)) return -10_000;
    // An explicit caption for another robot kind is stronger than a mixed
    // chapter title. An unspecified original photo can use its own OCR text.
    const captionKinds = [...new Set(caption.match(ROBOT_KINDS) || [])];
    if (captionKinds.length && !kinds.every(kind => captionKinds.includes(kind))) return -10_000;
    const direct = kinds.every(kind => caption.includes(kind));
    const context = kinds.every(kind => heading.includes(kind))
      || (referenceCount === 1 && /^(?:原图|资料插图|图片)?$/u.test(caption.trim())
        && kinds.every(kind => content.includes(kind)));
    if (!direct && !context) return -10_000;
    let score = direct ? 1_000 : 500;
    if (/(?:实物|照片|实验平台|硬件平台)/u.test(caption)) score += 300;
    if (/(?:仿真|示意|结构图|曲线|分割|算法|流程图)/u.test(caption)
      && !/(?:仿真|示意|结构|曲线|分割|算法|流程)/u.test(questionText)) score -= 400;
    return score;
  }
  return 0;
}

export function relevantKnowledgeImageReferences(question, chunk) {
  const refs = knowledgeImageReferences(chunk.content);
  return new Map([...refs].filter(([, alt]) => knowledgeImageReferenceScore(question, chunk, alt, refs.size) > -10_000));
}

export function knowledgeChunkMayShowImages(question, chunk) {
  const refs = knowledgeImageReferences(chunk.content);
  return refs.size ? relevantKnowledgeImageReferences(question, chunk).size > 0
    : requestedKnowledgeImageKinds(question).length === 0;
}

/** Image relevance is applied before the shared two-chunks-per-item bound, so
 * a document's text-heavy introduction cannot displace its actual photograph. */
export function rankKnowledgeImageChunks(question, candidates, rankText, limit = 12) {
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 12) throw new RangeError('invalid knowledge image result limit');
  const ranked = candidates.filter(chunk => knowledgeChunkMayShowImages(question, chunk)).flatMap(chunk => {
    const text = rankText(question, [chunk], 1)[0];
    if (!text) return [];
    const refs = relevantKnowledgeImageReferences(question, chunk);
    const count = knowledgeImageReferences(chunk.content).size;
    const imageScore = Math.max(0, ...[...refs.values()].map(alt => knowledgeImageReferenceScore(question, chunk, alt, count)));
    return [{ ...text, score: text.score + imageScore }];
  });
  ranked.sort((a, b) => b.score - a.score || b.updatedAt.localeCompare(a.updatedAt) || a.id.localeCompare(b.id));
  const perItem = new Map();
  return ranked.filter(chunk => {
    const count = perItem.get(chunk.itemId) || 0;
    if (count >= 2) return false;
    perItem.set(chunk.itemId, count + 1); return true;
  }).slice(0, limit);
}
