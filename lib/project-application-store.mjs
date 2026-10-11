import { academicSemester, courseProjects, industrialProjects } from './project-catalogue.mjs';
import { APPLICATION_VERSION, applicationContent, applicationEmail, applicationError, applicationHash, applicationId, applicationJson, applicationText, exactKeys, learningSummary, validateApplicationFields, validateApplicationFiles, verifyApplication } from './project-application.mjs';

const parse = text => { try { return JSON.parse(text || '{}'); } catch { return {}; } };
const rawToState = row => Object.fromEntries(Object.entries(row).map(([key, value]) => [key.replace(/_([a-z])/gu, (_, c) => c.toUpperCase()), value]));
const toColumn = key => key.replace(/[A-Z]/gu, c => `_${c.toLowerCase()}`);
const applicationMarker = "json_extract(CASE WHEN json_valid(payload_json) THEN payload_json ELSE '{}' END,'$.projectApplication.version')=1";
function validateSnapshot(snapshot, requiresPass = true) {
  if (!snapshot || snapshot.version !== APPLICATION_VERSION || snapshot.source !== 'learning_database' || snapshot.numericGrade !== null || !Number.isFinite(Date.parse(snapshot.capturedAt)) || !Array.isArray(snapshot.chapters) || snapshot.chapters.length > 200 || !Array.isArray(snapshot.reviews) || snapshot.reviews.length > 3 || JSON.stringify(snapshot).length > 50000) applicationError('平台学习记录格式不正确。');
  for (const key of ['totalChapters', 'submittedChapters', 'submissionCount', 'reviewedCount']) if (!Number.isSafeInteger(snapshot[key]) || snapshot[key] < 0) applicationError('平台学习记录不完整。');
  if(requiresPass&&(snapshot.graduation?.status!=='passed'||snapshot.eligibility?.canApply!==true))applicationError('请先完成并通过新手村最后一关。',403);
  if (snapshot.submittedChapters > snapshot.totalChapters || snapshot.reviewedCount > snapshot.submissionCount) applicationError('平台学习记录不一致。');
  if (snapshot.currentChapter) applicationText(snapshot.currentChapter.title, 300, '章节名称');
  for (const review of snapshot.reviews) { applicationText(review.chapter, 300, '点评章节'); applicationText(review.review, 1000, '助教点评'); if (review.numericScore !== null || review.source !== 'ai_tutor_feedback') applicationError('助教点评来源不正确。'); }
  return snapshot;
}
function receipt(row, note = '') {
  const application = parse(row.payload_json).projectApplication;
  return { kind: application.kind || 'lab_application', ...(application.selection ? { selection: application.selection } : {}), ...(application.labProjectId ? { labProjectId: application.labProjectId } : {}), id: row.id, status: row.status, project: application.fields.project, fields: application.fields, createdAt: row.created_at, updatedAt: row.updated_at, reviewerName: row.owner || row.current_reviewer_name || '马淦', returnNote: note, learningSummary: learningSummary(application.learning), snapshotAt: application.learning.capturedAt };
}
async function applicationReceipt(db, row) {
  const last = await db.prepare("SELECT note FROM approval_events WHERE approval_id=? AND action IN ('return','force_return') ORDER BY id DESC LIMIT 1").bind(row.id).first();
  return receipt(row, row.status === '已退回' ? last?.note || '' : '');
}

