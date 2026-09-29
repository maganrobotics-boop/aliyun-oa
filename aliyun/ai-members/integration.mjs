import { createHash } from 'node:crypto';
import { request as httpRequest } from 'node:http';
import { AiMemberStore, createAiMembersHandler, PREFIX } from './ai-members.mjs';

const MAX_REQUEST = 384 * 1024;
const AI_UA = 'OriginMind-AI-Member/1.0';
const digest = value => createHash('sha256').update(value).digest('hex');

export function publicQuestionRequest(origin, question, { persona, history = [], signal, stream = false } = {}) {
  if (origin !== 'https://chat.omindos.cn' || typeof question !== 'string' || !question.trim() || question.length > 12000) {
    throw new Error('Invalid public question');
  }
  const messages = [];
  if (persona) {
    const labels = { research_assistant: '助研', teaching_assistant: '助教', senior_practice: '学长', senior_review: '学姐' };
    const name = labels[persona.role];
    if (!name || persona.actorType !== 'ai_member') throw new Error('Invalid AI persona');
    messages.push({ role: 'user', content: `你是 OriginMind × ARTS Robotics 的${name}，明确标注为 AI 成员。只回答当前提供的问题和公开课程资料。不要声称已运行代码、上传、审批或完成未提供真实记录的任务；你现在只提供对话和建议，没有这些操作工具。审批建议与负责人批准分开表述。不编造真人经历、内部资料或其他用户的对话。` });
  }
  for (const item of history.slice(-6)) {
    if (['user', 'assistant'].includes(item.role) && typeof item.content === 'string' && item.content.length <= 12000) messages.push({ role: item.role, content: item.content });
  }
  messages.push({ role: 'user', content: question });
  // Build fresh headers: an OA/AI cookie or internal knowledge credential is never forwarded.
  return new Request(`${origin}/api/chat`, {
    method: 'POST', headers: { 'content-type': 'application/json', origin, 'user-agent': AI_UA, ...(stream ? { accept: 'text/event-stream' } : {}) },
    body: JSON.stringify({ topic: 'student', messages }), signal,
  });
}

function verifiedPublicAnswer(data) {
  if (!data || typeof data.answer !== 'string' || !data.answer.trim() || data.answer.length > 60000) throw new Error('Assistant did not return a bounded answer');
  if (data.fallbackReason || data.mode === 'retrieval') throw Object.assign(new Error('模型答复未通过完整性或资料引用校验，请重新生成。'), { code: 'MODEL_VALIDATION_FAILED' });
  if (data.provider !== 'bailian') throw new Error('Aliyun model response was not confirmed');
  return { answer: data.answer, provider: data.provider, mode: data.mode,
    sources: Array.isArray(data.sources) ? data.sources.map(s => ({ title: String(s?.title || '').slice(0, 300), url: typeof s?.url === 'string' ? s.url.slice(0, 2000) : undefined })).slice(0, 20) : [] };
}

