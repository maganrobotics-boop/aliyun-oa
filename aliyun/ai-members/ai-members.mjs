// Aliyun Node-only, additive AI identities. No imports from human authentication.
import { DatabaseSync } from 'node:sqlite';
import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { chmodSync, mkdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

export const PREFIX = '/api/ai-members';
export const ADMISSION_VERSION = 'public-courses-own-test-materials-v1';
const AUDIENCES = new Set(['chat', 'oa']);
const MAX_BODY = 384 * 1024;
const MAX_ARTIFACT = 256 * 1024;
const MAX_MEMBER_BYTES = 8 * 1024 * 1024;
const MAX_ARTIFACTS = 128;
const SESSION_MS = 30 * 60 * 1000;
const hash = (value) => createHash('sha256').update(value).digest('hex');
const token = () => randomBytes(32).toString('hex');
const id = () => randomUUID();
const fail = (status, message) => { throw new HttpError(status, message); };
class HttpError extends Error { constructor(status, message) { super(message); this.status = status; } }
const json = (data, status = 200, extra = {}) => Response.json(data, { status, headers: {
  'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer', ...extra,
}});
const wantsEventStream = request => (request.headers.get('accept') || '').split(',')
  .some(value => value.trim().split(';', 1)[0] === 'text/event-stream');

// The response owns the in-flight call. Closing it cancels generation; it never retries.
function answerEventStream(request, meta, run, onFailure) {
  const cancellation = new AbortController();
  const signal = AbortSignal.any([request.signal, cancellation.signal]);
  const encoder = new TextEncoder();
  let closed = false;
  const body = new ReadableStream({
    start(controller) {
      const emit = (type, value) => {
        if (closed || signal.aborted) return;
        controller.enqueue(encoder.encode(`event: ${type}\ndata: ${JSON.stringify(value)}\n\n`));
      };
      emit('meta', meta);
      emit('status', { message: '正在生成回答…' });
      const heartbeat = setInterval(() => {
        if (!closed && !signal.aborted) controller.enqueue(encoder.encode(': keep-alive\n\n'));
      }, 15000);
      heartbeat.unref?.();
      void (async () => {
        try {
          const result = await run({ signal, onEvent: event => {
            if (event.type === 'delta') emit('delta', { text: event.text });
            else if (event.type === 'reset') emit('reset', { message: '正在校验并生成完整回答…' });
            else if (event.type === 'status') emit('status', { message: '正在生成回答…' });
          } });
          emit('done', result);
        } catch (error) {
          const failure = onFailure(error);
          emit('error', failure);
        } finally {
          clearInterval(heartbeat);
          if (!closed) { closed = true; controller.close(); }
        }
      })();
    },
    cancel() { closed = true; cancellation.abort(new Error('Client stopped receiving answer')); },
  });
  return new Response(body, { headers: {
    'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-store, no-transform',
    'X-Accel-Buffering': 'no', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer',
  } });
}

function text(value, max, field, min = 0) {
  if (typeof value !== 'string' || value.length < min || value.length > max || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(value)) fail(400, `${field}不正确`);
  return value.trim();
}
function fields(input, allowed, required = []) {
  if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).some(k => !allowed.includes(k)) || required.some(k => !(k in input))) fail(400, '请求字段不正确');
  return input;
}
function requestKey(request) {
  const key = request.headers.get('idempotency-key');
  if (!key || !/^[a-zA-Z0-9_.:-]{8,120}$/u.test(key)) fail(400, '请提供有效的幂等标识');
  return key;
}
async function inputJson(request) {
  if (!(request.headers.get('content-type') || '').toLowerCase().startsWith('application/json')) fail(415, '仅接受 JSON 请求');
  if (Number(request.headers.get('content-length')) > MAX_BODY) fail(413, '请求内容过长');
  const reader = request.body?.getReader();
  if (!reader) fail(400, '请求正文缺失');
  const chunks = []; let total = 0;
  while (true) {
    const item = await reader.read();
    if (item.done) break;
    total += item.value.byteLength;
    if (total > MAX_BODY) { await reader.cancel(); fail(413, '请求内容过长'); }
    chunks.push(Buffer.from(item.value));
  }
  try { return JSON.parse(Buffer.concat(chunks, total).toString('utf8')); }
  catch { fail(400, 'JSON 内容不正确'); }
}
function assertAudience(value) { if (!AUDIENCES.has(value)) throw new Error('Invalid AI audience'); }
function validAgentId(value) { return typeof value === 'string' && /^[a-z][a-z0-9-]{2,63}$/u.test(value); }
function secureEqual(left, right) {
  return timingSafeEqual(Buffer.from(left, 'hex'), Buffer.from(right, 'hex'));
}
function publicMember(row) {
  return { id: row.id, actorType: 'ai_member', displayName: row.display_name,
    ownerRef: row.owner_ref, enabled: Boolean(row.enabled),
    admission: { type: 'ai_authorization', version: row.admission_version,
      scope: 'public_courses_and_own_test_materials' },
    role: 'ai_learner', humanEmailVerified: false, humanAgreementSigned: false,
    capabilities: ['public_courses:read', 'profile:self', 'course_evidence:self', 'test_materials:self', 'audit:self'],
  };
}
function artifactMetadata(row) {
  return { id: row.id, name: row.name, kind: row.kind, byteSize: row.byte_size,
    sha256: row.sha256, audience: row.audience, createdAt: row.created_at,
    visibility: 'owner', origin: 'ai_training', archiveStatus: 'draft',
    downloadUrl: `${PREFIX}/artifacts/${row.id}/download` };
}
function submissionView(row) {
  return { id: row.id, courseId: row.course_id, courseVersion: row.course_version,
    outcome: row.outcome, executionKind: row.execution_kind, summary: row.summary,
    artifactIds: JSON.parse(row.artifact_ids), createdAt: row.created_at,
    reviewedAt: row.reviewed_at, reviewerRef: row.reviewer_ref, reviewNote: row.review_note,
    hardwareExecuted: false };
}

