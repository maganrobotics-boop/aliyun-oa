import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
const chatRoot=process.env.PROJECT_APPLICATION_CHAT_ROOT;if(!chatRoot)throw Error('PROJECT_APPLICATION_CHAT_ROOT required');
const {createCourseProjectSelections}=await import(chatRoot+'/aliyun/learning/course-project-selections.mjs');
const {academicSemester,courseProjects,industrialProjects,projectCourseIds}=await import(chatRoot+'/lib/project-catalogue.mjs');
const {createProjectApplications}=await import(chatRoot+'/aliyun/learning/project-application.mjs');
import { handleProjectApplication } from '../../lib/project-application-store.mjs';
import { handleApplicationReply } from '../../lib/project-application-replies.mjs';
const {APPLICATION_PATH,APPLICATION_DECISION_PATH,applicationContent,signApplication,verifyApplication,projectApplicationIntent,validateApplicationFiles}=await import(chatRoot+'/lib/project-application.mjs');
const moduleURL = text => 'data:text/javascript;base64,' + Buffer.from(text).toString('base64');
const canonicalURL = moduleURL(stripTypeScriptTypes(readFileSync(new URL('../../lib/canonical-json.ts', import.meta.url), 'utf8')));
const revisionsURL = moduleURL(stripTypeScriptTypes(readFileSync(new URL('../../lib/approval-revisions.ts', import.meta.url), 'utf8').replace('"./canonical-json"', JSON.stringify(canonicalURL))));
const planSource = readFileSync(new URL('../../lib/approval-revision-store.ts', import.meta.url), 'utf8');
const purePlanner = planSource.slice(planSource.indexOf('const SHA256_HEX'), planSource.indexOf('export function approvalRevisionValues'));
const { planApprovalRevisions } = await import(moduleURL(`import {buildApprovalRevision} from ${JSON.stringify(revisionsURL)};\n` + stripTypeScriptTypes(purePlanner)));
const secret = 'test-project-bridge-secret-do-not-use-in-production';
const actor = { email: 'teacher@example.edu', memberId: 'teacher-member', accountUserId: 'email:teacher@example.edu' };
const fields = { name: '测试学生', school: '测试学校，机器人专业，大三', academicResults: '相关课程成绩未出', introduction: '想学习机器人并参与项目实践。', experience: '已完成机器人日志练习。', project: 'Q1 四足巡检机器人', availability: '每周 6 小时' };
const courses = [{ id: 'registration', title: '学习目标' }, { id: 'graduation', title: '新手村最后一关' }, { id: 'ros2-development', title: 'ROS 2 基础' }, { id: 'robot-perception', title: '机器人感知' }, ...courseProjects.map(p=>({...p,requiredProject:2})), {id:'robot-manipulation-pick-place',title:'取放练习',parentId:'robot-manipulation'}, {id:'capstone-mower',title:'割草覆盖练习',parentProject:'capstone-quadruped'}];
function d1(raw) {
 const prepare = sql => { const query = { values: [], bind(...values) { const copy = prepare(sql); copy.values = values; return copy; }, async first() { return raw.prepare(sql).get(...this.values) || null; }, async all() { return { results: raw.prepare(sql).all(...this.values) }; }, async run() { return { meta: raw.prepare(sql).run(...this.values) }; } }; return query; };
 return { prepare, async batch(queries) { raw.exec('BEGIN IMMEDIATE'); try { const results = []; for (const q of queries) results.push(await q.run()); raw.exec('COMMIT'); return results; } catch (e) { raw.exec('ROLLBACK'); throw e; } } };
}
function fixture() {
 let currentTime = Date.now();
 const learning = new DatabaseSync(':memory:'), oa = new DatabaseSync(':memory:');
 learning.exec(`CREATE TABLE learning_submissions(id TEXT,email TEXT,payload TEXT,created_at INTEGER,review_state TEXT,review TEXT);CREATE TABLE learning_course_drafts(email TEXT,course_id TEXT,updated_at INTEGER);CREATE TABLE learning_messages(email TEXT,course_id TEXT,created_at INTEGER,kind TEXT);CREATE TABLE learning_graduation_attempts(email TEXT,status TEXT,completed_at INTEGER,result TEXT);`);
 oa.exec(`CREATE TABLE members(id TEXT PRIMARY KEY,full_name TEXT,chatgpt_account TEXT,account_user_id TEXT,status TEXT);CREATE TABLE approvals(id TEXT PRIMARY KEY,type TEXT,title TEXT,project TEXT,requester_name TEXT,requester_email TEXT,client_creation_key TEXT,business_key TEXT,created_at TEXT,updated_at TEXT,status TEXT,current_step TEXT,current_reviewer_name TEXT,current_reviewer_email TEXT,summary TEXT,owner TEXT,amount REAL,period_key TEXT,signers_json TEXT,payload_json TEXT,current_revision_no INTEGER,current_revision_hash TEXT);CREATE TABLE approval_events(id INTEGER PRIMARY KEY AUTOINCREMENT,approval_id TEXT,actor_name TEXT,actor_email TEXT,action TEXT,note TEXT,created_at TEXT);CREATE TABLE approval_revisions(revision_hash TEXT PRIMARY KEY,approval_id TEXT,revision_no INTEGER,previous_revision_hash TEXT,mutation_revision TEXT,state_json TEXT,state_hash TEXT,event_json TEXT,created_at TEXT,UNIQUE(approval_id,revision_no),UNIQUE(approval_id,mutation_revision));`);
 oa.prepare('INSERT INTO members VALUES(?,?,?,?,?)').run(actor.memberId, '测试老师', actor.email, actor.accountUserId, 'active');
 oa.exec('CREATE UNIQUE INDEX approval_period_key_unique ON approvals(period_key) WHERE period_key IS NOT NULL; CREATE UNIQUE INDEX approval_business_key_unique ON approvals(business_key) WHERE business_key IS NOT NULL;');
 const database = d1(oa), assets = new Map();
 const options = { db: database, secret, getReviewer: async () => ({ ...actor, name: '测试老师' }), planRevisions: planApprovalRevisions, bucket: { async put(key, bytes) { assets.set(key, bytes); return { size: bytes.length }; }, async get(key) { const bytes = assets.get(key); return bytes ? { size: bytes.length, body: bytes } : null; } } };
 let dropReceipt = false, offline = false;
 const env = { APP_ORIGIN: 'https://chat.omindos.cn', PUBLIC_LAB_AI_SERVICE_TOKEN: secret, OA_SERVICE: { async fetch(request) { if (offline) throw new Error('offline'); const response = await handleProjectApplication(request, options); if (dropReceipt) { dropReceipt = false; throw new Error('response lost after commit'); } return response; } } };
 const api = createProjectApplications({ db: learning, env, courses, owner: request => request.headers.get('x-test-user') || 'student@example.edu', limit() {}, graduationSummary: email => { const rows = learning.prepare('SELECT * FROM learning_graduation_attempts WHERE email=?').all(email); return { status: rows.some(row => row.status === 'passed') ? 'passed' : 'not_attempted', attempts: rows.length }; }, progressFor: () => ({ currentCourseId: 'registration', exemptedCourseIds: [] }) });
 const selections = createCourseProjectSelections({db:learning,env,courses,owner:request=>request.headers.get('x-test-user')||'student@example.edu',limit(){},snapshot:api.snapshot,bridge:api.bridge,profile:()=>({name:'测试学生'}),clock:()=>currentTime,startTimer:false});
 const pass = (email = 'student@example.edu') => learning.prepare('INSERT INTO learning_graduation_attempts VALUES(?,?,?,?)').run(email, 'passed', Date.now(), JSON.stringify({ checks: [{ id: 'motion', title: '真实执行核验', passed: true }] }));
 const studentRequest = (data, email = 'student@example.edu') => new Request('https://chat.omindos.cn/api/learning/project-application', { method: 'POST', headers: { origin: 'https://chat.omindos.cn', 'content-type': 'application/json', 'x-test-user': email }, body: JSON.stringify(data) });
 const body = () => ({ fields, labProjectId:'q1', files: [{ name: '作品.pdf', base64: btoa('%PDF-1.7\nfixture') }], confirmed: true, expectedEmail: 'student@example.edu', idempotencyKey: crypto.randomUUID() });
 const submit = data => api.handle(studentRequest(data || body()));
 const approve = async (id, note) => { oa.prepare("UPDATE approvals SET status='已归档' WHERE id=?").run(id); oa.prepare('INSERT INTO approval_events(approval_id,actor_email,action,note) VALUES(?,?,?,?)').run(id, actor.email, 'approve', note); return Response.json({}); };
 const reply = (id, data, who = actor, transport) => handleApplicationReply(new Request(`https://oa.omindos.cn/api/project-applications/${id}/reply`, { method: 'POST', headers: { origin: 'https://oa.omindos.cn', 'content-type': 'application/json' }, body: JSON.stringify(data) }), id, { db: database, actor: who, secret, approve: note => approve(id, note), transport: transport || { async fetch(url, init) { return Response.json(await api.handleDecision(new Request(url, init))); } } });
 const selectionBody = (courseId='capstone-patrol', email='student@example.edu')=>({courseId,name:'测试学生',studentNumber:email==='student@example.edu'?'20260001':'20260002',expectedEmail:email,expectedSemesterId:academicSemester(currentTime).id,idempotencyKey:crypto.randomUUID(),confirmed:true});
 const choose = (data=selectionBody(),email='student@example.edu')=>selections.handle(studentRequest(data,email));
 return { learning, oa, database, api, options, pass, body, submit, studentRequest, reply, assets, selections, selectionBody, choose, setTime(time){currentTime=time;}, setOffline(value){offline=value;}, dropNextReceipt() { dropReceipt = true; } };
}