// Consume the existing Aliyun /api/chat protocol. Deltas are provisional text only;
// success requires the server's validated final payload and a clean stream end.
export async function publicAnswer(response, { onEvent, signal } = {}) {
  if (!response.ok) throw new Error(`Public assistant HTTP ${response.status}`);
  const reader = response.body?.getReader();
  if (!reader) throw new Error('Assistant response has no body');
  const streamed = (response.headers.get('content-type') || '').toLowerCase().startsWith('text/event-stream');
  const decoder = new TextDecoder('utf-8', { fatal: true });
  let bytes = 0, buffer = '', final = null, draftLength = 0, frames = 0;
  const abort = () => { void reader.cancel().catch(() => {}); };
  signal?.addEventListener('abort', abort, { once: true });
  const consume = async frame => {
    if (++frames > 4096) throw new Error('Assistant sent too many events');
    const payload = frame.split('\n').filter(line => line.startsWith('data:')).map(line => line.slice(5).trimStart()).join('\n');
    if (!payload) return;
    const event = JSON.parse(payload);
    if (!event || typeof event !== 'object') throw new Error('Invalid assistant event');
    if (event.type === 'error') throw new Error('Assistant stream failed');
    if (event.type === 'final') {
      if (final) throw new Error('Duplicate assistant final');
      final = verifiedPublicAnswer(event.data);
      return;
    }
    if (final && ['delta', 'reset'].includes(event.type)) throw new Error('Assistant changed its final answer');
    if (event.type === 'delta') {
      if (typeof event.delta !== 'string') throw new Error('Invalid assistant delta');
      draftLength += event.delta.length;
      if (draftLength > 60000) throw new Error('Assistant draft too large');
      if (event.delta) await onEvent?.({ type: 'delta', text: event.delta });
    } else if (event.type === 'reset') {
      draftLength = 0; await onEvent?.({ type: 'reset' });
    } else if (event.type === 'status') await onEvent?.({ type: 'status' });
    // Reasoning, credentials, learning records and other users' metadata are never forwarded.
  };
  try {
    signal?.throwIfAborted();
    while (true) {
      const item = await reader.read();
      signal?.throwIfAborted();
      if (item.done) break;
      bytes += item.value.byteLength;
      if (bytes > (streamed ? 256 * 1024 : 160000)) throw new Error('Assistant response too large');
      buffer += decoder.decode(item.value, { stream: true });
      if (streamed) {
        let boundary;
        while ((boundary = /\r?\n\r?\n/u.exec(buffer))) {
          await consume(buffer.slice(0, boundary.index).replaceAll('\r\n', '\n'));
          buffer = buffer.slice(boundary.index + boundary[0].length);
        }
        if (buffer.length > 160000) throw new Error('Assistant event too large');
      }
    }
    buffer += decoder.decode();
    if (!streamed) return verifiedPublicAnswer(JSON.parse(buffer));
    if (buffer.trim()) await consume(buffer.replaceAll('\r\n', '\n'));
    if (!final) throw new Error('Assistant stream ended without confirmed final');
    return final;
  } catch (error) {
    await reader.cancel().catch(() => {});
    throw error;
  } finally {
    signal?.removeEventListener('abort', abort);
    reader.releaseLock();
  }
}

// node:http preserves Host on loopback; Node 24's native fetch does not.
// The destination and trusted proxy headers are fixed, never request-derived.
const OA_SESSION_MAX_BYTES = 64 * 1024;

function nativeOaSessionBody(port, headers, signal) {
  return new Promise((resolve, reject) => {
    const outgoing = httpRequest({
      hostname: '127.0.0.1', port, path: '/api/session', method: 'GET',
      headers, signal, agent: false, maxHeaderSize: 16 * 1024,
    }, incoming => {
      const fail = () => { incoming.destroy(); reject(new Error('OA session response rejected')); };
      if (incoming.statusCode < 200 || incoming.statusCode >= 300 ||
        Number(incoming.headers['content-length']) > OA_SESSION_MAX_BYTES) { fail(); return; }
      const chunks = []; let bytes = 0;
      incoming.on('data', chunk => {
        bytes += chunk.length;
        if (bytes > OA_SESSION_MAX_BYTES) { fail(); return; }
        chunks.push(chunk);
      });
      incoming.once('aborted', fail);
      incoming.once('error', fail);
      incoming.once('end', () => {
        if (!incoming.complete) { fail(); return; }
        resolve(Buffer.concat(chunks, bytes));
      });
    });
    outgoing.once('error', () => reject(new Error('OA session request failed')));
    outgoing.end();
  });
}

