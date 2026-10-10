import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync,readdirSync} from 'node:fs';
import {weeklyAccepted,weeklyReviewPayload} from '../lib/weekly-review.mjs';
import {personnelAnswer} from '../lib/personnel-chat.mjs';
function fixture(){
 const db=new DatabaseSync(':memory:');db.exec('PRAGMA foreign_keys=ON');
 for(const name of readdirSync(new URL('../drizzle/',import.meta.url)).filter(n=>/^\d{4}.*\.sql$/.test(n)).sort())db.exec(readFileSync(new URL('../drizzle/'+name,import.meta.url),'utf8'));
 for(const file of ['oa/0002_ai_workbench.sql','oa/0003_ai_workbench_artifacts.sql','expense-ledger-20261007.sql','personnel-auto-weekly-20261010.sql'])db.exec(readFileSync(new URL('../migrations/'+file,import.meta.url),'utf8'));
 for(const id of ['a','b','c'])db.prepare("INSERT INTO members(id,full_name,chatgpt_account,account_user_id,mutation_revision,nda_accepted_at) VALUES(?,?,?,?,?,?)").run(id,'成员'+id,id+'@example.com','email:'+id,'v1','now');
 const task=(id,kind)=>db.prepare(`INSERT INTO ai_workbench_tasks(id,member_id,account_user_id,member_revision,kind,title,instruction,material,origin_key,created_at,updated_at) VALUES(?,'a','email:a','v1',?,'工作总结','整理正文','工作材料',?,1,1)`).run(id,kind,'oa:'+id);
 const done=id=>db.prepare("UPDATE ai_workbench_tasks SET status='succeeded',result='已完成接口联调，成员各自核对实际工作量。',updated_at=2 WHERE id=?").run(id);
 return {db,task,done};
}
test('successful weekly task automatically creates one personal confirmation and an audit; retries and edits cannot overwrite it',()=>{
 const {db,task,done}=fixture();try {task('weekly','weekly_report');assert.equal(db.prepare('SELECT count(*) n FROM personnel_weekly_entries').get().n,0);done('weekly');const w=db.prepare('SELECT * FROM personnel_weekly_entries').get();assert.equal(w.state,'draft');assert.equal(w.confirmed_at,'');assert.match(w.content,/接口联调/);done('weekly');db.exec("UPDATE ai_workbench_tasks SET result='另一版本文档' WHERE id='weekly'");assert.equal(db.prepare('SELECT count(*) n FROM personnel_weekly_entries').get().n,1);assert.equal(db.prepare('SELECT source_text FROM personnel_weekly_entries').get().source_text,w.source_text);assert.equal(db.prepare("SELECT count(*) n FROM expense_events WHERE action='work_auto_create'").get().n,1);}finally{db.close();}
});
test('meeting members get independent blank work statements, duplicate links and departed members do not create extra work',()=>{
 const {db,task,done}=fixture();try {task('meeting','meeting_minutes');db.exec("INSERT INTO personnel_task_participants VALUES('meeting','b','email:b','a','now'); UPDATE members SET status='departed' WHERE id='c'; INSERT INTO personnel_task_participants VALUES('meeting','c','email:c','a','now')");done('meeting');const rows=db.prepare('SELECT * FROM personnel_weekly_entries ORDER BY member_id').all();assert.deepEqual(rows.map(w=>w.member_id),['a','b']);assert.ok(rows.every(w=>w.content===''&&w.confirmed_at===''));db.exec("INSERT INTO personnel_task_participants VALUES('meeting','b','email:b','a','now') ON CONFLICT DO NOTHING");assert.equal(db.prepare('SELECT count(*) n FROM personnel_weekly_entries').get().n,2);}finally{db.close();}
});
test('ordinary documents and failed tasks never generate work confirmations',()=>{
 const {db,task,done}=fixture();try{task('document','document');done('document');task('failed','weekly_report');db.exec("UPDATE ai_workbench_tasks SET status='failed' WHERE id='failed'");assert.equal(db.prepare('SELECT count(*) n FROM personnel_weekly_entries').get().n,0);}finally{db.close();}
});
test('approval evidence is valid after staff changes; missing self confirmation or fabricated signer is rejected',()=>{
 const policy={technical:[{memberId:'t1',accountUserId:'t1',email:'t1@x',name:'技术一'},{memberId:'t2',accountUserId:'t2',email:'t2@x',name:'技术二'}]};
 const p=weeklyReviewPayload({},policy,'a@x');p.circulationApprovals=[{...policy.technical[1],confirmedAt:'now'}];const w={member_id:'a',approval_status:'已归档',confirmed_at:'now'};assert.ok(weeklyAccepted(w,p));assert.equal(weeklyAccepted({...w,confirmed_at:''},p),false);p.circulationApprovals[0].memberId='intruder';assert.equal(weeklyAccepted(w,p),false);
});
test('personnel answers use reviewed work and include members without expense bills',()=>{
 const p={id:'a',name:'测试甲',direction:'四足机器人导航',billPersonId:'',work:[],labor:[],purchases:[],acceptedWorkCount:0};
 const ledger={profiles:[p],people:[],records:[],workflow:{weekly:[{member_id:'a',title:'已审核任务',content:'接口验证',accepted:true},{member_id:'a',title:'未审核敏感草稿',content:'不能计入成果',accepted:false}]}};
 const a=personnelAnswer(ledger,{memberId:'a'},'测试甲做了什么工作');assert.match(a.answer,/四足机器人导航/);assert.match(a.answer,/已审核任务/);assert.doesNotMatch(a.answer,/未审核敏感草稿|不能计入成果/);assert.match(personnelAnswer(ledger,{memberId:'a'},'成员信息').answer,/测试甲/);
});
test('knowledge weekly submissions create an immutable owner confirmation once per source item',()=>{
 const {db}=fixture();try{
  db.exec(`INSERT INTO knowledge_items(id,project,title,category,submitter_member_id,submitter_name,submitter_email,mutation_revision) VALUES('k','project','第1周周报','周报','a','成员a','a@example.com','k1');
  INSERT INTO knowledge_revisions(id,item_id,revision_no,title,category,content,content_hash,created_by_member_id,created_by_name,created_by_email) VALUES('r1','k',1,'第1周周报','周报','完成接口验证，个人工作量待确认','${'a'.repeat(64)}','a','成员a','a@example.com');
  UPDATE knowledge_items SET current_revision_id='r1',current_revision_no=1 WHERE id='k';`);
  const entry=db.prepare('SELECT * FROM personnel_weekly_entries').get();assert.equal(entry.member_id,'a');assert.equal(entry.source_key,'knowledge-item:k');assert.equal(entry.state,'draft');assert.match(entry.source_text,/接口验证/);
  db.exec(readFileSync(new URL('../migrations/personnel-auto-weekly-20261010.sql',import.meta.url),'utf8'));assert.equal(db.prepare('SELECT count(*) n FROM personnel_weekly_entries').get().n,1);
 }finally{db.close();}
});