test('final Newbie Village pass is required, and account/progress cannot be forged in the browser', async () => {
 const f = fixture(); await assert.rejects(f.submit(), e => e.status === 403); assert.equal(f.oa.prepare('SELECT count(*) n FROM approvals').get().n, 0);
 f.pass(); const body = f.body(); body.learning = { graduation: { status: 'passed' } }; await assert.rejects(f.submit(body), e => e.status === 400);
 const wrong = f.body(); wrong.expectedEmail = 'other@example.edu'; await assert.rejects(f.submit(wrong), e => e.status === 409);
});
test('confirmed application includes actual progress/AI feedback and creates a real immutable OA approval', async () => {
 const f = fixture(); f.pass(); f.learning.prepare('INSERT INTO learning_submissions VALUES(?,?,?,?,?,?)').run('submission1','student@example.edu','{"courseId":"registration"}',Date.now(),'done','请继续完善测试记录。');
 const receipt = await f.submit(); assert.equal(receipt.received, true); assert.equal(receipt.status, '待审核');
 const row = f.oa.prepare('SELECT * FROM approvals').get(), payload = JSON.parse(row.payload_json);
 assert.equal(payload.projectApplication.learning.submissionCount, 1); assert.equal(payload.projectApplication.learning.numericGrade, null); assert.equal(payload.projectApplication.learning.reviews[0].source, 'ai_tutor_feedback'); assert.equal(payload.projectApplication.learning.graduation.checks[0].passed, true);
 assert.equal(row.current_reviewer_email, actor.email); assert.equal(row.current_revision_no, 1); assert.equal(f.oa.prepare('SELECT count(*) n FROM approval_revisions').get().n,1); assert.equal(f.assets.size,1);
 const revision = f.oa.prepare('SELECT * FROM approval_revisions').get(); assert.equal(row.current_revision_hash, revision.revision_hash);
});
test('a lost response retries the same frozen evidence and creates no duplicate application or attachment', async () => {
 const f = fixture(); f.pass(); const body = f.body(); f.dropNextReceipt(); await assert.rejects(f.submit(body), e => e.status === 503);
 f.learning.prepare('INSERT INTO learning_submissions VALUES(?,?,?,?,?,?)').run('new','student@example.edu','{"courseId":"registration"}',Date.now(),'done','new');
 const receipt = await f.submit(body); assert.equal(receipt.received,true); assert.equal(f.oa.prepare('SELECT count(*) n FROM approvals').get().n,1); assert.equal(JSON.parse(f.oa.prepare('SELECT payload_json FROM approvals').get().payload_json).projectApplication.learning.submissionCount,0); assert.equal(f.assets.size,1);
 const changed = { ...body, fields: { ...fields, experience: '不同经历' } }; await assert.rejects(f.submit(changed), e => e.status === 409);
});
test('signed bridge rejects stale signatures, different path, cookie/origin spoofing and replay', async () => {
 const f = fixture(), body = JSON.stringify({ operation: 'list', email: 'student@example.edu' }), headers = await signApplication(body, secret);
 const req = () => new Request('https://oa.omindos.cn'+APPLICATION_PATH,{method:'POST',headers,body});
 assert.equal((await handleProjectApplication(req(), f.options)).status,200); assert.equal((await handleProjectApplication(req(), f.options)).status,409);
 const stale = await signApplication(body,secret,{now:Date.now()-120000}); assert.equal((await handleProjectApplication(new Request('https://oa.omindos.cn'+APPLICATION_PATH,{method:'POST',headers:stale,body}), f.options)).status,401);
 await assert.rejects(verifyApplication(new Request('https://chat.omindos.cn'+APPLICATION_DECISION_PATH,{method:'POST',headers,body}),secret),e=>e.status===401);
 await assert.rejects(verifyApplication(new Request('https://oa.omindos.cn'+APPLICATION_PATH,{method:'POST',headers:{...headers,cookie:'fake'},body}),secret),e=>e.status===401);
});
test('each student can list only their own applications', async () => {
 const f=fixture();f.pass();await f.submit();
 const request = new Request('https://chat.omindos.cn/api/learning/project-application',{headers:{'x-test-user':'other@example.edu'}});
 const view = await f.api.handle(request); assert.equal(view.records.length,0); assert.equal(view.replies.length,0);
});
test('a returned application is resubmitted as a new immutable revision under the same approval', async () => {
 const f=fixture();f.pass();const receipt=await f.submit();f.oa.prepare("UPDATE approvals SET status='已退回' WHERE id=?").run(receipt.id);f.oa.prepare('INSERT INTO approval_events(approval_id,action,note) VALUES(?,?,?)').run(receipt.id,'return','请补充每周时间。');
 const view=await f.api.handle(new Request('https://chat.omindos.cn/api/learning/project-application'));assert.equal(view.records[0].returnNote,'请补充每周时间。');
 const updated={...f.body(),resubmitId:receipt.id,fields:{...fields,availability:'每周 8 小时'}}; const again=await f.submit(updated);assert.equal(again.id,receipt.id);assert.equal(f.oa.prepare('SELECT current_revision_no FROM approvals').get().current_revision_no,2);assert.equal(f.oa.prepare('SELECT count(*) n FROM approval_revisions').get().n,2);
 await assert.rejects(f.submit({...f.body(),resubmitId:receipt.id}),e=>e.status===409);
});
test('only the assigned teacher can approve/reply and grant selected lessons without inventing grades', async () => {
 const f=fixture();f.pass();const {id}=await f.submit(),data={reply:'请先学习 ROS 2 基础，再参加巡检项目。',courseIds:['ros2-development'],idempotencyKey:crypto.randomUUID()};
 assert.equal((await f.reply(id,data,{...actor,email:'other@example.edu'})).status,403);
 const result=await (await f.reply(id,data)).json();assert.equal(result.delivered,true);
 assert.deepEqual(f.learning.prepare('SELECT course_id FROM learning_course_access_grants').all().map(r=>r.course_id),['ros2-development']);
 assert.equal(f.learning.prepare('SELECT count(*) n FROM learning_submissions').get().n,0);assert.equal(f.learning.prepare("SELECT count(*) n FROM learning_course_access_grants WHERE email='other@example.edu'").get().n,0);
 const history=await f.api.handle(new Request('https://chat.omindos.cn/api/learning/project-application'));assert.equal(history.replies[0].reply,data.reply);assert.deepEqual(history.replies[0].courseIds,['ros2-development']);
 assert.equal((await (await f.reply(id,data)).json()).idempotent,true);assert.equal(f.learning.prepare('SELECT count(*) n FROM learning_project_decisions').get().n,1);
});
test('failed permission synchronization stays pending and retry delivers the same reply once',async()=>{
 const f=fixture();f.pass();const {id}=await f.submit(),data={reply:'已同意，请先学习机器人感知。',courseIds:['robot-perception'],idempotencyKey:crypto.randomUUID()};
 const failed=await (await f.reply(id,data,actor,{fetch(){throw new Error('offline');}})).json();assert.equal(failed.saved,true);assert.equal(failed.delivered,false);assert.equal(f.learning.prepare('SELECT count(*) n FROM learning_course_access_grants').get().n,0);
 const retry=await (await f.reply(id,data)).json();assert.equal(retry.delivered,true);assert.equal(f.oa.prepare('SELECT count(*) n FROM project_application_replies').get().n,1);
});
test('project work course questions do not trigger enrollment; unsupported or oversized materials are rejected',()=>{
 assert.equal(projectApplicationIntent('我想参与巡检项目'),true);assert.equal(projectApplicationIntent('项目工作课程怎么学习'),false);assert.equal(projectApplicationIntent('我不想参与项目'),false);
 assert.throws(()=>validateApplicationFiles([{name:'evil.pdf',base64:btoa('<html>bad</html>')}]),/格式/);
 assert.throws(()=>validateApplicationFiles(Array.from({length:4},()=>({name:'x.pdf',base64:btoa('%PDF-test')}))),/最多/);
});


