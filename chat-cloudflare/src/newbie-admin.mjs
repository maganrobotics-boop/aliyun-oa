import { PublicError } from './errors.mjs';
import { NEWBIE_COURSES } from './newbie-course-data.mjs';
import { newbieCourseDocument } from './newbie-tutor.mjs';

const COURSES = Object.entries(NEWBIE_COURSES).map(([id, course]) => ({ id, title: course.title, index: course.index }));
const COURSE_IDS = COURSES.map(course => course.id);
const TASK_SQL = COURSE_IDS.map(id => `'${id}'`).join(',');
const TOTAL = COURSE_IDS.length;

export function visitorAccountStatement(database, visitor, now = Date.now()) {
  return database.prepare(`INSERT INTO visitor_accounts(email,role,registered_at,last_login_at,registration_source)
    VALUES(?,?,?,?,'observed') ON CONFLICT(email) DO UPDATE SET role=excluded.role,
    last_login_at=MAX(COALESCE(visitor_accounts.last_login_at,0),excluded.last_login_at)`)
    .bind(visitor.email.trim().toLowerCase(), visitor.role, now, now);
}

export function newbieQuestionCourse(payload) {
  if (payload.newbieCourseId && Object.hasOwn(NEWBIE_COURSES, payload.newbieCourseId)) return payload.newbieCourseId;
  // Only the current question may opt into a course. Looking through old turns
  // would silently attribute unrelated later conversations to a course.
  const last = payload.messages?.at(-1);
  const document = last?.role === 'user' ? newbieCourseDocument([last]) : null;
  return document ? document.id.slice('course:'.length) : null;
}

export async function recordNewbieQuestion(database, visitor, payload, now = Date.now(), logger = console) {
  const courseId = newbieQuestionCourse(payload);
  if (!visitor || visitor.role !== 'student' || !courseId) return { status: 'not_applicable' };
  const question = String(payload.messages?.at(-1)?.content || '').trim();
  if (!question || question.length > 12000) return { status: 'failed', message: '本次课程提问长度不符合保存要求。' };
  try {
    const id = crypto.randomUUID();
    const email = visitor.email.trim().toLowerCase();
    // A session may predate tracking or arrive through an existing identity
    // bridge. This is first-known activity, not a claimed new login time.
    const written = await database.batch([
      database.prepare(`INSERT OR IGNORE INTO visitor_accounts(email,role,registered_at,last_login_at,registration_source)
        VALUES(?,'student',?,NULL,'inferred')`).bind(email, now),
      database.prepare('INSERT INTO newbie_questions(id,email,course_id,question,created_at) VALUES(?,?,?,?,?)')
        .bind(id, email, courseId, question, now),
    ]);
    if (written?.[1]?.success === false || written?.[1]?.meta?.changes !== 1) throw new Error('QUESTION_WRITE_UNCONFIRMED');
    return { status: 'recorded' };
  } catch (error) {
    logger.error('NEWBIE_QUESTION_RECORD_FAILED', { type: error instanceof Error ? error.name : 'unknown' });
    return { status: 'failed', message: '本次课程提问暂未保存到教师指导记录。' };
  }
}

function queryOptions(params, allowed) {
  for (const key of params.keys()) {
    if (!allowed.includes(key) || params.getAll(key).length !== 1) throw new PublicError('筛选参数不正确。', 400);
  }
  function integer(key, fallback, maximum) {
    const value = params.get(key);
    if (value === null || value === '') return fallback;
    if (!/^[1-9][0-9]*$/u.test(value) || !Number.isSafeInteger(Number(value)) || Number(value) > maximum) {
      throw new PublicError('分页参数不正确。', 400);
    }
    return Number(value);
  }
  const q = (params.get('q') || '').trim();
  if (q.length > 100) throw new PublicError('搜索文字不能超过 100 个字符。', 400);
  return { q, page: integer('page', 1, 1_000_000), pageSize: integer('pageSize', 20, 100) };
}

function pagination(options, total) {
  return { page: options.page, pageSize: options.pageSize, total, totalPages: Math.ceil(total / options.pageSize) };
}