async function injectedOaSessionBody(port, options, fetchImpl) {
  const response = await fetchImpl(`http://127.0.0.1:${port}/api/session`, options);
  if (!response.ok || Number(response.headers.get('content-length')) > OA_SESSION_MAX_BYTES) {
    await response.body?.cancel().catch(() => {});
    throw new Error('OA session response rejected');
  }
  const reader = response.body?.getReader();
  if (!reader) throw new Error('OA session response is empty');
  const cancel = () => { void reader.cancel().catch(() => {}); };
  options.signal.addEventListener('abort', cancel, { once: true });
  const chunks = []; let bytes = 0;
  try {
    options.signal.throwIfAborted();
    while (true) {
      const item = await reader.read();
      options.signal.throwIfAborted();
      if (item.done) break;
      bytes += item.value.byteLength;
      if (bytes > OA_SESSION_MAX_BYTES) throw new Error('OA session response rejected');
      chunks.push(Buffer.from(item.value));
    }
    return Buffer.concat(chunks, bytes);
  } finally {
    options.signal.removeEventListener('abort', cancel);
    void reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

async function readOaSession(port, cookie, incomingSignal, fetchImpl) {
  const controller = new AbortController();
  const abort = () => controller.abort();
  let rejectAborted;
  const aborted = new Promise((_, reject) => {
    rejectAborted = () => reject(new Error('OA session verification aborted'));
    controller.signal.addEventListener('abort', rejectAborted, { once: true });
  });
  // One deadline covers connection, response headers and the complete body.
  const deadline = setTimeout(abort, 8000);
  incomingSignal?.addEventListener('abort', abort, { once: true });
  if (incomingSignal?.aborted) abort();
  const options = {
    method: 'GET', redirect: 'error', signal: controller.signal,
    headers: { host: 'oa.omindos.cn', 'x-forwarded-host': 'oa.omindos.cn',
      'x-forwarded-proto': 'https', accept: 'application/json', cookie },
  };
  try {
    const body = await Promise.race([
      fetchImpl ? injectedOaSessionBody(port, options, fetchImpl)
        : nativeOaSessionBody(port, options.headers, controller.signal),
      aborted,
    ]);
    controller.signal.throwIfAborted();
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(body));
  } finally {
    clearTimeout(deadline);
    incomingSignal?.removeEventListener('abort', abort);
    controller.signal.removeEventListener('abort', rejectAborted);
    controller.abort();
  }
}


export function createOaMemberVerifier({ port, fetchImpl }) {
  if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('Invalid OA port');
  return async request => {
    const cookie = request.headers.get('cookie');
    if (!cookie || cookie.length > 16384) return null;
    let value;
    try { value = await readOaSession(port, cookie, request.signal, fetchImpl); }
    catch { return null; }
    if (!value || typeof value !== 'object') return null;
    // Reuse OA's existing server-verified administrator bootstrap exception.
    // Ordinary members still require NDA admission; no request-supplied role is trusted.
    if (value.registered !== true || value.status !== 'active' ||
      (value.ndaCompleted !== true && value.isAdmin !== true) ||
      typeof value.user?.email !== 'string' || !value.user.email) return null;
    return { id: `oa-member:${digest(value.user.email.toLowerCase())}`, actorType: 'human', admitted: true,
      displayName: String(value.user.displayName || 'OA 成员'), isAdmin: value.isAdmin === true };
  };
}

export function createIntegration({ audience, databasePath, origin, courses, courseVersion, worker, env, port, fetchImpl }) {
  const store = new AiMemberStore(databasePath, { fileMode: 0o660 });
  const verifyMember = audience === 'oa' ? createOaMemberVerifier({ port, fetchImpl }) : async () => null;
  const verifyAdmin = async request => {
    const value = await verifyMember(request);
    return value?.isAdmin === true ? value : null;
  };
  const publicAsk = async (question, options = {}) => {
    const publicRequest = publicQuestionRequest('https://chat.omindos.cn', question, { ...options, stream: typeof options.onEvent === 'function' });
    if (audience === 'chat') {
      const background = [];
      const response = await worker.fetch(publicRequest, env, {
        originmindActorType: 'ai_member', waitUntil(promise) { background.push(Promise.resolve(promise)); },
        passThroughOnException() {},
      });
      const answer = await publicAnswer(response, options);
      if (background.length) void Promise.allSettled(background);
      return answer;
    }
    // Fixed loopback destination. Only a public question is sent, without incoming cookies.
    const response = await (fetchImpl || fetch)('http://127.0.0.1:3001/api/chat', {
      method: 'POST', redirect: 'error', signal: options.signal ? AbortSignal.any([options.signal, AbortSignal.timeout(90000)]) : AbortSignal.timeout(90000),
      headers: Object.fromEntries(publicRequest.headers), body: await publicRequest.text(),
    });
    return publicAnswer(response, options);
  };
  return { store, handle: createAiMembersHandler({ store, audience, origin, courses, courseVersion,
    verifyMember, verifyAdmin, publicAsk }) };
}

export function isAiMemberPath(target) {
  if (typeof target !== 'string') return false;
  const pathname = target.split('?', 1)[0];
  return pathname === PREFIX || pathname.startsWith(`${PREFIX}/`);
}

export async function incomingAiRequest(incoming, origin, { signal } = {}) {
  const headers = new Headers();
  for (const [name, value] of Object.entries(incoming.headers)) {
    if (Array.isArray(value)) value.forEach(item => headers.append(name, item));
    else if (value !== undefined) headers.set(name, value);
  }
  let body;
  if (!['GET', 'HEAD'].includes(incoming.method || 'GET')) {
    const chunks = []; let size = 0;
    for await (const chunk of incoming) {
      size += chunk.length;
      if (size > MAX_REQUEST) { const error = new Error('AI request too large'); error.statusCode = 413; throw error; }
      chunks.push(chunk);
    }
    body = Buffer.concat(chunks);
  }
  return new Request(new URL(incoming.url, origin), { method: incoming.method, headers, body, signal });
}

// Tie fetch cancellation to a dropped HTTP response, not IncomingMessage.close
// (which also fires normally when a POST body finishes).
export function requestCancellation(incoming, outgoing) {
  const controller = new AbortController();
  const onAbort = () => controller.abort(new Error('HTTP client disconnected'));
  const onClose = () => { if (!outgoing.writableFinished) onAbort(); };
  incoming.once('aborted', onAbort);
  outgoing.once('close', onClose);
  if (incoming.aborted || outgoing.destroyed) onAbort();
  return { signal: controller.signal, cleanup() {
    incoming.removeListener('aborted', onAbort); outgoing.removeListener('close', onClose);
  } };
}

export async function sendAiResponse(outgoing, response) {
  const headers = Object.fromEntries(response.headers);
  const cookies = response.headers.getSetCookie?.() || [];
  if (cookies.length) headers['set-cookie'] = cookies;
  outgoing.writeHead(response.status, headers);
  outgoing.flushHeaders?.();
  if (!response.body) { outgoing.end(); return; }
  const reader = response.body.getReader();
  const onClose = () => { if (!outgoing.writableFinished) void reader.cancel().catch(() => {}); };
  outgoing.once('close', onClose);
  try {
    while (!outgoing.destroyed) {
      const { done, value } = await reader.read();
      if (done || outgoing.destroyed) break;
      if (!outgoing.write(Buffer.from(value))) await new Promise((resolve, reject) => {
        const cleanup = () => { outgoing.removeListener('drain', onDrain); outgoing.removeListener('close', onDropped); outgoing.removeListener('error', onError); };
        const onDrain = () => { cleanup(); resolve(); };
        const onDropped = () => { cleanup(); reject(new Error('HTTP client disconnected')); };
        const onError = () => { cleanup(); reject(new Error('HTTP response failed')); };
        outgoing.once('drain', onDrain); outgoing.once('close', onDropped); outgoing.once('error', onError);
        if (outgoing.destroyed) onDropped();
      });
    }
    if (!outgoing.destroyed) outgoing.end();
  } catch (error) {
    await reader.cancel().catch(() => {});
    throw error;
  } finally {
    outgoing.removeListener('close', onClose);
    if (outgoing.destroyed) await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