/** All identity and learning data comes from the signed, authenticated Chat service. */
export async function handleProjectApplication(request, { db, secret, bucket, getReviewer, planRevisions }, now = Date.now()) {
  try {
    if (request.headers.get('content-type')?.split(';')[0].trim() !== 'application/json') applicationError('需要 JSON 请求。', 415);
    const { payload: data, nonce } = await verifyApplication(request, secret, now);
    await db.prepare('CREATE TABLE IF NOT EXISTS project_application_bridge_nonces(nonce TEXT PRIMARY KEY,created_at INTEGER NOT NULL)').run();
    const claim = await db.prepare('INSERT OR IGNORE INTO project_application_bridge_nonces VALUES(?,?)').bind(nonce, now).run();
    if (claim.meta.changes !== 1) applicationError('该服务请求已处理，请刷新后重试。', 409);
    await db.prepare('DELETE FROM project_application_bridge_nonces WHERE created_at<?').bind(now - 3600000).run();
    const email = applicationEmail(data?.email);
    if (exactKeys(data, ['operation', 'email']) && data.operation === 'list') {
      const rows = (await db.prepare(`SELECT * FROM approvals WHERE lower(requester_email)=? AND ${applicationMarker} ORDER BY created_at DESC LIMIT 10`).bind(email).all()).results;
      const records = [];
      for (const row of rows) records.push(await applicationReceipt(db, row));
      return applicationJson({ received: true, records });
    }
    if (!exactKeys(data, ['operation', 'email', 'applicationId', 'submissionKey', 'fields', 'files', 'learning', 'content', 'confirmed', 'kind', 'selection', 'labProjectId']) || data.operation !== 'submit' || data.confirmed !== true) applicationError('申请格式不正确。');
    const kind = data.kind || 'lab_application';
    if (!['lab_application', 'course_project_selection'].includes(kind)) applicationError('项目类型不正确。');
    const isSelection = kind === 'course_project_selection';
    const id = applicationId(data.applicationId), submissionKey = applicationId(data.submissionKey), fields = validateApplicationFields(data.fields), files = validateApplicationFiles(data.files || []), learning = validateSnapshot(data.learning, !isSelection);
    let selection, labProjectId;
    if (isSelection) {
      const value = data.selection, semester = academicSemester(Date.parse(learning.capturedAt));
      const project = courseProjects.find(p => p.id === value?.courseId);
      if (!exactKeys(value, ['courseId','semesterId','semesterLabel','studentNumber']) || !project || value.semesterId !== semester.id || value.semesterLabel !== semester.label || fields.project !== project.title || files.length || data.labProjectId) applicationError('课程项目与学期信息不正确。');
      const studentNumber = value.studentNumber ? applicationText(value.studentNumber,40,'学号',2) : '';
      if (studentNumber && !/^[A-Za-z0-9._-]{2,40}$/u.test(studentNumber)) applicationError('学号格式不正确。');
      selection = { courseId: project.id, semesterId: semester.id, semesterLabel: semester.label, ...(studentNumber ? { studentNumber } : {}) };
      await db.prepare('CREATE TABLE IF NOT EXISTS project_course_selection_claims(email TEXT NOT NULL COLLATE NOCASE,semester_id TEXT NOT NULL,application_id TEXT NOT NULL UNIQUE,PRIMARY KEY(email,semester_id))').run();
      const reserved = await db.prepare('SELECT application_id FROM project_course_selection_claims WHERE email=? AND semester_id=?').bind(email, semester.id).first();
      if (reserved && reserved.application_id !== id) applicationError('本学期的课程项目已提交，每学期只能选择一个。', 409);
    } else {
      if (data.selection) applicationError('实验室申请格式不正确。');
      const project = industrialProjects.find(p => p.id === data.labProjectId);
      if (data.kind && (!project || fields.project !== project.title)) applicationError('请从官网三个工业项目中选择意向项目。');
      labProjectId = project?.id;
    }
    const content = applicationContent(fields, learning, { selection, labProjectId });
    if (data.content !== content || content.length > 4000) applicationError('报名材料与学生确认版本不一致。');
    const requestHash = await applicationHash(JSON.stringify(data.kind ? { email, fields, files: data.files || [], learning, kind, selection, labProjectId } : { email, fields, files: data.files || [], learning }));
    const old = await db.prepare('SELECT * FROM approvals WHERE id=?').bind(id).first();
    const oldApplication = parse(old?.payload_json).projectApplication;
    if (old && ((oldApplication?.kind || 'lab_application') !== kind || old.requester_email.toLowerCase() !== email || oldApplication?.version !== APPLICATION_VERSION || old.type !== '流转审批')) applicationError('未找到自己的项目申请。', 404);
    if (oldApplication?.submissionKey === submissionKey) {
      if (oldApplication.requestHash !== requestHash) applicationError('同一提交编号不能用于不同材料。', 409);
      return applicationJson({ received: true, application: await applicationReceipt(db, old), idempotent: true });
    }
    if (old && (isSelection || old.status !== '已退回')) applicationError('这份申请已进入审核；只有退回后才可补充重交。', 409);
    if (old && old.current_revision_no >= 124) applicationError('申请版本已达上限，请联系老师处理。', 409);
    const reviewer = await getReviewer();
    if (!reviewer?.memberId || !reviewer.accountUserId || !reviewer.email || reviewer.email === email) applicationError('指定审核人暂不可用。', 503);
    if (files.length && (!bucket || typeof bucket.put !== 'function')) applicationError('材料存储暂不可用，请保留附件重试。', 503);
    const attachments = [];
    for (const file of files) {
      const hash = await applicationHash(file.bytes), key = `project-applications/${id}/${submissionKey}/${hash}`;
      const stored = await bucket.put(key, file.bytes, { httpMetadata: { contentType: file.mimeType }, sha256: hash, onlyIf: { etagDoesNotMatch: '*' }, customMetadata: { source: 'student-project-application' } });
      if (!stored) { const existing = await bucket.get(key); if (!existing || existing.size !== file.size) applicationError('材料尚未保存完整，请重试。', 503); }
      attachments.push({ id: hash, name: file.name, size: file.size, mimeType: file.mimeType, key });
    }
    const at = new Date(now).toISOString(), mutation = crypto.randomUUID();
    const approver = { memberId: reviewer.memberId, email: reviewer.email, name: reviewer.name, accountUserId: reviewer.accountUserId };
    const historicalFiles = [...(oldApplication?.historicalFiles || []), ...(oldApplication?.files || [])];
    const body = { circulationContent: content, circulationRecipients: [], circulationApprovers: [approver], circulationConfirmations: [], circulationApprovals: [], initialReviewerEmail: reviewer.email, initialReviewerName: reviewer.name, workflowMutationRevision: mutation, projectApplication: { version: APPLICATION_VERSION, kind, ...(selection ? { selection } : {}), ...(labProjectId ? { labProjectId } : {}), source: 'learning_tutor', email, fields, learning, files: attachments, historicalFiles, submissionKey, requestHash, confirmedAt: at, identityNote: '登录邮箱由学习系统验证；姓名、学号、成绩及项目经历由学生提供，待老师核查。' } };
    const row = { id, type: '流转审批', title: `${isSelection ? '课程选题' : '实验室报名'} · ${fields.name} · ${fields.project}`.slice(0, 160), project: isSelection ? 'OriginMind 课程项目选题' : 'OriginMind × ARTS Robotics 实验室报名', requesterName: fields.name, requesterEmail: email, clientCreationKey: old?.client_creation_key || `learning-project:${id}`, businessKey: isSelection ? `learning-course:${await applicationHash(email+'|'+selection.semesterId)}` : null, createdAt: old?.created_at || at, updatedAt: at, status: '待审核', currentStep: '指定审批', currentReviewerName: reviewer.name, currentReviewerEmail: reviewer.email, summary: `${selection?.studentNumber ? '学号：'+selection.studentNumber+'；' : ''}${selection ? selection.semesterLabel + ' · 已开放章节；' : '意向：'}${fields.project}。${learningSummary(learning)}`, owner: reviewer.name, amount: null, periodKey: null, signersJson: '[]', payloadJson: JSON.stringify(body) };
    const event = { actorName: fields.name, actorEmail: email, action: old ? 'resubmitted' : 'submitted', note: isSelection ? '学生已选定本学期课程项目，对应章节立即开放；通知马淦待处理。' : old ? '学生在课程助教核对补充材料并确认重新提交。' : '学生在课程助教核对报名材料并确认提交给马淦。', occurredAt: at };
    const plan = await planRevisions({ previousApproval: old ? rawToState(old) : undefined, nextApproval: row, workflowMutationRevision: mutation, event, shouldWrite: true });
    row.currentRevisionNo = plan.currentRevisionNo; row.currentRevisionHash = plan.currentRevisionHash;
    const keys = Object.keys(row), columns = keys.map(toColumn);
    const reviewerGuard = 'EXISTS(SELECT 1 FROM members WHERE id=? AND account_user_id=? AND lower(chatgpt_account)=? AND status=\'active\')';
    const reviewerArgs = [reviewer.memberId, reviewer.accountUserId, reviewer.email];
    const quotaGuard = isSelection ? ' AND NOT EXISTS(SELECT 1 FROM project_course_selection_claims WHERE email=? AND semester_id=? AND application_id!=?)' : '';
    const quotaArgs = isSelection ? [email, selection.semesterId, id] : [];
    const persist = old
      ? db.prepare(`UPDATE approvals SET ${columns.map(column => `${column}=?`).join(',')} WHERE id=? AND requester_email=? AND status='已退回' AND current_revision_no=? AND current_revision_hash IS ? AND payload_json=? AND ${reviewerGuard}`).bind(...keys.map(key => row[key]), id, old.requester_email, old.current_revision_no, old.current_revision_hash, old.payload_json, ...reviewerArgs)
      : db.prepare(`INSERT OR IGNORE INTO approvals(${columns.join(',')}) SELECT ${keys.map(() => '?').join(',')} WHERE ${reviewerGuard}${quotaGuard}`).bind(...keys.map(key => row[key]), ...reviewerArgs, ...quotaArgs);
    const mutationGuard = "id=? AND json_extract(payload_json,'$.workflowMutationRevision')=? AND current_revision_no=? AND current_revision_hash=?";
    const mutationArgs = [id, mutation, plan.currentRevisionNo, plan.currentRevisionHash];
    const revisionWrites = plan.revisions.map(revision => db.prepare(`INSERT INTO approval_revisions(revision_hash,approval_id,revision_no,previous_revision_hash,mutation_revision,state_json,state_hash,event_json,created_at) SELECT ?,id,?,?,?,?,?,?,? FROM approvals WHERE ${mutationGuard}`).bind(revision.revisionHash, revision.revisionNo, revision.previousRevisionHash, revision.mutationRevision, revision.stateJson, revision.stateHash, revision.eventJson, revision.createdAt, ...mutationArgs));
    const eventWrite = db.prepare(`INSERT INTO approval_events(approval_id,actor_name,actor_email,action,note,created_at) SELECT id,?,?,?,?,? FROM approvals WHERE ${mutationGuard}`).bind(event.actorName, email, event.action, event.note, at, ...mutationArgs);
    const claimSelection = isSelection ? [db.prepare(`INSERT OR IGNORE INTO project_course_selection_claims(email,semester_id,application_id) SELECT ?,?,id FROM approvals WHERE ${mutationGuard}`).bind(email, selection.semesterId, ...mutationArgs)] : [];
    const results = await db.batch([persist, ...revisionWrites, eventWrite, ...claimSelection]);
    const stored = await db.prepare('SELECT * FROM approvals WHERE id=?').bind(id).first();
    const saved = parse(stored?.payload_json).projectApplication;
    if (!stored || stored.requester_email.toLowerCase() !== email || saved?.submissionKey !== submissionKey || saved.requestHash !== requestHash) applicationError('审核状态或指定审核人刚刚变化，请刷新后重试。', 409);
    if (results[0].meta.changes === 1 && results.slice(1).some(result => result.meta.changes !== 1)) applicationError('申请回执暂不可用，请重试同一份材料。', 503);
    return applicationJson({ received: true, application: await applicationReceipt(db, stored) }, old ? 200 : 201);
  } catch (error) { return applicationJson({ error: error.status ? error.message : '项目报名暂不可用，请保留材料后重试。' }, error.status || 503); }
}

export function applicationAttachment(row, fileId) {
  const application = parse(row?.payload_json).projectApplication;
  if (application?.version !== APPLICATION_VERSION || !/^[a-f0-9]{64}$/u.test(fileId || '')) return null;
  return [...(application.files || []), ...(application.historicalFiles || [])].find(file => file.id === fileId) || null;
}
