import { consumeOaAnswerStream, checkStreamAbort, type OaNativeEvent } from './oa-native-stream.mjs';
import { OA_CHAT_ORIGIN, OA_CHAT_PATH, signOaChatRequest } from '../chat-cloudflare/src/oa-chat-bridge.mjs';
import { getDb } from '../db';
import { listKnowledgeRevisionAssets } from './knowledge-assets';
import { knowledgeImageReferences } from './knowledge-image-references.mjs';
import { knowledgeImageReferenceScore, relevantKnowledgeImageReferences, requestedKnowledgeImageKinds } from './knowledge-image-relevance.mjs';
import type { RankedKnowledgeChunk } from './knowledge-policy';
import { questionAllowsGeneralKnowledge, questionPrefersGeneralKnowledge, questionRequestsKnowledgeImages, questionRequiresKnowledgeEvidence } from '../chat-cloudflare/src/question-scope.mjs';
export { questionAllowsGeneralKnowledge, questionPrefersGeneralKnowledge, questionRequestsKnowledgeImages, questionRequiresKnowledgeEvidence } from '../chat-cloudflare/src/question-scope.mjs';

export type OaChatImage = { url: string; alt: string; mimeType: string };
export type OaChatHistory = Array<{ role: 'user'; content: string }>;
type BridgeResponse = { received?: boolean; answer?: string; mode?: string; provider?: string; fallbackReason?: string; modelReady?: boolean; budgetReady?: boolean; bridgeReady?: boolean };
function prefix(value: string, maximum: number) {
  const result = String(value || '').slice(0, maximum);
  return /[\uD800-\uDBFF]$/u.test(result) ? result.slice(0, -1) : result;
}
async function bridge(payload: object, timeoutMs: number): Promise<BridgeResponse> {
  const { env } = await import('cloudflare:workers');
  const bindings = env as typeof env & {
    PUBLIC_LAB_AI_SERVICE_TOKEN?: string;
    CHAT_SERVICE?: { fetch: typeof fetch };
  };
  const secret = bindings.PUBLIC_LAB_AI_SERVICE_TOKEN || '';
  if (secret.length < 32) throw new Error('CHAT_BRIDGE_SECRET_MISSING');
  // Chat is a same-zone Worker route: global fetch cannot dispatch to it.
  // Keep the signed service API and fail closed rather than send internal
  // evidence through a public-network fallback or the anonymous Chat API.
  const service = bindings.CHAT_SERVICE;
  if (!service || typeof service.fetch !== 'function') throw new Error('CHAT_BRIDGE_SERVICE_BINDING_MISSING');
  const body = JSON.stringify(payload);
  if (new TextEncoder().encode(body).length > 96 * 1024) throw new Error('CHAT_BRIDGE_REQUEST_LIMIT');
  const response = await service.fetch(`${OA_CHAT_ORIGIN}${OA_CHAT_PATH}`, {
    method: 'POST', headers: await signOaChatRequest(body, secret), body,
    // Manual mode works across workerd versions and never follows a Location.
    // The !response.ok guard below rejects every 3xx before reading its body.
    cache: 'no-store', redirect: 'manual', credentials: 'omit', signal: AbortSignal.timeout(timeoutMs),
  });
  if (!response.ok) {
    await response.body?.cancel().catch(() => {});
    throw new Error(`CHAT_BRIDGE_HTTP_${response.status}`);
  }
  if (!response.headers.get('content-type')?.startsWith('application/json') || !response.body) {
    await response.body?.cancel().catch(() => {});
    throw new Error('CHAT_BRIDGE_INVALID_RESPONSE');
  }
  const reader = response.body.getReader(); const parts: Uint8Array[] = []; let length = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read(); if (done) break;
      length += value.length;
      if (length > 96 * 1024) { await reader.cancel(); throw new Error('CHAT_BRIDGE_RESPONSE_LIMIT'); }
      parts.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(length); let offset = 0;
  for (const part of parts) { bytes.set(part, offset); offset += part.length; }
  let data: BridgeResponse;
  try { data = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) as BridgeResponse; }
  catch { throw new Error('CHAT_BRIDGE_INVALID_RESPONSE'); }
  if (!data || data.received !== true) throw new Error('CHAT_BRIDGE_INVALID_RESPONSE');
  return data;
}
export type OaChatStreamOptions = { signal: AbortSignal; onEvent: (event: OaNativeEvent) => void | Promise<void> };
async function bridgeStreaming(payload: object, options: OaChatStreamOptions): Promise<BridgeResponse> {
  const { env } = await import('cloudflare:workers');
  const bindings = env as typeof env & { PUBLIC_LAB_AI_SERVICE_TOKEN?: string; CHAT_SERVICE?: { fetch: typeof fetch } };
  const secret = bindings.PUBLIC_LAB_AI_SERVICE_TOKEN || '';
  if (secret.length < 32) throw new Error('CHAT_BRIDGE_SECRET_MISSING');
  const service = bindings.CHAT_SERVICE;
  if (!service || typeof service.fetch !== 'function') throw new Error('CHAT_BRIDGE_SERVICE_BINDING_MISSING');
  const body = JSON.stringify({ ...payload, stream: true });
  if (new TextEncoder().encode(body).length > 96 * 1024) throw new Error('CHAT_BRIDGE_REQUEST_LIMIT');
  checkStreamAbort(options.signal);
  const signal = AbortSignal.any([options.signal, AbortSignal.timeout(80000)]);
  const response = await service.fetch(`${OA_CHAT_ORIGIN}${OA_CHAT_PATH}`, {
    method: 'POST', headers: { ...await signOaChatRequest(body, secret), accept: 'text/event-stream' }, body,
    cache: 'no-store', redirect: 'manual', credentials: 'omit', signal,
  });
  if (!response.ok) { await response.body?.cancel().catch(() => {}); throw new Error(`CHAT_BRIDGE_HTTP_${response.status}`); }
  // No automatic replay: a broken stream may already have consumed model budget.
  const result = await consumeOaAnswerStream(response, { signal, async onEvent(event) {
    if (event.type !== 'final') await options.onEvent(event);
  } });
  if (result.received !== true || !['ai', 'general'].includes(String(result.mode)) || result.provider !== 'bailian') throw new Error('CHAT_BRIDGE_INVALID_RESPONSE');
  return result as BridgeResponse;
}
function reportBridgeFailure(error: unknown) {
  // Only allowlisted codes are logged. Never log the request, response body,
  // upstream exception text, question, evidence, signature, or service secret.
  const message = error instanceof Error ? error.message : '';
  const allowed = ['CHAT_BRIDGE_SECRET_MISSING', 'CHAT_BRIDGE_SERVICE_BINDING_MISSING',
    'CHAT_BRIDGE_REQUEST_LIMIT', 'CHAT_BRIDGE_RESPONSE_LIMIT', 'CHAT_BRIDGE_INVALID_RESPONSE'];
  const code = allowed.includes(message) || /^CHAT_BRIDGE_HTTP_[1-5]\d{2}$/u.test(message)
    ? message
    : error instanceof Error && ['AbortError', 'TimeoutError'].includes(error.name)
      ? 'CHAT_BRIDGE_TIMEOUT' : 'CHAT_BRIDGE_TRANSPORT_ERROR';
  console.warn('OA_CHAT_BRIDGE_FAILURE', code);
}
function retryableBridgeFailure(error: unknown): boolean {
  if (!(error instanceof Error)) return true;
  if (['AbortError', 'TimeoutError'].includes(error.name)) return true;
  if (error.message === 'CHAT_BRIDGE_TRANSPORT_ERROR') return true;
  const status = error.message.match(/^CHAT_BRIDGE_HTTP_(\d{3})$/u)?.[1];
  return status ? Number(status) === 429 || Number(status) >= 500 : !error.message.startsWith('CHAT_BRIDGE_');
}
async function groundedBridge(payload: object): Promise<BridgeResponse> {
  try { return await bridge(payload, 70000); }
  catch (error) {
    if (!retryableBridgeFailure(error)) throw error;
    return bridge(payload, 70000);
  }
}
export async function oaChatModelStatus() {
  try {
    const result = await bridge({ operation: 'status' }, 12000);
    return { bridgeReady: result.bridgeReady === true, modelReady: result.modelReady === true, budgetReady: result.budgetReady === true };
  } catch { return { bridgeReady: false, modelReady: false, budgetReady: false }; }
}
function imageChunkScore(question: string, chunk: RankedKnowledgeChunk, refs: Map<string, string>): number {
  const haystack = `${chunk.title}\n${chunk.sectionTitle || ''}\n${chunk.content}\n${[...refs.values()].join('\n')}`.normalize('NFKC');
  let score = Math.max(0, ...[...refs.values()].map(alt => knowledgeImageReferenceScore(question, chunk, alt, refs.size)));
  if (/(?:OriginMind|ARTS\s*Robotics|机器人产品|实验平台)/iu.test(haystack)) score += 500;
  if (/(?:实验室|机器人)/u.test(haystack)) score += 120;
  if (/(?:硕士学位论文|博士学位论文|论文封面|公式|示意图)/u.test(haystack)) score -= 500;
  if (refs.size) score += 80;
  const updated = Date.parse(chunk.updatedAt || '');
  if (Number.isFinite(updated)) score += updated / 1e11;
  return score;
}
async function answerImages(question: string, chunks: RankedKnowledgeChunk[], includeRevisionImages = false): Promise<OaChatImage[]> {
  const references = chunks.map(chunk => ({ chunk, refs: relevantKnowledgeImageReferences(question, chunk) }))
    .filter(item => includeRevisionImages || item.refs.size);
  if (!references.length) return [];
  const db = await getDb();
  const hasKinds = requestedKnowledgeImageKinds(question).length > 0;
  type Candidate = { chunk: RankedKnowledgeChunk; refs: Map<string, string>; imageScores: Map<string, number>; assets: Awaited<ReturnType<typeof listKnowledgeRevisionAssets>>; score: number };
  const candidates = new Map<string, Candidate>();
  for (const { chunk, refs } of references) {
    const key = `${chunk.itemId}:${chunk.revisionId}`;
    let candidate = candidates.get(key);
    if (!candidate) {
      const assets = await listKnowledgeRevisionAssets(db.$client, chunk.revisionId);
      if (!assets.some(asset => asset.itemId === chunk.itemId && asset.revisionId === chunk.revisionId)) continue;
      candidate = { chunk, refs: new Map(), imageScores: new Map(), assets, score: -10_000 };
      candidates.set(key, candidate);
    }
    const readyPaths = new Set(candidate.assets.filter(asset => asset.itemId === chunk.itemId && asset.revisionId === chunk.revisionId).map(asset => asset.assetPath));
    const availableRefs = new Map([...refs].filter(([path]) => readyPaths.has(path)));
    if (hasKinds && !availableRefs.size) continue;
    candidate.score = Math.max(candidate.score, imageChunkScore(question, chunk, availableRefs));
    for (const [path, alt] of availableRefs) {
      const score = knowledgeImageReferenceScore(question, chunk, alt, knowledgeImageReferences(chunk.content).size);
      if (!candidate.refs.has(path) || score > (candidate.imageScores.get(path) || 0)) {
        candidate.refs.set(path, alt); candidate.imageScores.set(path, score);
      }
    }
  }
  const selected = [...candidates.values()].filter(candidate => !hasKinds || candidate.refs.size)
    .sort((a, b) => b.score - a.score)[0];
  if (!selected) return [];
  const images: OaChatImage[] = []; const seen = new Set<string>();
  for (const { chunk, refs, imageScores, assets } of [selected]) {
    for (const asset of [...assets].sort((a, b) => (imageScores.get(b.assetPath) || 0) - (imageScores.get(a.assetPath) || 0))) {
      const identity = `${chunk.itemId}:${chunk.revisionId}:${asset.assetPath}`;
      if (asset.itemId !== chunk.itemId || asset.revisionId !== chunk.revisionId || ((!includeRevisionImages || hasKinds) && !refs.has(asset.assetPath)) || seen.has(identity)) continue;
      seen.add(identity);
      images.push({
        url: `/api/knowledge/${encodeURIComponent(chunk.itemId)}/assets/${asset.assetPath.split('/').map(encodeURIComponent).join('/')}?forChat=1&revision=${encodeURIComponent(chunk.revisionId)}`,
        alt: prefix(refs.get(asset.assetPath) || asset.assetPath.split('/').at(-1) || '资料插图', 300), mimeType: asset.mimeType,
      });
      if (images.length >= 4) return images;
    }
  }
  return images;
}
/** Receives only chunks obtained by the authenticated OA route. Browser input
 * cannot set documents, visibility, item IDs or a retrieval capability. */