export class AiMemberStore {
  constructor(filename, { now = () => Date.now(), sharedGroup = false, fileMode = sharedGroup ? 0o660 : 0o600 } = {}) {
    if (![0o600, 0o660].includes(fileMode)) throw new Error('AI database mode must be 0600 or 0660');
    if (filename !== ':memory:') {
      if (!path.isAbsolute(filename)) throw new Error('AI database path must be absolute');
      mkdirSync(path.dirname(filename), { recursive: true, mode: 0o700 });
    }
    this.db = new DatabaseSync(filename);
    const setModeIfOwner = file => {
      // Shared OA/Chat DB: a second group-authorized process must not chmod another owner's file.
      try { const info = statSync(file); if (!process.getuid || info.uid === process.getuid()) chmodSync(file, fileMode); }
      catch (error) { if (error.code !== 'ENOENT') throw error; }
    };
    if (filename !== ':memory:') setModeIfOwner(filename);
    this.db.exec('PRAGMA busy_timeout=5000; PRAGMA journal_mode=WAL;');
    this.db.exec(readFileSync(new URL('./schema.sql', import.meta.url), 'utf8'));
    if (filename !== ':memory:') for (const file of [filename, `${filename}-wal`, `${filename}-shm`]) setModeIfOwner(file);
    this.now = now;
  }
  close() { this.db.close(); }
  atomic(fn) {
    this.db.exec('BEGIN IMMEDIATE');
    try { const result = fn(); this.db.exec('COMMIT'); return result; }
    catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }
  audit(agentId, audience, event, targetId = null, details = {}) {
    // Call sites pass only server-generated, bounded metadata; never input bodies or credentials.
    this.db.prepare('INSERT INTO ai_audit(agent_id,audience,event,target_id,details,created_at) VALUES(?,?,?,?,?,?)')
      .run(agentId, audience, event, targetId, JSON.stringify(details), this.now());
  }
  // Local control-plane method only. Not exposed as an HTTP route.
  provision({ agentId, displayName, ownerRef }) {
    if (!validAgentId(agentId)) fail(400, 'AI 成员标识不正确');
    displayName = text(displayName, 80, '显示名称', 1);
    ownerRef = text(ownerRef, 160, '负责人标识', 1);
    if (!displayName || !ownerRef) fail(400, '显示名称和负责人不能为空');
    return this.atomic(() => {
      if (this.db.prepare('SELECT id FROM ai_members WHERE id=?').get(agentId)) fail(409, 'AI 成员已经存在');
      this.db.prepare('INSERT INTO ai_members(id,display_name,owner_ref,admission_version,created_at) VALUES(?,?,?,?,?)')
        .run(agentId, displayName, ownerRef, ADMISSION_VERSION, this.now());
      this.db.prepare('INSERT INTO ai_profiles(agent_id,updated_at) VALUES(?,?)').run(agentId, this.now());
      const credentials = {};
      for (const audience of AUDIENCES) {
        credentials[audience] = token();
        this.db.prepare('INSERT INTO ai_credentials(agent_id,audience,token_hash) VALUES(?,?,?)')
          .run(agentId, audience, hash(credentials[audience]));
      }
      this.audit(agentId, 'control', 'member.provisioned', agentId, { admissionVersion: ADMISSION_VERSION });
      return { member: publicMember(this.db.prepare('SELECT * FROM ai_members WHERE id=?').get(agentId)), credentials };
    });
  }
  // Disabling revokes both audiences. Re-enablement, if added later, must not restore sessions.
  disable(agentId, operatorRef) {
    operatorRef = text(operatorRef, 160, '操作人', 1);
    if (!operatorRef) fail(400, '操作人不能为空');
    return this.atomic(() => {
      const result = this.db.prepare('UPDATE ai_members SET enabled=0,disabled_at=? WHERE id=?').run(this.now(), agentId);
      if (!result.changes) fail(404, '成员不存在');
      this.db.prepare('DELETE FROM ai_sessions WHERE agent_id=?').run(agentId);
      this.audit(agentId, 'control', 'member.disabled', agentId, { operatorRef });
    });
  }
  rate(bucket, maximum, duration) {
    this.atomic(() => {
      const now = this.now();
      this.db.prepare('DELETE FROM ai_rate_limits WHERE expires_at<=?').run(now);
      const row = this.db.prepare('SELECT hits FROM ai_rate_limits WHERE bucket=?').get(bucket);
      if (row && row.hits >= maximum) fail(429, '请求过于频繁，请稍后再试');
      this.db.prepare('INSERT INTO ai_rate_limits(bucket,hits,expires_at) VALUES(?,1,?) ON CONFLICT(bucket) DO UPDATE SET hits=hits+1')
        .run(bucket, now + duration);
    });
  }
  login(agentId, suppliedToken, audience, peer) {
    assertAudience(audience);
    if (!validAgentId(agentId) || typeof suppliedToken !== 'string' || !/^[a-f0-9]{64}$/u.test(suppliedToken)) fail(401, 'AI 身份凭据无效');
    this.rate(`login-peer:${audience}:${hash(peer)}`, 30, 15 * 60 * 1000);
    this.rate(`login-id:${audience}:${agentId}`, 10, 15 * 60 * 1000);
    const member = this.db.prepare('SELECT m.*,c.token_hash,c.version FROM ai_members m JOIN ai_credentials c ON c.agent_id=m.id WHERE m.id=? AND c.audience=?').get(agentId, audience);
    const matches = secureEqual(hash(suppliedToken), member?.token_hash || '0'.repeat(64));
    if (!member || !member.enabled || !matches || member.admission_version !== ADMISSION_VERSION) fail(401, 'AI 身份凭据无效');
    return this.atomic(() => {
      const stillActive = this.db.prepare('SELECT m.enabled,c.version FROM ai_members m JOIN ai_credentials c ON c.agent_id=m.id WHERE m.id=? AND c.audience=?').get(agentId, audience);
      if (!stillActive?.enabled || stillActive.version !== member.version) fail(401, 'AI 身份凭据无效');
      this.db.prepare('DELETE FROM ai_sessions WHERE expires_at<=?').run(this.now());
      const sessionToken = token();
      this.db.prepare('INSERT INTO ai_sessions(token_hash,agent_id,audience,credential_version,created_at,expires_at) VALUES(?,?,?,?,?,?)')
        .run(hash(sessionToken), agentId, audience, member.version, this.now(), this.now() + SESSION_MS);
      this.audit(agentId, audience, 'session.login');
      return { sessionToken, member: publicMember(member), expiresAt: this.now() + SESSION_MS };
    });
  }
  authenticate(rawToken, audience) {
    if (typeof rawToken !== 'string' || !/^[a-f0-9]{64}$/u.test(rawToken)) fail(401, '请使用独立 AI 身份登录');
    const member = this.db.prepare(`SELECT m.*,s.token_hash AS session_hash FROM ai_sessions s
      JOIN ai_members m ON m.id=s.agent_id JOIN ai_credentials c ON c.agent_id=s.agent_id AND c.audience=s.audience
      WHERE s.token_hash=? AND s.audience=? AND s.expires_at>? AND m.enabled=1 AND s.credential_version=c.version`)
      .get(hash(rawToken), audience, this.now());
    if (!member || member.admission_version !== ADMISSION_VERSION) fail(401, 'AI 会话已失效');
    return member;
  }
  assertActiveSession(member, audience) {
    const row = this.db.prepare(`SELECT 1 AS ok FROM ai_sessions s JOIN ai_members m ON m.id=s.agent_id
      JOIN ai_credentials c ON c.agent_id=s.agent_id AND c.audience=s.audience
      WHERE s.token_hash=? AND s.agent_id=? AND s.audience=? AND s.expires_at>? AND m.enabled=1
      AND m.admission_version=? AND s.credential_version=c.version`)
      .get(member.session_hash, member.id, audience, this.now(), ADMISSION_VERSION);
    if (!row) fail(401, 'AI 会话已失效');
  }
  profile(agentId) {
    const row = this.db.prepare('SELECT direction,goal,bio,updated_at FROM ai_profiles WHERE agent_id=?').get(agentId);
    return { direction: row.direction, goal: row.goal, bio: row.bio, updatedAt: row.updated_at };
  }
  artifact(agentId, artifactId, audience) {
    return this.db.prepare('SELECT * FROM ai_artifacts WHERE id=? AND agent_id=? AND audience=?').get(artifactId, agentId, audience);
  }
  submissions(agentId) {
    return this.db.prepare('SELECT * FROM ai_submissions WHERE agent_id=? ORDER BY created_at DESC,id DESC').all(agentId);
  }
  // No HTTP review route. Integration must first authorize a real human reviewer.
  reviewByAuthorizedOperator({ submissionId, reviewerRef, decision, note }) {
    reviewerRef = text(reviewerRef, 160, '审批人', 1);
    note = text(note, 2000, '审核依据', 1);
    if (!reviewerRef || !note || !['accepted', 'needs_revision'].includes(decision)) fail(400, '审核信息不完整');
    return this.atomic(() => {
      const submission = this.db.prepare('SELECT * FROM ai_submissions WHERE id=?').get(submissionId);
      if (!submission) fail(404, '提交不存在');
      if (submission.outcome !== 'submitted') fail(409, '该提交已经处理');
      if (reviewerRef === submission.agent_id || this.db.prepare('SELECT id FROM ai_members WHERE id=?').get(reviewerRef)) fail(403, 'AI 成员不能终审');
      this.db.prepare('UPDATE ai_submissions SET outcome=?,reviewer_ref=?,review_note=?,reviewed_at=? WHERE id=?')
        .run(decision, reviewerRef, note, this.now(), submissionId);
      this.audit(submission.agent_id, 'control', 'submission.reviewed', submissionId, { decision, reviewerRef });
    });
  }
}