test('semester boundaries use Beijing time and the whole January belongs to the fall semester',()=>{
 assert.equal(academicSemester(Date.parse('2026-01-31T15:59:59Z')).id,'2025-2026-1');
 assert.equal(academicSemester(Date.parse('2026-01-31T16:00:00Z')).id,'2025-2026-2');
 assert.equal(academicSemester(Date.parse('2026-08-31T15:59:59Z')).id,'2025-2026-2');
 assert.equal(academicSemester(Date.parse('2026-08-31T16:00:00Z')).id,'2026-2027-1');
});
test('one course project immediately opens its chapter without requiring the laboratory final gate',async()=>{
 const f=fixture();const result=await f.choose();assert.equal(result.opened,true);assert.equal(result.selected.oaDelivered,true);
 assert.deepEqual(f.selections.chosenCourseIds('student@example.edu'),['capstone-patrol']);
 const row=f.oa.prepare('SELECT * FROM approvals').get(),application=JSON.parse(row.payload_json).projectApplication;
 assert.equal(row.status,'待审核');assert.equal(row.current_reviewer_email,actor.email);assert.equal(application.kind,'course_project_selection');assert.equal(application.learning.graduation.status,'not_attempted');assert.equal(row.period_key,null);
 assert.equal(f.learning.prepare('SELECT count(*) n FROM learning_submissions').get().n,0);
 const decision=await (await f.reply(row.id,{reply:'本学期巡检项目已确认，请整理任务计划。',courseIds:[],idempotencyKey:crypto.randomUUID()})).json();assert.equal(decision.delivered,true);
});
test('simultaneous different choices cannot create two selections or two OA items',async()=>{
 const f=fixture();const results=await Promise.allSettled([f.choose(f.selectionBody('capstone-patrol')),f.choose(f.selectionBody('robot-manipulation'))]);
 assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.equal(results.find(r=>r.status==='rejected').reason.status,409);
 assert.equal(f.learning.prepare('SELECT count(*) n FROM learning_course_project_selections').get().n,1);assert.equal(f.oa.prepare('SELECT count(*) n FROM approvals').get().n,1);
 const existing=await f.choose();assert.equal(existing.selected.courseId,'capstone-patrol');assert.equal(f.oa.prepare('SELECT count(*) n FROM approvals').get().n,1);
});
test('OA outage keeps the chosen chapter available, preserves the quota and retries durably',async()=>{
 const f=fixture();f.setOffline(true);const body=f.selectionBody();const selected=await f.choose(body);assert.equal(selected.opened,true);assert.equal(selected.selected.oaDelivered,false);
 assert.deepEqual(f.selections.chosenCourseIds('student@example.edu'),['capstone-patrol']);await assert.rejects(f.choose(f.selectionBody('robot-manipulation')),e=>e.status===409);
 f.setOffline(false);f.setTime(Date.now()+120000);await f.selections.flushPending();const receipt=await f.choose(body);assert.equal(receipt.selected.oaDelivered,true);assert.equal(f.oa.prepare('SELECT count(*) n FROM approvals').get().n,1);
});
test('lost OA receipt retries the same frozen evidence and does not duplicate course choices',async()=>{
 const f=fixture();const body=f.selectionBody();f.dropNextReceipt();const first=await f.choose(body);assert.equal(first.selected.oaDelivered,false);
 f.learning.prepare('INSERT INTO learning_submissions VALUES(?,?,?,?,?,?)').run('later','student@example.edu','{"courseId":"registration"}',Date.now(),'done','later');
 const retried=await f.choose(body);assert.equal(retried.selected.oaDelivered,true);assert.equal(f.oa.prepare('SELECT count(*) n FROM approvals').get().n,1);assert.equal(JSON.parse(f.oa.prepare('SELECT payload_json FROM approvals').get().payload_json).projectApplication.learning.submissionCount,0);
});
test('a new semester permits another project while preserving earlier project access',async()=>{
 const f=fixture();f.setTime(Date.parse('2026-10-10T00:00:00Z'));await f.choose();f.setTime(Date.parse('2027-02-01T00:00:00Z'));const second=await f.choose(f.selectionBody('robot-manipulation'));
 assert.equal(second.selected.semester.id,'2026-2027-2');assert.equal(second.selected.oaDelivered,true);
 assert.deepEqual(f.selections.chosenCourseIds('student@example.edu').sort(),['capstone-patrol','robot-manipulation','robot-manipulation-pick-place'].sort());assert.equal(f.oa.prepare('SELECT count(*) n FROM approvals').get().n,2);
 assert.deepEqual(projectCourseIds(courses,'capstone-quadruped'),['capstone-quadruped','capstone-mower']);
});
test('server rejects spoofed semester/account and supporting exercises as standalone project choices',async()=>{
 const f=fixture();await assert.rejects(f.choose({...f.selectionBody(),expectedSemesterId:'2030-2031-1'}),e=>e.status===409);
 await assert.rejects(f.choose({...f.selectionBody(),expectedEmail:'other@example.edu'}),e=>e.status===409);
 await assert.rejects(f.choose(f.selectionBody('capstone-mower')),e=>e.status===400);assert.equal(f.oa.prepare('SELECT count(*) n FROM approvals').get().n,0);
});
test('OA independently enforces one choice per student/semester and permits different students',async()=>{
 const f=fixture();await f.choose();const original=JSON.parse(f.oa.prepare('SELECT payload_json FROM approvals').get().payload_json).projectApplication;
 const payload={operation:'submit',kind:'course_project_selection',selection:original.selection,email:original.email,applicationId:crypto.randomUUID(),submissionKey:crypto.randomUUID(),fields:original.fields,files:[],learning:original.learning,content:applicationContent(original.fields,original.learning,{selection:original.selection}),confirmed:true};
 const body=JSON.stringify(payload);const rejected=await handleProjectApplication(new Request('https://oa.omindos.cn'+APPLICATION_PATH,{method:'POST',headers:await signApplication(body,secret),body}),f.options);assert.equal(rejected.status,409);
 const other=await f.choose(f.selectionBody('robot-manipulation','other@example.edu'),'other@example.edu');assert.equal(other.selected.oaDelivered,true);assert.equal(f.oa.prepare('SELECT count(*) n FROM approvals').get().n,2);
});
test('laboratory application records one of the official projects and is separate from course quota',async()=>{
 const f=fixture();await f.choose();await assert.rejects(f.submit(),e=>e.status===403);f.pass();const bad={...f.body(),labProjectId:'unknown'};await assert.rejects(f.submit(bad),e=>e.status===400);
 const receipt=await f.submit();assert.equal(receipt.received,true);assert.equal(f.oa.prepare('SELECT count(*) n FROM approvals').get().n,2);
 const row=f.oa.prepare('SELECT * FROM approvals WHERE id=?').get(receipt.id),application=JSON.parse(row.payload_json).projectApplication;assert.equal(application.labProjectId,'q1');assert.ok(JSON.parse(row.payload_json).circulationContent.includes(industrialProjects[0].url));
 const view=await f.api.handle(new Request('https://chat.omindos.cn/api/learning/project-application'));assert.equal(view.records.length,1);assert.equal(view.records[0].kind,'lab_application');
});