const TASK_ROWS_CTE = `task_latest AS (
  SELECT lower(email) AS email,task_id,status,evidence,updated_at,
    ROW_NUMBER() OVER (PARTITION BY lower(email),task_id ORDER BY updated_at DESC,email ASC) AS rownum
  FROM newbie_task_progress WHERE task_id IN (${TASK_SQL})
)`;
const PROFILE_ROWS_CTE = `profile_latest AS (
  SELECT *, ROW_NUMBER() OVER (PARTITION BY lower(email) ORDER BY updated_at DESC,email ASC) AS rownum
  FROM newbie_profiles
)`;
const STUDENTS_CTE = `WITH ${TASK_ROWS_CTE}, ${PROFILE_ROWS_CTE}, progress AS (
  SELECT email, SUM(CASE WHEN status='completed' THEN 1 ELSE 0 END) AS completed,
    SUM(CASE WHEN status='in_progress' THEN 1 ELSE 0 END) AS inProgress, MAX(updated_at) AS taskAt
  FROM task_latest WHERE rownum=1 GROUP BY email
), question_counts AS (
  SELECT lower(email) AS email, COUNT(*) AS questionCount, MAX(created_at) AS questionAt FROM newbie_questions GROUP BY lower(email)
), members AS (
  SELECT a.email, a.role, a.registered_at AS registeredAt, a.last_login_at AS lastLoginAt,
    a.registration_source AS registrationSource, COALESCE(p.display_name,'') AS displayName,
    COALESCE(p.grade,'') AS grade, COALESCE(p.major,'') AS major, COALESCE(p.direction,'undecided') AS direction,
    COALESCE((SELECT review_status FROM newbie_agreement_acceptances g WHERE lower(g.email)=a.email
      ORDER BY accepted_at DESC,agreement_version DESC LIMIT 1),'not_signed') AS agreementStatus,
    COALESCE(t.completed,0) AS completed, COALESCE(t.inProgress,0) AS inProgress,
    COALESCE(q.questionCount,0) AS questionCount,
    MAX(COALESCE(a.last_login_at,0),COALESCE(p.updated_at,0),COALESCE(t.taskAt,0),COALESCE(q.questionAt,0),a.registered_at) AS lastActivityAt
  FROM visitor_accounts a LEFT JOIN profile_latest p ON lower(p.email)=a.email AND p.rownum=1
    LEFT JOIN progress t ON t.email=a.email LEFT JOIN question_counts q ON q.email=a.email
)`;

export async function newbieOverview(database) {
  const [counts, taskRows, tracking] = await Promise.all([
    database.prepare(`${STUDENTS_CTE} SELECT COUNT(*) AS registered,
      COALESCE(SUM(role='student'),0) AS students,COALESCE(SUM(role='staff'),0) AS staff,
      COALESCE(SUM(registrationSource='inferred'),0) AS registrationInferred,
      COALESCE(SUM(completed+inProgress>0),0) AS started, COALESCE(SUM(completed=${TOTAL}),0) AS completed,
      COALESCE(SUM(agreementStatus<>'not_signed'),0) AS agreementsSigned,
      (SELECT COUNT(*) FROM newbie_questions) AS questions FROM members`).first(),
    database.prepare(`WITH ${TASK_ROWS_CTE} SELECT task_id AS taskId, SUM(t.status='completed') AS completed,
      SUM(t.status='in_progress') AS inProgress FROM task_latest t
      JOIN visitor_accounts a ON a.email=t.email WHERE t.rownum=1 GROUP BY task_id`).all(),
    database.prepare("SELECT value FROM settings WHERE id='newbie_question_tracking_started_at'").first(),
  ]);
  const byTask = new Map((taskRows.results || []).map(row => [row.taskId, row]));
  return {
    summary: counts,
    tasks: COURSES.map(course => ({ ...course, total: counts.registered,
      completed: byTask.get(course.id)?.completed || 0, inProgress: byTask.get(course.id)?.inProgress || 0 })),
    trackingStartedAt: tracking ? Number(tracking.value) : null,
    registrationNote: '注册数为系统当前可确认的累计账号（含学生与教职工）。历史回填账号的时间仅代表最早已知活动，不能完整追溯过去所有注册。',
    progressNote: '进度为学生自行提交的学习记录，完成标记不代表教师验收；仅保存在学生本机的记录不会出现在这里。',
    questionNote: '仅展示此功能启用后，已登录学生在课程助教中提交的本轮问题；不含游客提问、普通聊天和未保存的历史对话。',
  };
}