export function createAiMembersHandler({ store, audience, origin, courses, courseVersion,
  verifyAdmin = async () => null, verifyMember = null, publicAsk = null, directory = [
    { id: 'ai-research', role: 'research_assistant', displayName: '助研 · AI' },
    { id: 'ai-tutor', role: 'teaching_assistant', displayName: '助教 · AI' },
    { id: 'ai-senior-01', role: 'senior_practice', displayName: '学长 · AI' },
    { id: 'ai-senior-02', role: 'senior_review', displayName: '学姐 · AI' },
  ] }) {
  assertAudience(audience);
  if (!(store instanceof AiMemberStore)) throw new Error('Expected AI member store');
  if (new URL(origin).origin !== origin || !origin.startsWith('https://')) throw new Error('Expected exact HTTPS public origin');
  if (!Array.isArray(courses) || !courses.length || new Set(courses.map(c => c.id)).size !== courses.length ||
      courses.some(c => !/^[a-z0-9-]{1,80}$/u.test(c.id) || typeof c.title !== 'string') || !courseVersion) throw new Error('Explicit public course snapshot required');
  // Caller supplies only a reviewed public snapshot, never arbitrary internal objects.
  const publicCourses = courses.map(c => ({ id: c.id, title: c.title,
    goal: String(c.goal || ''), deliverables: Array.isArray(c.deliverables) ? c.deliverables.map(String) : [] }));
  const cookieName = `__Host-om_ai_${audience}`;
  const adminIdentity = async request => {
    const principal = await verifyAdmin(request);
    if (!principal || principal.isAdmin !== true || principal.actorType !== 'human' ||
      typeof principal.id !== 'string' || !principal.id || store.db.prepare('SELECT id FROM ai_members WHERE id=?').get(principal.id)) return null;
    return { id: principal.id };
  };
  const memberIdentity = async request => {
    if (typeof verifyMember !== 'function') return null;
    const principal = await verifyMember(request);
    if (!principal || principal.actorType !== 'human' || principal.admitted !== true ||
      typeof principal.id !== 'string' || !principal.id || store.db.prepare('SELECT id FROM ai_members WHERE id=?').get(principal.id)) return null;
    return { id: principal.id };
  };
  const runPublicAsk = async (question, context) => {
    const signal = AbortSignal.any([AbortSignal.timeout(90000), ...(context.signal ? [context.signal] : [])]);
    signal.throwIfAborted();
    let onAbort;
    const aborted = new Promise((_, reject) => { onAbort = () => reject(new Error('Public answer interrupted')); signal.addEventListener('abort', onAbort, { once: true }); });
    let result;
    try { result = await Promise.race([publicAsk(question, Object.fromEntries(Object.entries({ ...context, signal }).filter(([, value]) => value !== undefined))), aborted]); }
    finally { signal.removeEventListener('abort', onAbort); }
    signal.throwIfAborted();
    if (!result || typeof result.answer !== 'string' || !result.answer.trim() || result.answer.length > 60000) throw new Error('Invalid public answer');
    return result;
  };
  const turnMessages = row => {
    const failure = row.state === 'unknown' ? store.db.prepare('SELECT code,message FROM ai_conversation_failures WHERE turn_id=?').get(row.id) : null;
    const resultState = failure ? 'failed' : row.state;
    return [
    { id: `${row.id}:user`, role: 'user', content: row.question, createdAt: row.created_at, state: resultState, ...(failure ? { error: failure.message, retryable: true } : {}) },
    ...(row.answer ? [{ id: `${row.id}:assistant`, role: 'assistant', content: row.answer, createdAt: row.finished_at, state: row.state }] : []),
  ];
  };
  const readAudit = (agentId, url, includeHumanConversations = false) => {
    const after = Number(url.searchParams.get('after') || 0);
    if (!Number.isSafeInteger(after) || after < 0) fail(400, '时间线位置不正确');
    const rows = store.db.prepare(`SELECT seq,audience,event,target_id,details,created_at FROM ai_audit WHERE agent_id=? AND seq>?
      ${includeHumanConversations ? '' : "AND event NOT LIKE 'conversation.%'"} ORDER BY seq LIMIT 101`).all(agentId, after);
    const events = rows.slice(0, 100).map(row => ({ seq: row.seq, audience: row.audience, event: row.event, targetId: row.target_id, details: JSON.parse(row.details), createdAt: row.created_at }));
    return { events, hasMore: rows.length > 100, nextAfter: events.at(-1)?.seq || after };
  };
  const cookie = (value, maxAge) => `${cookieName}=${value}; Path=/; Secure; HttpOnly; SameSite=Strict; Max-Age=${maxAge}`;
  const authCookie = request => {
    const found = (request.headers.get('cookie') || '').split(';').map(s => s.trim()).filter(s => s.startsWith(`${cookieName}=`));
    if (found.length !== 1) return '';
    return found[0].slice(cookieName.length + 1);
  };
  const state = member => {
    const rows = store.submissions(member.id);
    let previousAccepted = true;
    return publicCourses.map(course => {
      const latest = rows.find(row => row.course_id === course.id);
      const accepted = rows.some(row => row.course_id === course.id && row.outcome === 'accepted' && row.course_version === courseVersion);
      const result = { ...course, publicReadable: true, canSubmit: audience === 'chat' && previousAccepted,
        status: accepted ? 'accepted' : latest?.outcome || 'not_started',
        latestSubmission: latest ? submissionView(latest) : null };
      previousAccepted = previousAccepted && accepted;
      return result;
    });
  };

  return async function handleAiMembers(request, { peer = 'unresolved-peer' } = {}) {
    const url = new URL(request.url);
    if (url.pathname !== PREFIX && !url.pathname.startsWith(`${PREFIX}/`)) return null;
    try {
      if (url.origin !== origin) fail(421, '请求来源不正确');
      if (!['GET', 'POST', 'PATCH'].includes(request.method)) return json({ error: '方法不支持' }, 405, { Allow: 'GET, POST, PATCH' });
      if (request.method !== 'GET' && request.headers.get('origin') !== origin) fail(403, '请从本系统提交请求');
      if (request.headers.get('sec-fetch-site') === 'cross-site') fail(403, '不接受跨站请求');
      const route = url.pathname.slice(PREFIX.length);
      if (route === '/directory' && request.method === 'GET') {
        const admin = await adminIdentity(request);
        return json({ canViewAudit: Boolean(admin), members: directory.map(entry => {
          const row = store.db.prepare('SELECT id,display_name,enabled FROM ai_members WHERE id=?').get(entry.id);
          return { id: entry.id, role: entry.role, displayName: row?.display_name || entry.displayName,
            status: row ? row.enabled ? 'registered' : 'disabled' : 'not_connected',
            canChat: Boolean(row?.enabled && publicAsk && verifyMember), canAskPublic: Boolean(row?.enabled && publicAsk),
            scope: '公开课程和自身测试资料' };
        }) });
      }
      const conversation = route.match(/^\/conversations\/([a-z][a-z0-9-]{2,63})\/messages$/u);
      if (conversation && ['GET', 'POST'].includes(request.method)) {
        const requester = await memberIdentity(request);
        if (!requester) fail(401, '请先登录并完成 OA 准入');
        const entry = directory.find(item => item.id === conversation[1]);
        const agent = store.db.prepare('SELECT id,display_name,enabled FROM ai_members WHERE id=? AND enabled=1').get(conversation[1]);
        if (!entry || !agent) fail(404, '该 AI 成员尚未接入');
        const agentInfo = { id: agent.id, displayName: agent.display_name, role: entry.role };
        if (request.method === 'GET') {
          const rows = store.db.prepare('SELECT * FROM ai_conversation_turns WHERE agent_id=? AND audience=? AND requester_ref=? ORDER BY created_at DESC,id DESC LIMIT 200').all(agent.id, audience, requester.id).reverse();
          return json({ agent: agentInfo, messages: rows.flatMap(turnMessages), notice: 'AI 回答仅使用公开问答能力，不代表审批或实际执行完成。' });
        }
        if (typeof publicAsk !== 'function') fail(503, '公开问答尚未接入');
        store.rate(`conversation:${audience}:${requester.id}`, 20, 60 * 1000);
        const input = fields(await inputJson(request), ['message', 'idempotencyKey'], ['message', 'idempotencyKey']);
        const message = text(input.message, 2000, '消息', 1);
        if (!message || typeof input.idempotencyKey !== 'string' || !/^[a-zA-Z0-9_.:-]{8,120}$/u.test(input.idempotencyKey)) fail(400, '消息或幂等标识不正确');
        if (request.headers.has('idempotency-key') && request.headers.get('idempotency-key') !== input.idempotencyKey) fail(400, '幂等标识不一致');
        const requestHash = hash(message);
        const reserved = store.atomic(() => {
          if (!store.db.prepare('SELECT id FROM ai_members WHERE id=? AND enabled=1').get(agent.id)) fail(404, 'AI 成员已停用');
          const prior = store.db.prepare('SELECT * FROM ai_conversation_turns WHERE agent_id=? AND audience=? AND requester_ref=? AND request_key=?').get(agent.id, audience, requester.id, input.idempotencyKey);
          if (prior) { if (prior.request_hash !== requestHash) fail(409, '幂等标识已用于不同消息'); return { row: prior, replay: true }; }
          const turnId = id();
          store.db.prepare("INSERT INTO ai_conversation_turns(id,agent_id,audience,requester_ref,question,state,created_at,request_key,request_hash) VALUES(?,?,?,?,?,'running',?,?,?)")
            .run(turnId, agent.id, audience, requester.id, message, store.now(), input.idempotencyKey, requestHash);
          store.audit(agent.id, audience, 'conversation.started', turnId, { requesterRef: requester.id, mode: 'public_only', role: entry.role });
          return { row: store.db.prepare('SELECT * FROM ai_conversation_turns WHERE id=?').get(turnId), replay: false };
        });
        const streaming = wantsEventStream(request);
        if (reserved.replay) {
          const replay = { requestId: reserved.row.id, messages: turnMessages(reserved.row), state: reserved.row.state, replay: true,
            ...(reserved.row.state === 'succeeded' ? {} : { error: '消息已发送，结果尚未确认，不会自动重复发送' }) };
          if (streaming && reserved.row.state === 'succeeded') return answerEventStream(request,
            { requestId: reserved.row.id, agent: agentInfo, state: 'succeeded', replay: true }, async () => replay, () => replay);
          return json(replay, reserved.row.state === 'succeeded' ? 200 : 409);
        }
        const historyRows = store.db.prepare("SELECT question,answer FROM ai_conversation_turns WHERE agent_id=? AND audience=? AND requester_ref=? AND state='succeeded' ORDER BY created_at DESC,id DESC LIMIT 3").all(agent.id, audience, requester.id).reverse();
        const execute = async ({ signal = request.signal, onEvent } = {}) => {
          let checkedAt = 0;
          const verifyCurrentViewer = async (force = false) => {
            signal.throwIfAborted();
            if (!store.db.prepare('SELECT id FROM ai_members WHERE id=? AND enabled=1').get(agent.id)) fail(403, 'AI 成员已停用');
            if (force || Date.now() - checkedAt >= 1000) {
              if ((await memberIdentity(request))?.id !== requester.id) fail(401, '当前会话已失效');
              checkedAt = Date.now();
            }
            signal.throwIfAborted();
          };
          const result = await runPublicAsk(message, { agentId: agent.id, questionId: reserved.row.id, signal,
            onEvent: onEvent ? async event => {
              await verifyCurrentViewer();
              onEvent(event);
            } : undefined,
            persona: { role: entry.role, displayName: agent.display_name, actorType: 'ai_member' },
            history: historyRows.flatMap(row => [{ role: 'user', content: row.question }, { role: 'assistant', content: row.answer.slice(0, 4000) }]) });
          signal.throwIfAborted();
          if (onEvent) await verifyCurrentViewer(true);
          store.atomic(() => {
            store.db.prepare("UPDATE ai_conversation_turns SET state='succeeded',answer=?,finished_at=? WHERE id=? AND state='running'").run(result.answer, store.now(), reserved.row.id);
            store.audit(agent.id, audience, 'conversation.finished', reserved.row.id, { requesterRef: requester.id, mode: 'public_only', answerSha256: hash(result.answer) });
          });
          if ((await memberIdentity(request))?.id !== requester.id) fail(401, '当前会话已失效');
          if (!store.db.prepare('SELECT id FROM ai_members WHERE id=? AND enabled=1').get(agent.id)) fail(403, 'AI 成员已停用；在途结果已保留供负责人核验');
          const row = store.db.prepare('SELECT * FROM ai_conversation_turns WHERE id=?').get(reserved.row.id);
          return { requestId: reserved.row.id, messages: turnMessages(row), state: 'succeeded', replay: false };
        };
        const unconfirmed = error => {
          store.atomic(() => {
            const changed = store.db.prepare("UPDATE ai_conversation_turns SET state='unknown',finished_at=? WHERE id=? AND state='running'").run(store.now(), reserved.row.id);
            if (changed.changes) {
              const code = error?.code === 'MODEL_VALIDATION_FAILED' ? error.code : 'GENERATION_UNCONFIRMED';
              const message = code === 'MODEL_VALIDATION_FAILED' ? '模型答复未通过完整性或资料引用校验，请重新生成。' : '本次生成已结束，但未保存完整答复。可手动重新生成，旧记录会保留。';
              store.db.prepare('INSERT OR REPLACE INTO ai_conversation_failures(turn_id,code,message,created_at) VALUES(?,?,?,?)').run(reserved.row.id, code, message, store.now());
              store.audit(agent.id, audience, 'conversation.unconfirmed', reserved.row.id, { requesterRef: requester.id, mode: 'public_only', code });
            }
          });
          return { requestId: reserved.row.id, error: error instanceof HttpError ? error.message : error?.code === 'MODEL_VALIDATION_FAILED' ? error.message : '本次生成已结束，未保存完整答复。请核对记录后手动重新生成。',
            state: 'unknown', messages: turnMessages({ ...reserved.row, state: 'unknown' }) };
        };
        if (streaming) return answerEventStream(request,
          { requestId: reserved.row.id, agent: agentInfo, messages: turnMessages(reserved.row), state: 'running', replay: false }, execute, unconfirmed);
        try { return json(await execute()); }
        catch (error) {
          const failure = unconfirmed(error);
          if (error instanceof HttpError) throw error;
          return json(failure, 502);
        }
      }

      if (route === '/session' && request.method === 'GET') {
        let member = null;
        try { member = publicMember(store.authenticate(authCookie(request), audience)); }
        catch (error) { if (!(error instanceof HttpError)) throw error; }
        const admin = await adminIdentity(request);
        return json({ aiAuthenticated: Boolean(member), adminAuthenticated: Boolean(admin), ...(member ? { member } : {}) });
      }
      if (route.startsWith('/admin/')) {
        const admin = await adminIdentity(request);
        if (!admin) fail(403, '仅负责人管理员可查看 AI 全过程');
        if (route === '/admin/overview' && request.method === 'GET') {
          const members = store.db.prepare('SELECT * FROM ai_members ORDER BY created_at,id').all().map(member => ({
            ...publicMember(member), profile: store.profile(member.id),
            submissionCount: store.db.prepare('SELECT count(*) AS n FROM ai_submissions WHERE agent_id=?').get(member.id).n,
            artifactCount: store.db.prepare('SELECT count(*) AS n FROM ai_artifacts WHERE agent_id=?').get(member.id).n,
            questionCount: store.db.prepare('SELECT count(*) AS n FROM ai_questions WHERE agent_id=?').get(member.id).n,
            lastEvent: store.db.prepare('SELECT event,created_at AS createdAt FROM ai_audit WHERE agent_id=? ORDER BY seq DESC LIMIT 1').get(member.id) || null,
          }));
          return json({ members, capabilities: { canDisable: true, canViewEvidence: true, canProvision: false, canApprove: false } });
        }
        const target = route.match(/^\/admin\/members\/([a-z][a-z0-9-]{2,63})(?:\/(audit|disable|artifacts|questions|submissions|prechecks|conversations))?$/u);
        if (target) {
          const targetMember = store.db.prepare('SELECT * FROM ai_members WHERE id=?').get(target[1]);
          if (!targetMember) fail(404, 'AI 成员不存在');
          if (target[2] === 'disable' && request.method === 'POST') {
            fields(await inputJson(request), []);
            store.disable(targetMember.id, admin.id);
            return json({ disabled: true, memberId: targetMember.id });
          }
          if (request.method === 'GET') {
            if (!target[2]) return json({ member: publicMember(targetMember), profile: store.profile(targetMember.id), courses: state(targetMember) });
            if (target[2] === 'audit') return json(readAudit(targetMember.id, url, true));
            if (target[2] === 'artifacts') return json({ artifacts: store.db.prepare('SELECT * FROM ai_artifacts WHERE agent_id=? ORDER BY created_at,id').all(targetMember.id).map(row => ({ ...artifactMetadata(row), downloadUrl: `${PREFIX}/admin/members/${targetMember.id}/artifacts/${row.id}/download` })) });
            if (target[2] === 'submissions') return json({ submissions: store.submissions(targetMember.id).map(submissionView) });
            if (target[2] === 'questions') return json({ questions: store.db.prepare('SELECT id,audience,question,answer,state,created_at AS createdAt,finished_at AS finishedAt FROM ai_questions WHERE agent_id=? ORDER BY created_at,id').all(targetMember.id) });
            if (target[2] === 'prechecks') return json({ prechecks: store.db.prepare('SELECT id,audience,result,created_at AS createdAt FROM ai_prechecks WHERE agent_id=? ORDER BY created_at,id').all(targetMember.id).map(row => ({ ...row, result: JSON.parse(row.result) })) });
            if (target[2] === 'conversations') {
              const rows = store.db.prepare('SELECT * FROM ai_conversation_turns WHERE agent_id=? ORDER BY created_at DESC,id DESC LIMIT 201').all(targetMember.id);
              return json({ hasOlder: rows.length > 200, conversations: rows.slice(0, 200).reverse().map(row => ({ requesterRef: row.requester_ref, audience: row.audience, messages: turnMessages(row) })) });
            }
          }
        }
        const adminDownload = route.match(/^\/admin\/members\/([a-z][a-z0-9-]{2,63})\/artifacts\/([a-f0-9-]{36})\/download$/u);
        if (adminDownload && request.method === 'GET') {
          const artifact = store.db.prepare('SELECT * FROM ai_artifacts WHERE id=? AND agent_id=?').get(adminDownload[2], adminDownload[1]);
          if (!artifact) fail(404, '资料不存在');
          store.audit(artifact.agent_id, 'control', 'artifact.review_downloaded', artifact.id, { operatorRef: admin.id });
          return new Response(artifact.content, { headers: { 'Content-Type': 'text/plain; charset=utf-8',
            'Content-Disposition': 'attachment; filename="ai-evidence.txt"', 'Cache-Control': 'no-store',
            'X-Content-Type-Options': 'nosniff', 'X-Content-SHA256': artifact.sha256 } });
        }
        return json({ error: '没有找到此管理接口' }, 404);
      }
      if (route === '/session' && request.method === 'POST') {
        const input = fields(await inputJson(request), ['agentId', 'credential'], ['agentId', 'credential']);
        const result = store.login(input.agentId, input.credential, audience, peer);
        return json({ member: result.member, expiresAt: result.expiresAt, authentication: 'ai_service_credential' }, 200,
          { 'Set-Cookie': cookie(result.sessionToken, SESSION_MS / 1000) });
      }
      const member = store.authenticate(authCookie(request), audience);
      store.rate(`request:${audience}:${member.id}`, 180, 60 * 1000);
      if (route === '/logout' && request.method === 'POST') {
        store.atomic(() => {
          store.db.prepare('DELETE FROM ai_sessions WHERE token_hash=?').run(member.session_hash);
          store.audit(member.id, audience, 'session.logout');
        });
        return json({ loggedOut: true }, 200, { 'Set-Cookie': cookie('', 0) });
      }
      if (route === '/me' && request.method === 'GET') return json({ member: publicMember(member), profile: store.profile(member.id), audience });
      if (route === '/me/profile' && request.method === 'PATCH') {
        const input = fields(await inputJson(request), ['direction', 'goal', 'bio']);
        if (!Object.keys(input).length) fail(400, '请提供要保存的资料');
        const profile = { ...store.profile(member.id), ...input };
        if (!['undecided', 'perception', 'navigation', 'control', 'mechanics', 'ai'].includes(profile.direction)) fail(400, '学习方向不正确');
        profile.goal = text(profile.goal, 1000, '学习目标'); profile.bio = text(profile.bio, 2000, '简介');
        store.atomic(() => {
          store.assertActiveSession(member, audience);
          store.db.prepare('UPDATE ai_profiles SET direction=?,goal=?,bio=?,updated_at=? WHERE agent_id=?').run(profile.direction, profile.goal, profile.bio, store.now(), member.id);
          store.audit(member.id, audience, 'profile.updated', member.id, { fields: Object.keys(input).sort() });
        });
        return json({ saved: true, profile: store.profile(member.id) });
      }
      if (route === '/courses' && request.method === 'GET') return json({ courseVersion, courses: state(member), progressMeaning: 'AI evidence submissions and separate human review; not human student completion' });
      if (route === '/artifacts' && request.method === 'GET') {
        return json({ artifacts: store.db.prepare('SELECT * FROM ai_artifacts WHERE agent_id=? AND audience=? ORDER BY created_at DESC,id DESC').all(member.id, audience).map(artifactMetadata) });
      }
      if (route === '/artifacts' && request.method === 'POST') {
        const key = requestKey(request);
        const input = fields(await inputJson(request), ['name', 'content', 'kind'], ['name', 'content', 'kind']);
        const name = text(input.name, 120, '文件名', 1);
        if (/[/\\\r\n]/u.test(name) || !/\.(txt|md|csv|json|log|py)$/iu.test(name)) fail(400, '首版仅接受文本测试材料');
        text(input.content, MAX_ARTIFACT, '文件正文', 1);
        const content = input.content; // Preserve exact bytes, including final newlines and indentation.
        const byteSize = Buffer.byteLength(content, 'utf8');
        if (byteSize > MAX_ARTIFACT) fail(413, '文件超过 256 KiB');
        if (!['test_material', 'course_evidence', 'experience_report'].includes(input.kind)) fail(400, '材料类型不正确');
        const requestHash = hash(JSON.stringify({ name, content, kind: input.kind }));
        const result = store.atomic(() => {
          store.assertActiveSession(member, audience);
          const existing = store.db.prepare('SELECT * FROM ai_artifacts WHERE agent_id=? AND audience=? AND request_key=?').get(member.id, audience, key);
          if (existing) {
            if (existing.request_hash !== requestHash) fail(409, '幂等标识已用于不同内容');
            return { artifact: artifactMetadata(existing), replay: true };
          }
          const usage = store.db.prepare('SELECT count(*) AS count,coalesce(sum(byte_size),0) AS bytes FROM ai_artifacts WHERE agent_id=?').get(member.id);
          if (usage.count >= MAX_ARTIFACTS || usage.bytes + byteSize > MAX_MEMBER_BYTES) fail(413, '自身测试材料配额已满');
          const artifactId = id();
          store.db.prepare('INSERT INTO ai_artifacts(id,agent_id,audience,name,kind,content,byte_size,sha256,created_at,request_key,request_hash) VALUES(?,?,?,?,?,?,?,?,?,?,?)')
            .run(artifactId, member.id, audience, name, input.kind, content, byteSize, hash(content), store.now(), key, requestHash);
          store.audit(member.id, audience, 'artifact.created', artifactId, { sha256: hash(content), byteSize, kind: input.kind });
          return { artifact: artifactMetadata(store.artifact(member.id, artifactId, audience)), replay: false };
        });
        return json(result, result.replay ? 200 : 201);
      }
      const download = route.match(/^\/artifacts\/([a-f0-9-]{36})\/download$/u);
      if (download && request.method === 'GET') {
        const artifact = store.artifact(member.id, download[1], audience);
        if (!artifact) fail(404, '资料不存在');
        store.audit(member.id, audience, 'artifact.downloaded', artifact.id);
        return new Response(artifact.content, { headers: {
          'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff',
          'Content-Disposition': `attachment; filename="ai-material.txt"; filename*=UTF-8''${encodeURIComponent(artifact.name)}`,
          'X-Content-SHA256': artifact.sha256,
        }});
      }
      const taskMatch = route.match(/^\/courses\/([a-z0-9-]+)\/submissions$/u);
      if (taskMatch && request.method === 'POST') {
        if (audience !== 'chat') fail(403, '请在 Chat 学习入口提交课程证据');
        const course = state(member).find(c => c.id === taskMatch[1]);
        if (!course) fail(404, '课程不存在');
        const key = requestKey(request);
        const input = fields(await inputJson(request), ['summary', 'artifactIds', 'executionKind'], ['summary', 'artifactIds', 'executionKind']);
        const summary = text(input.summary, 4000, '实验说明', 1);
        if (!summary || !Array.isArray(input.artifactIds) || input.artifactIds.length < 1 || input.artifactIds.length > 12 ||
          input.artifactIds.some(v => typeof v !== 'string') || new Set(input.artifactIds).size !== input.artifactIds.length) fail(400, '请提供自己的实际证据文件');
        if (!['offline', 'simulation', 'hardware_not_executed'].includes(input.executionKind)) fail(400, '首版不接受真机完成声明');
        const requestHash = hash(JSON.stringify({ courseId: course.id, courseVersion, summary, artifactIds: input.artifactIds, executionKind: input.executionKind }));
        const result = store.atomic(() => {
          store.assertActiveSession(member, audience);
          const existing = store.db.prepare('SELECT * FROM ai_submissions WHERE agent_id=? AND request_key=?').get(member.id, key);
          if (existing) {
            if (existing.request_hash !== requestHash) fail(409, '幂等标识已用于不同提交');
            return { submission: submissionView(existing), replay: true };
          }
          // Recheck under the write transaction; a prior rejection must not unlock later courses.
          if (!state(member).find(c => c.id === course.id).canSubmit) fail(409, '前一课程尚未通过实际证据审核');
          if (input.artifactIds.some(artifactId => !store.artifact(member.id, artifactId, audience))) fail(404, '证据不存在或不属于当前账号');
          const submissionId = id();
          store.db.prepare("INSERT INTO ai_submissions(id,agent_id,course_id,course_version,outcome,execution_kind,summary,artifact_ids,created_at,request_key,request_hash) VALUES(?,?,?,?,'submitted',?,?,?,?,?,?)")
            .run(submissionId, member.id, course.id, courseVersion, input.executionKind, summary, JSON.stringify(input.artifactIds), store.now(), key, requestHash);
          store.audit(member.id, audience, 'course.submitted', submissionId, { courseId: course.id, artifactIds: input.artifactIds, executionKind: input.executionKind });
          return { submission: submissionView(store.db.prepare('SELECT * FROM ai_submissions WHERE id=?').get(submissionId)), replay: false };
        });
        return json(result, result.replay ? 200 : 201);
      }
      if (route === '/submissions' && request.method === 'GET') return json({ submissions: store.submissions(member.id).map(submissionView) });
      if (route === '/questions' && request.method === 'GET') return json({ questions: store.db.prepare('SELECT id,question,answer,state,created_at AS createdAt,finished_at AS finishedAt FROM ai_questions WHERE agent_id=? AND audience=? ORDER BY created_at,id').all(member.id, audience) });
      if (route === '/questions' && request.method === 'POST') {
        if (typeof publicAsk !== 'function') fail(503, '公开问答尚未接入');
        const key = requestKey(request);
        const input = fields(await inputJson(request), ['question'], ['question']);
        const question = text(input.question, 2000, '问题', 1);
        if (!question) fail(400, '问题不能为空');
        const requestHash = hash(question);
        const reservation = store.atomic(() => {
          store.assertActiveSession(member, audience);
          const prior = store.db.prepare('SELECT * FROM ai_questions WHERE agent_id=? AND audience=? AND request_key=?').get(member.id, audience, key);
          if (prior) {
            if (prior.request_hash !== requestHash) fail(409, '幂等标识已用于不同问题');
            return { row: prior, replay: true };
          }
          const questionId = id();
          store.db.prepare("INSERT INTO ai_questions(id,agent_id,audience,question,state,created_at,request_key,request_hash) VALUES(?,?,?,?,'running',?,?,?)")
            .run(questionId, member.id, audience, question, store.now(), key, requestHash);
          store.audit(member.id, audience, 'question.started', questionId, { mode: 'public_only' });
          return { row: { id: questionId }, replay: false };
        });
        const streaming = wantsEventStream(request);
        if (reservation.replay) {
          const row = reservation.row;
          if (row.state !== 'succeeded') return json({ questionId: row.id, state: row.state, replay: true,
            error: '该问题已开始执行，结果尚未确认；不会自动重复发送' }, 409);
          const replay = { questionId: row.id, question: row.question, answer: row.answer, state: row.state, mode: 'public_only', replay: true };
          if (streaming) return answerEventStream(request, { requestId: row.id, questionId: row.id, state: row.state, replay: true }, async () => replay, () => replay);
          return json(replay);
        }
        const execute = async ({ signal = request.signal, onEvent } = {}) => {
          // No Request, Cookie, credential or internal retrieval context is passed.
          const result = await runPublicAsk(question, { agentId: member.id, questionId: reservation.row.id, signal,
            onEvent: onEvent ? event => { store.assertActiveSession(member, audience); onEvent(event); } : undefined });
          signal.throwIfAborted();
          store.atomic(() => {
            store.db.prepare("UPDATE ai_questions SET state='succeeded',answer=?,finished_at=? WHERE id=? AND state='running'").run(result.answer, store.now(), reservation.row.id);
            store.audit(member.id, audience, 'question.finished', reservation.row.id, { mode: 'public_only', answerSha256: hash(result.answer) });
          });
          store.assertActiveSession(member, audience);
          return { questionId: reservation.row.id, question, answer: result.answer, state: 'succeeded', mode: 'public_only', replay: false };
        };
        const unconfirmed = error => {
          store.atomic(() => {
            const changed = store.db.prepare("UPDATE ai_questions SET state='unknown',finished_at=? WHERE id=? AND state='running'").run(store.now(), reservation.row.id);
            if (changed.changes) store.audit(member.id, audience, 'question.unconfirmed', reservation.row.id, { mode: 'public_only' });
          });
          return { error: error instanceof HttpError ? error.message : '公开问答结果未确认，不会自动重复发送', questionId: reservation.row.id, state: 'unknown' };
        };
        if (streaming) return answerEventStream(request, { requestId: reservation.row.id, questionId: reservation.row.id, state: 'running', replay: false }, execute, unconfirmed);
        try { return json(await execute()); }
        catch (error) {
          const failure = unconfirmed(error);
          if (error instanceof HttpError) throw error;
          return json(failure, 502);
        }
      }
      if (route === '/prechecks' && request.method === 'POST') {
        const key = requestKey(request);
        const input = fields(await inputJson(request), ['artifactIds'], ['artifactIds']);
        if (!Array.isArray(input.artifactIds) || input.artifactIds.length < 1 || input.artifactIds.length > 12 ||
          input.artifactIds.some(v => typeof v !== 'string') || new Set(input.artifactIds).size !== input.artifactIds.length) fail(400, '请指定自己的资料');
        const requestHash = hash(JSON.stringify(input.artifactIds));
        const result = store.atomic(() => {
          store.assertActiveSession(member, audience);
          const prior = store.db.prepare('SELECT * FROM ai_prechecks WHERE agent_id=? AND audience=? AND request_key=?').get(member.id, audience, key);
          if (prior) { if (prior.request_hash !== requestHash) fail(409, '幂等标识已用于不同资料'); return { id: prior.id, result: JSON.parse(prior.result), replay: true }; }
          const artifacts = input.artifactIds.map(artifactId => store.artifact(member.id, artifactId, audience));
          if (artifacts.some(a => !a)) fail(404, '资料不存在或不属于当前账号');
          const check = { status: 'advisory_only', approvalChanged: false,
            checks: artifacts.map(a => ({ artifactId: a.id, storedHashMatches: hash(a.content) === a.sha256,
              nonEmpty: Boolean(a.content.trim()), declaredTestMaterial: /系统验收|非业务资料|测试|test/iu.test(a.content) })),
            unverified: ['内容事实与技术结论', '真实硬件运行', '正式业务审批依据'],
            nextAction: '交指定负责人检查内容和证据；本结果不是批准' };
          const checkId = id();
          store.db.prepare('INSERT INTO ai_prechecks(id,agent_id,audience,artifact_ids,result,created_at,request_key,request_hash) VALUES(?,?,?,?,?,?,?,?)')
            .run(checkId, member.id, audience, JSON.stringify(input.artifactIds), JSON.stringify(check), store.now(), key, requestHash);
          store.audit(member.id, audience, 'material.prechecked', checkId, { artifactIds: input.artifactIds, result: 'advisory_only' });
          return { id: checkId, result: check, replay: false };
        });
        return json(result, result.replay ? 200 : 201);
      }
      if (route === '/audit' && request.method === 'GET') {
        return json(readAudit(member.id, url));
      }
      // No registration, human agreement, admin, approval or knowledge-publishing route.
      return json({ error: '没有找到此 AI 成员接口' }, 404);
    } catch (error) {
      if (error instanceof HttpError) return json({ error: error.message }, error.status);
      // Do not reflect SQL, secrets, file paths or arbitrary exception messages to clients.
      return json({ error: 'AI 成员服务暂时不可用' }, 500);
    }
  };
}
