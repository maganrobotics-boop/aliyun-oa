import { getAuthorizedUser } from '../../../_lib/auth';
import { getD1Database } from '../../../../../db';
import { readBoundedJsonObject } from '../../../../../lib/bounded-json-request';
import { readTask, taskActorGuard, type TaskActor } from '../../../../../lib/ai-workbench-store';
import { isMigrationWriteFrozen } from '../../../../../lib/migration-freeze';

const json=(data:unknown,status=200)=>Response.json(data,{status,headers:{'cache-control':'private, no-store',vary:'Cookie'}});
export async function POST(request:Request){
  try {
    if(request.headers.get('origin')!==new URL(request.url).origin||request.headers.get('sec-fetch-site')==='cross-site')return json({error:'请在 OA 内关联成员。'},403);
    if(isMigrationWriteFrozen(process.env))return json({error:'维护期间暂停修改。'},503);
    if(request.headers.get('content-type')?.split(';')[0]!=='application/json')return json({error:'请使用 JSON。'},415);
    const user=await getAuthorizedUser();
    if(!user?.ndaCompleted||!user.memberId||!user.accountUserId||!user.memberMutationRevision)return json({error:'请先完成成员准入。'},403);
    const parsed=await readBoundedJsonObject(request,12000);
    if(!parsed.ok)return json({error:'请求格式不正确。'},400);
    const {id,memberIds}=parsed.value;
    if(Object.keys(parsed.value).some(k=>!['id','memberIds'].includes(k))||typeof id!=='string'||!Array.isArray(memberIds)||!memberIds.length||memberIds.length>50||memberIds.some(x=>typeof x!=='string'||x.length>128)||new Set(memberIds).size!==memberIds.length)return json({error:'请选择 1–50 位参与成员。'},400);
    const db=await getD1Database(), actor:TaskActor={memberId:user.memberId,accountUserId:user.accountUserId,memberMutationRevision:user.memberMutationRevision};
    const task=await readTask(db,actor,id);
    if(!task||!['weekly_report','meeting_minutes'].includes(task.kind))return json({error:'只能关联本人周报或会议任务的参与成员。'},404);
    if(!['queued','succeeded'].includes(task.status))return json({error:'请等待任务完成后再关联成员。'},409);
    const rows=(await db.prepare(`SELECT id,account_user_id FROM members WHERE status='active' AND account_user_id IS NOT NULL AND nda_accepted_at IS NOT NULL AND id IN (${memberIds.map(()=>'?').join(',')})`).bind(...memberIds).all<{id:string;account_user_id:string}>()).results;
    if(rows.length!==memberIds.length)return json({error:'部分成员尚未完成准入，请重新选择。'},409);
    const total=await db.prepare('SELECT COUNT(*) n FROM personnel_task_participants WHERE task_id=? AND member_id NOT IN ('+memberIds.map(()=>'?').join(',')+')').bind(id,...memberIds).first<{n:number}>();
    if((total?.n||0)+memberIds.length>50)return json({error:'单份总结最多关联 50 位成员。'},409);
    const now=new Date().toISOString();
    await db.batch(rows.map(m=>db.prepare(`INSERT INTO personnel_task_participants(task_id,member_id,account_user_id,added_by_member_id,created_at)
      SELECT ?,?,?,?,? WHERE ${taskActorGuard} AND EXISTS(SELECT 1 FROM members WHERE id=? AND account_user_id=? AND status='active')
      AND (SELECT COUNT(*) FROM personnel_task_participants WHERE task_id=?)<50
      ON CONFLICT(task_id,member_id) DO NOTHING`).bind(id,m.id,m.account_user_id,user.memberId,now,user.memberId,user.accountUserId,user.memberMutationRevision,m.id,m.account_user_id,id)));
    const saved=(await db.prepare('SELECT member_id,account_user_id FROM personnel_task_participants WHERE task_id=?').bind(id).all<{member_id:string;account_user_id:string}>()).results;
    if(rows.some(m=>!saved.some(s=>s.member_id===m.id&&s.account_user_id===m.account_user_id)))return json({error:'权限或成员列表已变化，请刷新核对。'},409);
    return json({saved:true,count:rows.length});
  }catch{return json({error:'工作确认单尚未就绪，请联系管理员核对自动周报迁移。'},503);}
}
