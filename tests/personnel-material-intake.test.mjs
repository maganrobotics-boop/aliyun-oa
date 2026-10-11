import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync } from 'node:fs';
import { register } from 'node:module';
import { extractPersonnelMaterial, isPersonnelMaterialMessage, materialContent, readMaterialCategories } from '../lib/personnel-material.mjs';
import { intakePersonnelMaterial, readMaterialReceipt } from '../lib/personnel-material-store.mjs';
import { workflowOverview, mutateWorkflow } from '../lib/personnel-workflow.mjs';
import { weeklyAccepted, weeklyReviewPayload } from '../lib/weekly-review.mjs';
import { personnelAnswer } from '../lib/personnel-chat.mjs';
import { createOaResearchConversation } from '../aliyun/ai-members/oa-research.mjs';
import { AiMemberStore, createAiMembersHandler } from '../aliyun/ai-members/ai-members.mjs';

register(new URL('./helpers/ai-workbench-loader.mjs',import.meta.url));
const api=await import('../app/api/personnel-materials/route.ts');
const { createTask }=await import('../lib/ai-workbench-store.ts');
const text='# 9月工作与采购材料\n## 陈绿平\n### 采购账单\n购买导航线缆，发票原金额 128 元。\n### 从事的工作\n联调定位接口，负责真机实验。\n### 取得的成果\n完成重定位回归验证，日志已提交。\n## 林子昕\n### 从事的工作\n测试抓取模块，记录失败样例。\n### 取得的成果\n成功复现抓取实验，真机连续测试待补充。';
const roster=[{id:'a',name:'陈绿平',accountUserId:'account-a',email:'a@example.com'},{id:'b',name:'林子昕',accountUserId:'account-b',email:'b@example.com'}];
function fixture(){
 const sqlite=new DatabaseSync(':memory:');sqlite.exec('PRAGMA foreign_keys=ON');
 for(const n of readdirSync(new URL('../drizzle/',import.meta.url)).filter(n=>/^\d{4}.*\.sql$/.test(n)).sort())sqlite.exec(readFileSync(new URL('../drizzle/'+n,import.meta.url),'utf8'));
 for(const n of ['oa/0002_ai_workbench.sql','oa/0003_ai_workbench_artifacts.sql','expense-ledger-20261007.sql','review-routing-20261007.sql','personnel-auto-weekly-20261010.sql','personnel-knowledge-weekly-20261010.sql','personnel-material-intake-20261011.sql'])sqlite.exec(readFileSync(new URL('../migrations/'+n,import.meta.url),'utf8'));
 const people=[...roster,{id:'sender',name:'马淦',accountUserId:'account-sender',email:'sender@example.com'},...['t1','t2','finance','owner'].map(id=>({id,name:id,accountUserId:'account-'+id,email:id+'@example.com'}))];
 for(const m of people){
  sqlite.prepare('INSERT INTO members(id,full_name,chatgpt_account,account_user_id,mutation_revision,nda_accepted_at,nda_approval_id,nda_agreement_version) VALUES(?,?,?,?,?,?,?,?)').run(m.id,m.name,m.email,m.accountUserId,'v1','now','nda-'+m.id,'nda1');
  sqlite.prepare("INSERT INTO approvals(id,type,title,project,requester_name,requester_email,created_at,updated_at,status,current_step,owner,payload_json) VALUES(?,'保密协议','NDA','lab',?,?,'now','now','已归档','已归档',?,?)").run('nda-'+m.id,m.name,m.email,m.name,JSON.stringify({signerAccountUserId:m.accountUserId,agreementVersion:'nda1'}));
 }
 const person=id=>{const p=people.find(m=>m.id===id);return {memberId:p.id,accountUserId:p.accountUserId,email:p.email,name:p.name};};
 const policy={technical:['t1','t2'].map(person),finance:person('finance'),owner:person('owner')};
 sqlite.prepare('INSERT INTO oa_review_policy VALUES(1,?,?,?,?)').run(JSON.stringify(policy.technical),JSON.stringify(policy.finance),JSON.stringify(policy.owner),'now');
 sqlite.prepare('INSERT INTO personnel_workflow_config VALUES(1,?,?)').run('t1','owner');
 let beforeBatch=null,failAfter=-1;
 const prepare=(sql,params=[])=>({bind(...p){return prepare(sql,p)},async first(){return sqlite.prepare(sql).get(...params)||null},async all(){return {results:sqlite.prepare(sql).all(...params)}},async run(){return {success:true,meta:{changes:Number(sqlite.prepare(sql).run(...params).changes)}}}});
 const db={prepare,async batch(list){beforeBatch?.();sqlite.exec('BEGIN');try{let i=0;const out=[];for(const s of list){if(i++===failAfter)throw new Error('simulated disk failure');out.push(await s.run());}sqlite.exec('COMMIT');return out;}catch(e){sqlite.exec('ROLLBACK');throw e;}}};
 const actor=id=>({memberId:id,accountUserId:'account-'+id,memberMutationRevision:'v1',ndaCompleted:true,isAdmin:id==='sender',user:{email:id+'@example.com',displayName:people.find(p=>p.id===id).name}});
 return {sqlite,db,actor,policy,setBefore:f=>beforeBatch=f,setFail:n=>failAfter=n};
}
test('source headings yield three categories for each registered person, without allocating the whole meeting to its sender',()=>{
 const r=extractPersonnelMaterial(text,roster,{senderId:'sender'});assert.deepEqual(r.entries.map(e=>e.memberId),['a','b']);
 assert.match(r.entries[0].procurement[0],/128 元/);assert.match(r.entries[0].work[0],/定位接口/);assert.match(r.entries[0].achievement[0],/回归验证/);
 assert.deepEqual(r.entries[1].procurement,[]);assert.ok(r.entries[1].quotes.every(q=>text.includes(q)));
 const categories=readMaterialCategories(materialContent(r.entries[0]));assert.match(categories.work,/真机/);assert.doesNotMatch(categories.work,/发票/);
});
test('ambiguous names, referenced mentors, other person headings, queries and hypotheticals cannot manufacture personal evidence',()=>{
 const same=[...roster,{...roster[0],id:'other',accountUserId:'other'}];assert.equal(extractPersonnelMaterial(text,same).entries.some(e=>e.memberId==='a'),false);
 const r=extractPersonnelMaterial('作者：陈绿平\n完成测试。\n## 林子昕\n工作：开发接口，请陈绿平指导。\n## 未登记人员\n完成秘密任务。',roster);
 assert.deepEqual(r.entries.map(e=>e.memberId),['b']);assert.doesNotMatch(materialContent(r.entries[0]),/秘密/);
 for(const s of ['陈绿平做了什么工作？','请查一下陈绿平取得的成果','假设陈绿平完成了实验，整理成周报'])assert.equal(isPersonnelMaterialMessage(s),false);
 assert.equal(isPersonnelMaterialMessage(text),true);
});
test('default intake stores independent self-confirmation drafts, scoped source evidence and a real receipt, with no approval/payment',async()=>{
 const f=fixture();try{
  const r=await intakePersonnelMaterial(f.db,f.actor('sender'),{title:'9月材料',text});assert.equal(r.received,true);assert.equal(r.recipients.length,2);assert.ok(r.recipients.every(p=>p.state==='pending_self_confirmation'));
  const rows=f.sqlite.prepare('SELECT * FROM personnel_weekly_entries ORDER BY member_id').all();assert.deepEqual(rows.map(w=>w.member_id),['a','b']);assert.ok(rows.every(w=>!w.confirmed_at&&w.state==='draft'));
  assert.doesNotMatch(rows[0].source_text,/抓取模块/);assert.doesNotMatch(rows[1].source_text,/128/);
  assert.equal(f.sqlite.prepare("SELECT count(*) n FROM approvals WHERE type<>'保密协议'").get().n,0);assert.equal(f.sqlite.prepare('SELECT count(*) n FROM expense_transactions').get().n,0);
  assert.equal(await readMaterialReceipt(f.db,f.actor('a'),r.id),null);
 }finally{f.sqlite.close();}
});
test('repeat delivery keeps confirmed/edited content, original source and one audit per entry; concurrent retry is deduplicated',async()=>{
 const f=fixture();try{
  const input={title:'9月材料',text};const first=await intakePersonnelMaterial(f.db,f.actor('sender'),input);
  f.sqlite.exec("UPDATE personnel_weekly_entries SET content='本人已核对的正文',confirmed_at='confirmed',state='submitting' WHERE member_id='a'");
  const second=await intakePersonnelMaterial(f.db,f.actor('sender'),{...input,title:'同份文件改名'});assert.equal(second.id,first.id);assert.equal(second.duplicate,true);assert.equal(f.sqlite.prepare('SELECT count(*) n FROM personnel_weekly_entries').get().n,2);assert.equal(f.sqlite.prepare("SELECT content FROM personnel_weekly_entries WHERE member_id='a'").get().content,'本人已核对的正文');
  const raceInput={title:'下一周',text:text+'\n林子昕 工作：调试接口，完成新增测试。'};
  let entered=false;f.setBefore(()=>{if(entered)return;entered=true;});
  const r=await Promise.all([intakePersonnelMaterial(f.db,f.actor('sender'),raceInput),intakePersonnelMaterial(f.db,f.actor('sender'),raceInput)]);assert.equal(r[0].id,r[1].id);
  assert.equal(f.sqlite.prepare("SELECT count(*) n FROM expense_events WHERE action='work_auto_create'").get().n,4);
 }finally{f.sqlite.close();}
});
test('an NDA revoked after parsing excludes that person; sender revocation, maintenance freeze and partial write failures cannot give false success',async()=>{
 for(const mode of ['recipient','sender','freeze','disk']){
  const f=fixture();try{
   if(mode==='recipient')f.setBefore(()=>f.sqlite.exec("UPDATE approvals SET status='已退回' WHERE id='nda-b'"));
   if(mode==='sender')f.setBefore(()=>f.sqlite.exec("UPDATE members SET mutation_revision='v2' WHERE id='sender'"));
   if(mode==='freeze')f.setBefore(()=>f.sqlite.exec("INSERT INTO migration_control (id,freeze_generation,owner_operation_id,activated_at,activated_by) VALUES(1,1,'test','now','test')"));
   if(mode==='disk')f.setFail(2);
   if(mode==='recipient'){const r=await intakePersonnelMaterial(f.db,f.actor('sender'),{title:'材料',text});assert.deepEqual(r.recipients.map(p=>p.memberId),['a']);}
   else{await assert.rejects(intakePersonnelMaterial(f.db,f.actor('sender'),{title:'材料',text}));assert.equal(f.sqlite.prepare('SELECT count(*) n FROM personnel_weekly_entries').get().n,0);}
  }finally{f.sqlite.close();}
 }
});
test('本人确认 is required, only the person may confirm; either configured independent technical reviewer produces accepted evidence',async()=>{
 const f=fixture();try{
  await intakePersonnelMaterial(f.db,f.actor('sender'),{title:'材料',text});
  const w=f.sqlite.prepare("SELECT * FROM personnel_weekly_entries WHERE member_id='a'").get();
  assert.equal(weeklyAccepted({...w,approval_status:'已归档'},weeklyReviewPayload({},f.policy,'a@example.com')),false);
  const ctx={current:{profiles:roster},token:'mutation',now:'now',actor:'a',guard:'1',auth:[],revision:1,finish:async(db,statements)=>{await db.batch(statements);return {saved:true};}};
  await assert.rejects(mutateWorkflow(f.db,f.actor('sender'),{action:'work_submit',id:w.id,title:w.title,content:w.content},ctx),/只能本人/);
  const submitted=await mutateWorkflow(f.db,f.actor('a'),{action:'work_submit',id:w.id,title:w.title,content:w.content},ctx);assert.equal(submitted.nativeApproval.payload.circulationApprovers.length,2);
  for(const technical of f.policy.technical){const p=weeklyReviewPayload({circulationContent:w.content},f.policy,'a@example.com');p.circulationApprovals=[{...technical,confirmedAt:'now'}];assert.equal(weeklyAccepted({...w,confirmed_at:'now',approval_status:'已归档'},p),true);}
 }finally{f.sqlite.close();}
});
test('homepage and assistant answers use the same confirmed approved category content; unapproved drafts never count',async()=>{
 const f=fixture();try{
  await intakePersonnelMaterial(f.db,f.actor('sender'),{title:'材料',text});
  const w=f.sqlite.prepare("SELECT * FROM personnel_weekly_entries WHERE member_id='a'").get();
  const p=weeklyReviewPayload({circulationContent:w.content},f.policy,'a@example.com');p.circulationApprovals=[{...f.policy.technical[1],confirmedAt:'now'}];
  f.sqlite.prepare("INSERT INTO approvals(id,type,title,project,requester_name,requester_email,created_at,updated_at,status,current_step,owner,payload_json,client_creation_key) VALUES('approval-a','流转审批','确认单','lab','陈绿平','a@example.com','now','now','已归档','已归档','陈绿平',?,?)").run(JSON.stringify(p),w.client_key);
  f.sqlite.exec("UPDATE personnel_weekly_entries SET confirmed_at='now' WHERE member_id='a'");
  const workflow=await workflowOverview(f.db,f.actor('sender'));const approved=workflow.weekly.find(x=>x.member_id==='a');assert.equal(approved.accepted,true);assert.match(approved.categories.procurement,/128/);
  const profile={id:'a',name:'陈绿平',work:[],labor:[],purchases:[],billPersonId:'',acceptedWorkCount:0};
  const answer=personnelAnswer({profiles:[profile],people:[],records:[],workflow},f.actor('sender'),'陈绿平取得的成果');assert.match(answer.answer,/128|回归验证/);assert.doesNotMatch(answer.answer,/抓取模块/);
  f.sqlite.exec("UPDATE approvals SET status='已退回' WHERE id='approval-a'");const returned=await workflowOverview(f.db,f.actor('sender'));assert.equal(returned.weekly.find(x=>x.member_id==='a').accepted,false);
  assert.doesNotMatch(personnelAnswer({profiles:[profile],people:[],records:[],workflow:returned},f.actor('sender'),'陈绿平取得的成果').answer,/回归验证/);
 }finally{f.sqlite.close();}
});
test('making a weekly document from material already received never creates a second statement',async()=>{
 const f=fixture();try{
  await intakePersonnelMaterial(f.db,f.actor('sender'),{title:'9月材料',text});
  const task=await createTask(f.db,f.actor('sender'),{kind:'meeting_minutes',title:'9月材料',instruction:'整理',material:text},'oa:source-test');
  f.sqlite.prepare("UPDATE ai_workbench_tasks SET status='succeeded',result='生成的周会总结正文' WHERE id=?").run(task.id);
  assert.equal(f.sqlite.prepare('SELECT count(*) n FROM personnel_weekly_entries').get().n,2);assert.equal(f.sqlite.prepare('SELECT count(*) n FROM personnel_material_task_links').get().n,1);
 }finally{f.sqlite.close();}
});
test('joint work is assigned to each named member, plans are not achievements and shared purchases remain unallocated',()=>{
 const r=extractPersonnelMaterial('陈绿平、林子昕共同完成导航接口测试。\n陈绿平与林子昕采购线缆，共计128元。\n## 陈绿平\n### 取得的成果\n下周计划完成导航算法验证。',roster);
 assert.deepEqual(r.entries.map(e=>e.memberId),['a','b']);assert.ok(r.entries.every(e=>e.work.some(q=>q.includes('共同完成'))));
 assert.ok(r.entries.every(e=>e.achievement.some(q=>q.includes('共同完成'))));assert.ok(r.entries.every(e=>!e.procurement.length));
 assert.ok(r.entries.every(e=>e.achievement.every(q=>!q.includes('下周'))));assert.match(r.unresolved[0].reason,/共同采购/);
});
test('account rebinding cannot let another account confirm a material assignment',async()=>{
 const f=fixture();try{
  await intakePersonnelMaterial(f.db,f.actor('sender'),{title:'材料',text});const w=f.sqlite.prepare("SELECT * FROM personnel_weekly_entries WHERE member_id='a'").get();
  const changed={...f.actor('a'),accountUserId:'new-account'};
  await assert.rejects(mutateWorkflow(f.db,changed,{action:'work_submit',id:w.id,title:w.title,content:w.content},{current:{profiles:roster},token:'mutation',now:'now',actor:'a',guard:'1',auth:[],revision:1,finish:async()=>{throw new Error('must not mutate')}}),/本人账号已变化/);
 }finally{f.sqlite.close();}
});
test('archiving the same received source and rerunning the additive migration preserve one set of personal confirmations',async()=>{
 const f=fixture();try{
  const receipt=await intakePersonnelMaterial(f.db,f.actor('sender'),{title:'9月周报',text});
  f.sqlite.exec("INSERT INTO knowledge_items(id,project,title,category,submitter_member_id,submitter_name,submitter_email,mutation_revision) VALUES('k','project','9月周报','周报','sender','马淦','sender@example.com','k1')");
  f.sqlite.prepare("INSERT INTO knowledge_revisions(id,item_id,revision_no,title,category,content,content_hash,created_by_member_id,created_by_name,created_by_email) VALUES('r1','k',1,'9月周报','周报',?,?,'sender','马淦','sender@example.com')").run(text,'a'.repeat(64));
  f.sqlite.exec("UPDATE knowledge_items SET current_revision_id='r1',current_revision_no=1 WHERE id='k'; INSERT INTO knowledge_events(id,item_id,revision_id,actor_member_id,actor_name,actor_email,action,note,created_at) VALUES('event','k','r1','sender','马淦','sender@example.com','submitted','','now')");
  assert.equal(f.sqlite.prepare('SELECT count(*) n FROM personnel_weekly_entries').get().n,2);
  f.sqlite.exec(readFileSync(new URL('../migrations/personnel-material-intake-20261011.sql',import.meta.url),'utf8'));
  assert.equal((await readMaterialReceipt(f.db,f.actor('sender'),receipt.id)).recipients.length,2);
 }finally{f.sqlite.close();}
});
test('material API rejects cross-origin/forged recipient data and returns verifiable default submission and recovery receipts',async()=>{
 const f=fixture();try{
  globalThis.__aiWorkbenchTest={actor:f.actor('sender'),env:{DB:f.db}};
  const req=(body={title:'材料',text},origin='https://oa.test')=>new Request('https://oa.test/api/personnel-materials',{method:'POST',headers:{origin,'content-type':'application/json'},body:JSON.stringify(body)});
  assert.equal((await api.POST(req(undefined,'https://foreign.test'))).status,403);assert.equal((await api.POST(req({title:'材料',text,memberIds:['owner']}))).status,400);
  const response=await api.POST(req());assert.equal(response.status,201,await response.clone().text());const {receipt}=await response.json();assert.equal(receipt.recipients.length,2);
  assert.equal((await api.POST(req())).status,200);assert.equal((await api.GET(new Request('https://oa.test/api/personnel-materials?id='+receipt.id))).status,200);
  globalThis.__aiWorkbenchTest.actor=f.actor('a');assert.equal((await api.GET(new Request('https://oa.test/api/personnel-materials?id='+receipt.id))).status,404);
 }finally{f.sqlite.close();delete globalThis.__aiWorkbenchTest;}
});
test('OA research conversation uses only a fixed authenticated local OA endpoint, never public Chat or redirects',async()=>{
 const calls=[];const ask=createOaResearchConversation({port:3000,fetchImpl:async(url,options)=>{calls.push({url,options});return Response.json({answer:'陈绿平的已审核成果：完成回归验证。',mode:'personnel'});}});
 const request=new Request('https://oa.omindos.cn/api/ai-members/conversations/ai-research/messages',{headers:{cookie:'verified-oa-session'}});
 const r=await ask(request,'陈绿平取得的成果',{history:[{role:'assistant',content:'不可信答案'},{role:'user',content:'陈绿平做了什么'}]});assert.match(r.answer,/回归/);assert.equal(calls[0].url,'http://127.0.0.1:3000/api/lab-ai/ask');assert.equal(calls[0].options.redirect,'error');assert.equal(calls[0].options.headers.cookie,'verified-oa-session');assert.deepEqual(JSON.parse(calls[0].options.body).history,[{role:'user',content:'陈绿平做了什么'}]);
 await assert.rejects(createOaResearchConversation({port:3000,fetchImpl:async()=>new Response('',{status:302,headers:{location:'https://external.test'}})})(request,'成员情况'));
});
test('only the verified human OA research conversation can use private material handling; other AI roles stay on the public path',async()=>{
 const store=new AiMemberStore(':memory:');try{
  for(const id of ['ai-research','ai-tutor'])store.db.prepare("INSERT INTO ai_members(id,display_name,owner_ref,admission_version,enabled,created_at) VALUES(?,?,'owner','v1',1,1)").run(id,id);
  let privateCalls=0,publicCalls=0;
  const handle=createAiMembersHandler({store,audience:'oa',origin:'https://oa.test',courses:[{id:'c1',title:'课程'}],courseVersion:'v1',verifyMember:async()=>({id:'human',actorType:'human',admitted:true}),publicAsk:async()=>{publicCalls++;return {answer:'公开课程答复'};},privateConversationAsk:async()=>{privateCalls++;return {answer:'真实 OA 收件回执'};}});
  const request=id=>new Request('https://oa.test/api/ai-members/conversations/'+id+'/messages',{method:'POST',headers:{origin:'https://oa.test','content-type':'application/json'},body:JSON.stringify({message:'陈绿平取得的成果',idempotencyKey:'test-message-'+id})});
  const r=await handle(request('ai-research'));assert.equal(r.status,200,await r.clone().text());assert.equal(privateCalls,1);assert.equal(publicCalls,0);
  await handle(request('ai-research'));assert.equal(privateCalls,1);await handle(request('ai-tutor'));assert.equal(publicCalls,1);
 }finally{store.close();}
});