test('participant API checks source ownership, origin, active accounts and repeat delivery',async()=>{
 const {register}=await import('node:module');register(new URL('./helpers/ai-workbench-loader.mjs',import.meta.url));
 const api=await import('../app/api/lab-ai/tasks/participants/route.ts');const {db,task,done}=fixture();
 try {
  db.exec(`INSERT INTO approvals(id,type,title,project,requester_name,requester_email,created_at,updated_at,status,current_step,owner,payload_json)
  VALUES('nda-a','保密协议','test','test','a','a@example.com','2026-10-10','2026-10-10','已归档','已归档','a','{"signerAccountUserId":"email:a","agreementVersion":"nda1"}');
  UPDATE members SET nda_approval_id='nda-a',nda_agreement_version='nda1' WHERE id='a';`);
  function prepare(sql,args=[]){return {bind(...v){return prepare(sql,v)},async first(){return db.prepare(sql).get(...args)||null},async all(){return {results:db.prepare(sql).all(...args)}},async run(){return {success:true,meta:{changes:Number(db.prepare(sql).run(...args).changes)}}}};}
  const adapter={prepare,async batch(list){db.exec('BEGIN');try{const out=[];for(const s of list)out.push(await s.run());db.exec('COMMIT');return out;}catch(e){db.exec('ROLLBACK');throw e;}}};
  const actor={memberId:'a',accountUserId:'email:a',memberMutationRevision:'v1',ndaCompleted:true};globalThis.__aiWorkbenchTest={actor,env:{DB:adapter}};
  task('source','meeting_minutes');done('source');
  const req=(origin='https://oa.test')=>new Request('https://oa.test/api/lab-ai/tasks/participants',{method:'POST',headers:{origin,'content-type':'application/json'},body:JSON.stringify({id:'source',memberIds:['b']})});
  assert.equal((await api.POST(req('https://other.test'))).status,403);
  globalThis.__aiWorkbenchTest.actor={...actor,memberId:'b',accountUserId:'email:b'};assert.equal((await api.POST(req())).status,404);
  globalThis.__aiWorkbenchTest.actor=actor;const response=await api.POST(req());assert.equal(response.status,200,await response.text());assert.equal((await api.POST(req())).status,200);
  assert.equal(db.prepare("SELECT count(*) n FROM personnel_weekly_entries WHERE member_id='b'").get().n,1);
  db.exec("UPDATE members SET status='departed' WHERE id='b'");assert.equal((await api.POST(req())).status,409);
 }finally{db.close();delete globalThis.__aiWorkbenchTest;}
});
test('archiving an AI weekly report to knowledge cannot double-count the same generated work',()=>{
 const {db,task,done}=fixture();try{task('original','weekly_report');done('original');
 db.exec(`INSERT INTO knowledge_items(id,project,title,category,submitter_member_id,submitter_name,submitter_email,mutation_revision) VALUES('archive','project','周报归档','周报','a','成员a','a@example.com','k1');
 INSERT INTO knowledge_revisions(id,item_id,revision_no,title,category,content,source_label,content_hash,created_by_member_id,created_by_name,created_by_email) VALUES('archive-r','archive',1,'周报归档','周报','已生成周报内容','OA AI 成果归档 · 周报','${'b'.repeat(64)}','a','成员a','a@example.com');
 UPDATE knowledge_items SET current_revision_id='archive-r',current_revision_no=1 WHERE id='archive';`);
 assert.equal(db.prepare('SELECT count(*) n FROM personnel_weekly_entries').get().n,1);
 }finally{db.close();}
});
