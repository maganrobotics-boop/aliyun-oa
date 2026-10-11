import { APPLICATION_DECISION_PATH, applicationEmail, applicationError, applicationHash, applicationId, applicationJson, applicationText, exactKeys, readApplicationBody, signApplication } from './project-application.mjs';

const parse = text => { try { return JSON.parse(text || '{}'); } catch { return {}; } };
export async function handleApplicationReply(request, id, { db, actor, approve, transport, secret }, now = Date.now()) {
  try {
    applicationId(id);
    const row = await db.prepare('SELECT * FROM approvals WHERE id=?').bind(id).first();
    const payload = parse(row?.payload_json), application = payload.projectApplication;
    if (!row || application?.version !== 1 || row.type !== '流转审批') applicationError('未找到项目报名。', 404);
    const email = applicationEmail(actor?.email);
    if (!payload.circulationApprovers?.some(person => person.email === email && person.memberId === actor.memberId && person.accountUserId === actor.accountUserId)) applicationError('仅指定老师可回复并开通课程。', 403);
    const active = await db.prepare("SELECT 1 FROM members WHERE id=? AND account_user_id=? AND lower(chatgpt_account)=? AND status='active'").bind(actor.memberId, actor.accountUserId, email).first();
    if (!active) applicationError('审核身份已变化，请重新登录。', 403);
    await db.prepare('CREATE TABLE IF NOT EXISTS project_application_replies(id TEXT PRIMARY KEY,application_id TEXT NOT NULL,actor_email TEXT NOT NULL,account_user_id TEXT NOT NULL,payload_json TEXT NOT NULL,body_hash TEXT NOT NULL,state TEXT NOT NULL,created_at INTEGER NOT NULL,updated_at INTEGER NOT NULL)').run();
    if (request.method === 'GET') {
      const replies = (await db.prepare('SELECT id,payload_json,state,created_at AS createdAt FROM project_application_replies WHERE application_id=? ORDER BY created_at DESC LIMIT 20').bind(id).all()).results.map(record => ({ id: record.id, ...parse(record.payload_json), state: record.state, createdAt: record.createdAt }));
      return applicationJson({ replies });
    }
    if (request.method !== 'POST') applicationError('不支持的方法。', 405);
    if (request.headers.get('origin') !== new URL(request.url).origin || request.headers.get('sec-fetch-site') === 'cross-site') applicationError('请在 OA 内回复。', 403);
    if (!request.headers.get('content-type')?.startsWith('application/json')) applicationError('需要 JSON 请求。', 415);
    let data; try { data = JSON.parse(await readApplicationBody(request, 16384)); } catch(error) { if(error.status)throw error;applicationError('回复格式不正确。'); }
    if (!exactKeys(data, ['reply', 'courseIds', 'idempotencyKey'])) applicationError('回复格式不正确。');
    const decisionId = applicationId(data.idempotencyKey), reply = applicationText(data.reply, 1000, '老师回复', 2);
    const catalogue = application.learning.catalogue;
    if (!Array.isArray(catalogue) || !Array.isArray(data.courseIds) || data.courseIds.length > 100 || new Set(data.courseIds).size !== data.courseIds.length || data.courseIds.some(courseId => !catalogue.some(course => course.id === courseId))) applicationError('课程权限选择不正确。');
    const intent = { applicationId: id, decisionId, email: applicationEmail(row.requester_email), reply, courseIds: [...data.courseIds].sort(), reviewer: email };
    const hash = await applicationHash(JSON.stringify(intent));
    let saved = await db.prepare('SELECT * FROM project_application_replies WHERE id=?').bind(decisionId).first();
    if (saved && (saved.application_id !== id || saved.actor_email !== email || saved.account_user_id !== actor.accountUserId || saved.body_hash !== hash)) applicationError('回复编号已用于其他内容，请刷新。', 409);
    if (saved?.state === 'delivered') return applicationJson({ saved: true, delivered: true, id: decisionId, idempotent: true });
    if (!['待审核', '已归档'].includes(row.status)) applicationError('这份申请目前不能批准；请先处理退回或作废状态。', 409);
    if (application.learning.graduation?.status !== 'passed') applicationError('学生尚未通过新手村最后一关。', 403);
    if (!saved) {
      const at = new Date(now).toISOString();
      await db.prepare('INSERT OR IGNORE INTO project_application_replies VALUES(?,?,?,?,?,?,?,?,?)').bind(decisionId, id, email, actor.accountUserId, JSON.stringify({ ...intent, approvedAt: at }), hash, 'pending_approval', now, now).run();
      saved = await db.prepare('SELECT * FROM project_application_replies WHERE id=?').bind(decisionId).first();
      if (saved?.body_hash !== hash || saved?.account_user_id !== actor.accountUserId) applicationError('回复记录刚刚变化，请刷新。', 409);
    }
    if (row.status === '待审核') {
      const result = await approve(reply);
      if (!result.ok) { const failure = await result.json().catch(() => ({})); applicationError(failure.error || '审批尚未完成。', result.status); }
    }
    const approved = await db.prepare('SELECT status FROM approvals WHERE id=?').bind(id).first();
    const event = await db.prepare("SELECT 1 FROM approval_events WHERE approval_id=? AND action='approve' AND lower(actor_email)=? LIMIT 1").bind(id, email).first();
    if (approved?.status !== '已归档' || !event) applicationError('审批尚未完成，未开通课程。', 409);
    await db.prepare("UPDATE project_application_replies SET state='pending_delivery',updated_at=? WHERE id=? AND state!='delivered'").bind(now, decisionId).run();
    let delivered = false;
    try {
      if (!transport?.fetch) throw new Error('unavailable');
      const body = saved.payload_json;
      const response = await transport.fetch(`https://chat.omindos.cn${APPLICATION_DECISION_PATH}`, { method: 'POST', headers: await signApplication(body, secret, { pathname: APPLICATION_DECISION_PATH }), body, redirect: 'manual', signal: AbortSignal.timeout(45000) });
      if (!response.headers.get('content-type')?.startsWith('application/json')) throw new Error('invalid response');
      const receipt = JSON.parse(await readApplicationBody(response, 16384));
      delivered = response.ok && receipt.received === true && receipt.delivered === true;
    } catch { /* The durable pending reply can be retried with the same key. */ }
    if (delivered) await db.prepare("UPDATE project_application_replies SET state='delivered',updated_at=? WHERE id=?").bind(Date.now(), decisionId).run();
    return applicationJson({ saved: true, delivered, id: decisionId, message: delivered ? '已回复学生并开通所选课程。' : '审批和回复已保存，课程权限待同步。请重试同步。' });
  } catch(error) { return applicationJson({ error: error.status ? error.message : '回复暂未完成，请重试。' }, error.status || 503); }
}