export async function newbieStudents(database, params) {
  const options = queryOptions(params, ['q','status','page','pageSize']);
  const status = params.get('status') || 'all';
  if (!['all','not_started','in_progress','completed'].includes(status)) throw new PublicError('进度状态不正确。', 400);
  const conditions = ['1=1']; const values = [];
  if (options.q) {
    conditions.push('(instr(lower(email),lower(?))>0 OR instr(lower(displayName),lower(?))>0)');
    values.push(options.q, options.q);
  }
  if (status === 'not_started') conditions.push('completed+inProgress=0');
  if (status === 'in_progress') conditions.push(`completed+inProgress>0 AND completed<${TOTAL}`);
  if (status === 'completed') conditions.push(`completed=${TOTAL}`);
  const where = conditions.join(' AND ');
  const [count, result] = await Promise.all([
    database.prepare(`${STUDENTS_CTE} SELECT COUNT(*) AS n FROM members WHERE ${where}`).bind(...values).first(),
    database.prepare(`${STUDENTS_CTE} SELECT * FROM members WHERE ${where} ORDER BY lastActivityAt DESC,email ASC LIMIT ? OFFSET ?`)
      .bind(...values, options.pageSize, (options.page - 1) * options.pageSize).all(),
  ]);
  const rows = result.results || [];
  let taskRows = [];
  if (rows.length) {
    const result = await database.prepare(`WITH ${TASK_ROWS_CTE} SELECT email,task_id AS taskId,status,evidence,updated_at AS updatedAt
      FROM task_latest WHERE rownum=1 AND email IN (${rows.map(() => '?').join(',')})`)
      .bind(...rows.map(row => row.email)).all();
    taskRows = result.results || [];
  }
  const byKey = new Map(taskRows.map(row => [`${row.email}\u0000${row.taskId}`, row]));
  return { records: rows.map(row => ({ ...row, total: TOTAL, tasks: COURSES.map(course => {
    const task = byKey.get(`${row.email}\u0000${course.id}`);
    return { taskId: course.id, status: task?.status || 'not_started', evidence: task?.evidence || '', updatedAt: task?.updatedAt || null };
  }) })), pagination: pagination(options, Number(count.n)) };
}

export async function newbieQuestions(database, params) {
  const options = queryOptions(params, ['q','email','course','page','pageSize']);
  const email = (params.get('email') || '').trim().toLowerCase();
  const course = params.get('course') || '';
  if (email.length > 254 || (email && !/^[^\s@]+@[^\s@]+$/u.test(email))) throw new PublicError('账号筛选不正确。', 400);
  if (course && !Object.hasOwn(NEWBIE_COURSES, course)) throw new PublicError('课程筛选不正确。', 400);
  const conditions = ['1=1']; const values = [];
  if (options.q) {
    conditions.push('(instr(lower(q.question),lower(?))>0 OR instr(lower(q.email),lower(?))>0 OR instr(lower(COALESCE(p.display_name,\'\')),lower(?))>0)');
    values.push(options.q, options.q, options.q);
  }
  if (email) { conditions.push('q.email=?'); values.push(email); }
  if (course) { conditions.push('q.course_id=?'); values.push(course); }
  const from = `FROM newbie_questions q LEFT JOIN profile_latest p ON lower(p.email)=q.email AND p.rownum=1 WHERE ${conditions.join(' AND ')}`;
  const [count, result] = await Promise.all([
    database.prepare(`WITH ${PROFILE_ROWS_CTE} SELECT COUNT(*) AS n ${from}`).bind(...values).first(),
    database.prepare(`WITH ${PROFILE_ROWS_CTE} SELECT q.id,q.email,COALESCE(p.display_name,'') AS displayName,q.course_id AS courseId,
      q.question,q.created_at AS createdAt ${from} ORDER BY q.created_at DESC,q.id ASC LIMIT ? OFFSET ?`)
      .bind(...values, options.pageSize, (options.page - 1) * options.pageSize).all(),
  ]);
  return { records: (result.results || []).map(row => ({ ...row, courseTitle: NEWBIE_COURSES[row.courseId]?.title || row.courseId })),
    pagination: pagination(options, Number(count.n)) };
}