test('teacher access to a main project also opens its supporting exercise',async()=>{
 const f=fixture();f.pass();const {id}=await f.submit();const result=await (await f.reply(id,{reply:'请完成项目六的割草覆盖规划练习。',courseIds:['capstone-quadruped'],idempotencyKey:crypto.randomUUID()})).json();assert.equal(result.delivered,true);assert.deepEqual(f.learning.prepare('SELECT course_id FROM learning_course_access_grants ORDER BY course_id').all().map(r=>r.course_id),['capstone-mower','capstone-quadruped']);
});

test('course choice requires a real entered name/student number and sends both to the native OA item',async()=>{
 const f=fixture();const missing=f.selectionBody();delete missing.studentNumber;await assert.rejects(f.choose(missing),e=>e.status===400);await assert.rejects(f.choose({...f.selectionBody(),name:''}),e=>e.status===400);
 const receipt=await f.choose();assert.equal(receipt.selected.name,'测试学生');assert.equal(receipt.selected.studentNumber,'20260001');
 const payload=JSON.parse(f.oa.prepare('SELECT payload_json FROM approvals').get().payload_json);assert.equal(payload.projectApplication.fields.name,'测试学生');assert.equal(payload.projectApplication.selection.studentNumber,'20260001');assert(payload.circulationContent.includes('学号：20260001'));
 const view=await f.selections.handle(new Request('https://chat.omindos.cn/api/learning/course-project-selection'));assert.equal(view.profile.studentNumber,'20260001');assert.equal(view.selected.name,'测试学生');
 await assert.rejects(f.choose({...f.selectionBody(),studentNumber:'20260099'}),e=>e.status===409);
});

