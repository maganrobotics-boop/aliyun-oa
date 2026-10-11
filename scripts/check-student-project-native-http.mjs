import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {createServer} from 'node:http';
import {DatabaseSync} from 'node:sqlite';
import {mkdirSync,readFileSync,writeFileSync} from 'node:fs';
const root=process.env.PROJECT_RELEASE_EVIDENCE_ROOT;assert(root,'PROJECT_RELEASE_EVIDENCE_ROOT required');
const testRoot=root+'/native-http-'+Date.now();mkdirSync(testRoot,{mode:0o700});
const oaRoot=process.env.PROJECT_APPLICATION_OA_ROOT;assert(oaRoot,'PROJECT_APPLICATION_OA_ROOT required');
const chatRoot=process.env.PROJECT_APPLICATION_CHAT_ROOT;assert(chatRoot,'PROJECT_APPLICATION_CHAT_ROOT required');
const {createLearning}=await import(chatRoot+'/aliyun/learning/service.mjs');
const oaOrigin='http://127.0.0.1:34061',chatOrigin='http://127.0.0.1:34062';
const email='student@project-release-qa.invalid',teacher='teacher@project-release-qa.invalid';
const secret='isolated-project-release-acceptance-secret-not-production';
const prodSchema=new DatabaseSync('/var/lib/originmind-oa/oa.sqlite',{readOnly:true}),oaDb=new DatabaseSync(testRoot+'/oa.sqlite');
for(const type of ['table','index','trigger']) for(const row of prodSchema.prepare("SELECT sql FROM sqlite_master WHERE type=? AND sql IS NOT NULL AND name NOT LIKE 'sqlite_%'").all(type))oaDb.exec(row.sql);
prodSchema.close();
oaDb.prepare('INSERT INTO members(id,full_name,chatgpt_account,account_user_id,role,status,mutation_revision) VALUES(?,?,?,?,?,?,?)').run('qa-teacher','发布验收测试老师',teacher,'email:'+teacher,'project_owner','active',crypto.randomUUID());
// Synthetic archived-NDA fixture in the isolated DB, never a real signature.
const at=new Date().toISOString(),ndaVersion='PROJECT-OWNER-PLEDGE-2026-09';
oaDb.prepare('INSERT INTO approvals(id,type,title,project,requester_name,requester_email,created_at,updated_at,status,current_step,owner,business_key,payload_json) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)').run('qa-nda','保密协议','合成测试准入夹具（非真实签署）','发布验收','发布验收测试老师',teacher,at,at,'已归档','归档','发布验收测试老师','nda|account:email:'+teacher+'|'+ndaVersion,JSON.stringify({agreementVersion:ndaVersion,signerAccountUserId:'email:'+teacher}));
Object.assign(process.env,{NODE_ENV:'production',OA_RUNTIME:'aliyun',OA_SQLITE_PATH:testRoot+'/oa.sqlite',OA_ASSETS_PATH:testRoot+'/assets',OA_ADMIN_EMAILS:teacher,OA_ADMIN_NAMES:'发布验收测试老师',PROJECT_APPLICATION_REVIEWER_EMAIL:teacher,OA_CHAT_SERVICE_ORIGIN:chatOrigin,PUBLIC_LAB_AI_SERVICE_TOKEN:secret});
const savedEnv=Object.fromEntries(readFileSync('/etc/originmind-chat/env','utf8').split('\n').filter(l=>l&&!l.startsWith('#')&&l.includes('=')).map(l=>{const i=l.indexOf('=');return [l.slice(0,i),l.slice(i+1).replace(/^(['"])(.*)\1$/,'$2')]}));
Object.assign(savedEnv,JSON.parse(execFileSync('python3',['-c',"import subprocess,shlex,json; s=subprocess.check_output(['systemctl','show','originmind-chat','--property=Environment','--value'],text=True); print(json.dumps({k:v for x in shlex.split(s) if '=' in x for k,v in [x.split('=',1)] if k.startswith('ROS2')}))"],{encoding:'utf8'})));
const learning=createLearning({root:chatRoot,databasePath:testRoot+'/learning.sqlite',env:{APP_ORIGIN:chatOrigin,PUBLIC_LAB_AI_SERVICE_TOKEN:secret,ROS2_ENDPOINT:savedEnv.ROS2_ENDPOINT,ROS2_KEY_FILE:savedEnv.ROS2_KEY_FILE,OA_SERVICE:{fetch:async request=>fetch(oaOrigin+new URL(request.url).pathname,{method:request.method,headers:request.headers,body:await request.text()})}},worker:{fetch:async request=>{
 const path=new URL(request.url).pathname;
 if(path==='/api/visitor/status')return Response.json({signedIn:true,user:{email}});
 if(path==='/api/newbie/dashboard')return Response.json({agreement:{approved:true}});
 return Response.json({error:'isolated fixture does not implement this path'},{status:404});
}}});
const chatServer=createServer(async(req,res)=>{
 try{let body='';for await(const chunk of req)body+=chunk;const request=new Request(chatOrigin+req.url,{method:req.method,headers:req.headers,...(!['GET','HEAD'].includes(req.method)?{body}:{})});const reply=await learning.handle(request);res.writeHead(reply?.status||404,Object.fromEntries(reply?.headers||[]));res.end(reply?Buffer.from(await reply.arrayBuffer()):'not found');}catch{res.writeHead(500);res.end('isolated fixture failed');}
});
await new Promise(resolve=>chatServer.listen(34062,'127.0.0.1',resolve));
process.chdir(oaRoot);
const {default:next}=await import(oaRoot+'/node_modules/next/dist/server/next.js');
const app=next({dev:false,dir:oaRoot,hostname:'127.0.0.1',port:34061});await app.prepare();
const oaServer=createServer(app.getRequestHandler());await new Promise(resolve=>oaServer.listen(34061,'127.0.0.1',resolve));
const learningDb=new DatabaseSync(testRoot+'/learning.sqlite');
async function req(origin,path,body,extra={}){
 const r=await fetch(origin+path,{method:body?'POST':'GET',headers:{origin:origin===oaOrigin?'http://localhost:34061':origin,'content-type':'application/json',...extra},...(body?{body:JSON.stringify(body)}:{})});
 const data=await r.json();return {status:r.status,data};
}
const proof={environment:'isolated databases, actual production candidate HTTP handlers; synthetic authentication fixture; real ROS2 runner',student:email,teacher,checks:[]};
const pass=message=>{proof.checks.push(message);console.log('PASS:',message)};
try{
 const initial=await req(chatOrigin,'/api/learning/course-project-selection');assert.equal(initial.status,200);
 const chosen=await req(chatOrigin,'/api/learning/course-project-selection',{courseId:'capstone-patrol',name:'发布验收测试学生（非真人）',studentNumber:'QA-RELEASE-20261011',expectedEmail:email,expectedSemesterId:initial.data.semester.id,idempotencyKey:crypto.randomUUID(),confirmed:true});
 assert.equal(chosen.status,200,JSON.stringify(chosen));assert.equal(chosen.data.selected.oaDelivered,true,chosen.data.selected.oaError);proof.courseApplicationId=chosen.data.selected.applicationId;
 const row=oaDb.prepare('SELECT * FROM approvals WHERE id=?').get(proof.courseApplicationId);
 assert.equal(row.status,'待审核');assert.equal(row.current_reviewer_email,teacher);assert.equal(JSON.parse(row.payload_json).projectApplication.selection.studentNumber,'QA-RELEASE-20261011');
 const progress=await req(chatOrigin,'/api/learning/progress');assert(progress.data.progress.availableCourseIds.includes('capstone-patrol'));assert(!progress.data.progress.availableCourseIds.includes('robot-manipulation'));
 pass('Course selection creates native OA pending item with name/student number and opens only the selected project.');
 const fields={name:'发布验收测试学生（非真人）',school:'测试学校、机器人专业',academicResults:'测试材料，无真实成绩',introduction:'自动发布验收使用的合成身份，不代表任何真实学生。',experience:'仅验证申请、审批和课程权限回传。',project:'Q1 四足巡检机器人',availability:'测试数据，无实际加入承诺'};
 const application=()=>({fields,labProjectId:'q1',files:[],expectedEmail:email,idempotencyKey:crypto.randomUUID(),confirmed:true});
 assert.equal((await req(chatOrigin,'/api/learning/project-application',application())).status,403);pass('Lab application is rejected before a real final-challenge pass.');
 const commands=[['forward',.5,0],['faster',1,0],['left',0,.5],['right',0,-.5],['arc',.5,.5],['faster-turn',.5,1],['stop',0,0]].map(([id,linear,angular])=>({id,linear,angular}));
 const graduation=await req(chatOrigin,'/api/learning/graduation',{commands,reflection:'本次为合成测试账号实际运行七段 ROS2 指令，核验直行、速度调节、左右转弯和停车。',aiHelp:'由自动发布验收脚本构造指令；不是学生成绩。',idempotencyKey:crypto.randomUUID()});
 assert.equal(graduation.status,201,JSON.stringify(graduation));assert.equal(graduation.data.record.status,'passed');assert.equal(graduation.data.record.result.source,'server-turtlesim');proof.rosRunId=graduation.data.record.result.runId;pass('Synthetic student completed actual ROS2 turtlesim final challenge with measured motion evidence.');
 const submitted=await req(chatOrigin,'/api/learning/project-application',application());assert.equal(submitted.status,200,JSON.stringify(submitted));assert.equal(submitted.data.received,true);proof.labApplicationId=submitted.data.id;
 const id=proof.labApplicationId;
 const reply={reply:'发布验收：已核对测试申请，开放机械臂项目课程。此记录不代表真实学生录取。',courseIds:['robot-manipulation'],idempotencyKey:crypto.randomUUID()};
 assert.equal((await req(oaOrigin,'/api/project-applications/'+id+'/reply',reply)).status,401);
 const wrong=await req(oaOrigin,'/api/project-applications/'+id+'/reply',reply,{'oai-authenticated-user-email':'other@project-release-qa.invalid'});assert([401,403].includes(wrong.status));
 const answer=await req(oaOrigin,'/api/project-applications/'+id+'/reply',reply,{'oai-authenticated-user-email':teacher});
 assert.equal(answer.status,200,JSON.stringify(answer));assert.equal(answer.data.delivered,true,JSON.stringify(answer));pass('Actual OA reply HTTP route invokes native approval, rejects unauthorized callers, and delivers signed permissions.');
 const final=await req(chatOrigin,'/api/learning/project-application');assert(final.data.replies.some(r=>r.reply===reply.reply&&r.courseIds.includes('robot-manipulation')));
 const after=await req(chatOrigin,'/api/learning/progress');assert(after.data.progress.availableCourseIds.includes('robot-manipulation'));
 const archived=oaDb.prepare('SELECT status,current_revision_no FROM approvals WHERE id=?').get(id);assert.equal(archived.status,'已归档');assert(archived.current_revision_no>=2);
 assert.equal(oaDb.prepare("SELECT count(*) n FROM approval_events WHERE approval_id=? AND action='approve'").get(id).n,1);
 const retry=await req(oaOrigin,'/api/project-applications/'+id+'/reply',reply,{'oai-authenticated-user-email':teacher});assert.equal(retry.data.idempotent,true);
 assert.equal(learningDb.prepare('SELECT count(*) n FROM learning_project_decisions WHERE application_id=?').get(id).n,1);
 pass('Reply visible to the student, granted chapter open, native immutable approval archived, and retry remains idempotent.');
 proof.completedAt=new Date().toISOString();proof.result='passed';writeFileSync(root+'/native-http-proof.json',JSON.stringify(proof,null,2));console.log('NATIVE_HTTP_ACCEPTANCE_PASSED');
}finally{learningDb.close();oaDb.close();learning.close();await new Promise(r=>chatServer.close(r));await new Promise(r=>oaServer.close(r));await app.close();}