export async function answerOaChatQuestion(question: string, ranked: RankedKnowledgeChunk[], history: OaChatHistory = [], stream?: OaChatStreamOptions) {
  checkStreamAbort(stream?.signal);
  const imageRequest = questionRequestsKnowledgeImages(question);
  // For image requests, keep a broader text-ranked window so a legacy
  // text-only item cannot mask a newer approved revision with ready assets.
  const chunks = ranked.slice(0, imageRequest ? 12 : 3);
  if (imageRequest && !chunks.length) return { answer: '当前没有找到与你的问题相关、且你有权查看的已审核资料图片。请换一个更具体的名称，或打开 OA 查看。', citations: [], images: [], mode: 'no_evidence', sourceType: 'oa_knowledge_images_unavailable' };
  const generalKnowledge = chunks.length
    ? questionPrefersGeneralKnowledge(question)
    : questionAllowsGeneralKnowledge(question);
  if (generalKnowledge) {
    try {
      const payload = { operation: 'answer', answerType: 'general', question, history: history.slice(-2), documents: [] };
      const result = await (stream ? bridgeStreaming(payload, stream) : bridge(payload, 70000));
      if (result.mode !== 'general' || typeof result.answer !== 'string' || !result.answer.trim() || result.answer.length > 12000 || !result.answer.isWellFormed()) throw new Error('CHAT_BRIDGE_INVALID_ANSWER');
      return { answer: `**来源类型：模型通用知识（未引用 OA 资料）**\n\n${result.answer.trim()}`, citations: [], images: [], mode: 'general', provider: result.provider, sourceType: 'model_general_knowledge' };
    } catch (error) {
      checkStreamAbort(stream?.signal);
      await stream?.onEvent({ type: 'reset' });
      reportBridgeFailure(error);
      return { answer: '这是普通常识问题，但通用知识回答服务暂不可用，请稍后重试。', citations: [], images: [], mode: 'retrieval', fallbackReason: 'general_model_unavailable', sourceType: 'model_general_knowledge' };
    }
  }
  if (!chunks.length) return { answer: questionRequiresKnowledgeEvidence(question) ? '目前知识库没有找到足够依据回答这个内部或项目问题。' : '目前没有足够信息回答这个问题。', citations: [], images: [], mode: 'no_evidence', sourceType: 'oa_knowledge_required' };
  const documents = chunks.map((chunk, index) => ({
    id: String(index + 1), title: prefix(chunk.title, 300), body: prefix(chunk.content, 2200),
    updatedAt: prefix(chunk.updatedAt || '', 40), origin: 'oa_internal',
    assets: [...knowledgeImageReferences(chunk.content).values()].slice(0, 8).map(alt => ({ alt: prefix(alt, 300) })),
  }));
  const citations = chunks.map((chunk, index) => ({ id: String(index + 1), itemId: chunk.itemId, revisionId: chunk.revisionId, title: chunk.title, category: chunk.category, sectionTitle: chunk.sectionTitle, paragraphRef: chunk.paragraphRef, excerpt: prefix(chunk.content, 600) }));
  let images: OaChatImage[] = [];
  let imageLookupFailed = false;
  try { images = await answerImages(question, chunks, imageRequest); } catch { imageLookupFailed = true; /* Keep ordinary text answers available. */ }
  if (imageRequest) {
    if (imageLookupFailed) return { answer: '资料图片暂时无法查询，请稍后重试或打开 OA 查看。', citations, images: [], mode: 'retrieval', sourceType: 'oa_knowledge_images_unavailable' };
    if (images.length) return { answer: `已找到 ${images.length} 张与问题相关的已审核资料图片，显示如下。`, citations, images, mode: 'ai', sourceType: 'oa_knowledge_images' };
    return { answer: '已找到相关文字资料，但当前已审核版本没有可展示的图片。请由管理员在知识资料中补充图片并完成审核后再试。', citations, images: [], mode: 'no_evidence', sourceType: 'oa_knowledge_images_unavailable' };
  }
  let result: BridgeResponse;
  try {
    const payload = { operation: 'answer', answerType: 'grounded', question, history: history.slice(-2), documents };
    result = await (stream ? bridgeStreaming(payload, stream) : groundedBridge(payload));
  }
  catch (error) {
    checkStreamAbort(stream?.signal);
    await stream?.onEvent({ type: 'reset' });
    reportBridgeFailure(error);
    return { answer: '已检索到相关资料，但问答服务暂未能生成完整答复，请稍后重试。', citations: [], images: [], mode: 'retrieval', fallbackReason: 'shared_model_unavailable' };
  }
  if (typeof result.answer !== 'string' || !result.answer.trim() || result.answer.length > 12000 || !result.answer.isWellFormed()) throw new Error('CHAT_BRIDGE_INVALID_ANSWER');
  return { answer: result.answer, citations, images, mode: result.mode, provider: result.provider, fallbackReason: result.fallbackReason };
}

/** Task material is supplied by the admitted task owner, not claimed as approved knowledge. */
export async function generateOaTask(input: { kind: string; title: string; instruction: string; material: string }): Promise<string> {
  const result = await bridge({ operation: 'task', task: input }, 70000);
  if (result.mode !== 'task' || typeof result.answer !== 'string' || !result.answer.trim()) throw new Error('TASK_MODEL_UNAVAILABLE');
  return result.answer;
}