async function legacySelection(f) {
 const email='student@example.edu',learning=f.api.snapshot(email),semester=academicSemester(Date.parse(learning.capturedAt)),project=courseProjects[0];
 const applicationId=crypto.randomUUID(),submissionKey=crypto.randomUUID(),selection={courseId:project.id,semesterId:semester.id,semesterLabel:semester.label},oldFields={...fields,project:project.title,availability:semester.label};
 const body=JSON.stringify({operation:'submit',kind:'course_project_selection',selection,email,applicationId,submissionKey,fields:oldFields,files:[],learning,content:applicationContent(oldFields,learning,{selection}),confirmed:true});
 const response=await handleProjectApplication(new Request('https://oa.omindos.cn'+APPLICATION_PATH,{method:'POST',headers:await signApplication(body,secret),body}),f.options);assert.equal(response.status,201);const receipt=(await response.json()).application;
 f.learning.prepare("INSERT INTO learning_course_project_selections(email,semester_id,semester_label,course_id,application_id,idem,learning_json,fields_json,state,receipt,created_at) VALUES(?,?,?,?,?,?,?,?,'delivered',?,?)").run(email,semester.id,semester.label,project.id,applicationId,submissionKey,JSON.stringify(learning),JSON.stringify(oldFields),JSON.stringify(receipt),Date.now());
 const identity={applicationId,idempotencyKey:crypto.randomUUID(),expectedEmail:email,name:'补齐姓名',studentNumber:'20260001',confirmed:true};
 const patch=(data=identity,owner=email)=>f.selections.handle(new Request('https://chat.omindos.cn/api/learning/course-project-selection',{method:'PATCH',headers:{origin:'https://chat.omindos.cn','content-type':'application/json','x-test-user':owner},body:JSON.stringify(data)}));
 return {applicationId,learning,identity,patch};
}
test('legacy course selection supplements identity in the same immutable OA item without consuming another quota',async()=>{
 const f=fixture(),legacy=await legacySelection(f),result=await legacy.patch();assert.equal(result.selected.oaDelivered,true,result.selected.oaError);assert.equal(result.selected.applicationId,legacy.applicationId);assert.equal(result.selected.studentNumber,'20260001');
 const row=f.oa.prepare('SELECT * FROM approvals').get(),application=JSON.parse(row.payload_json).projectApplication;
 assert.equal(row.current_revision_no,2);assert.equal(application.fields.name,'补齐姓名');assert.equal(application.selection.studentNumber,'20260001');assert.deepEqual(application.learning,legacy.learning);
 assert.equal(f.learning.prepare('SELECT count(*) n FROM learning_course_project_selections').get().n,1);assert.equal(f.oa.prepare('SELECT count(*) n FROM approvals').get().n,1);assert.equal(f.oa.prepare("SELECT count(*) n FROM approval_events WHERE action='student_identity_updated'").get().n,1);
 assert.deepEqual(f.selections.chosenCourseIds('student@example.edu'),['capstone-patrol']);assert.equal(f.learning.prepare('SELECT count(*) n FROM learning_submissions').get().n,0);
 await legacy.patch();assert.equal(f.oa.prepare('SELECT current_revision_no FROM approvals').get().current_revision_no,2);
 await assert.rejects(legacy.patch({...legacy.identity,studentNumber:'20269999'}),e=>e.status===409);
});
test('legacy identity supplementation checks ownership and cannot overwrite a processed OA item',async()=>{
 const f=fixture(),legacy=await legacySelection(f);
 await assert.rejects(legacy.patch({...legacy.identity,expectedEmail:'other@example.edu'},'other@example.edu'),e=>e.status===404);
 await assert.rejects(legacy.patch({...legacy.identity,studentNumber:'bad number'}),e=>e.status===400);
 f.oa.prepare("UPDATE approvals SET status='已归档' WHERE id=?").run(legacy.applicationId);
 await assert.rejects(legacy.patch(),e=>e.status===409);assert.equal(f.learning.prepare('SELECT student_number FROM learning_course_project_selections').get().student_number,'');assert.equal(f.oa.prepare('SELECT current_revision_no FROM approvals').get().current_revision_no,1);
});
