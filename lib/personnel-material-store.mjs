import { extractPersonnelMaterial, isPersonnelMaterialMessage, materialContent, MATERIAL_MAX_TEXT } from './personnel-material.mjs';
import { LedgerError } from './expense-ledger.mjs';

// Preserve OA's administrator NDA bootstrap; ordinary accounts need the live NDA evidence.
const admitted = `(m.role='admin' OR (m.nda_accepted_at IS NOT NULL AND m.nda_agreement_version IS NOT NULL
 AND EXISTS(SELECT 1 FROM approvals nda WHERE nda.id=m.nda_approval_id AND nda.type='保密协议' AND nda.status='已归档'
 AND lower(nda.requester_email)=lower(m.chatgpt_account)
 AND CASE WHEN json_valid(nda.payload_json) THEN json_extract(nda.payload_json,'$.signerAccountUserId')=m.account_user_id
 AND json_extract(nda.payload_json,'$.agreementVersion')=m.nda_agreement_version ELSE 0 END)))`;
const actorGuard = `EXISTS(SELECT 1 FROM members m WHERE m.id=? AND m.account_user_id=? AND m.mutation_revision=? AND m.status='active' AND ${admitted})`;
const args = a => [a.memberId, a.accountUserId, a.memberMutationRevision];
const sha = async text => [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)))].map(x=>x.toString(16).padStart(2,'0')).join('');
export async function readMaterialReceipt(db, actor, id) {
  const intake = await db.prepare(`SELECT id,title,unresolved_json FROM personnel_material_intakes WHERE id=?
    AND sender_member_id=? AND sender_account_user_id=? AND ${actorGuard}`).bind(id, actor.memberId, actor.accountUserId, ...args(actor)).first();
  if (!intake) return null;
  const rows = (await db.prepare(`SELECT a.entry_id,a.member_id,m.full_name name,w.state,w.confirmed_at,
    p.id approval_id,p.status approval_status FROM personnel_material_assignments a JOIN members m ON m.id=a.member_id
    JOIN personnel_weekly_entries w ON w.id=a.entry_id
    LEFT JOIN approvals p ON p.client_creation_key=w.client_key AND lower(p.requester_email)=lower(m.chatgpt_account)
    WHERE a.intake_id=? ORDER BY m.full_name`).bind(id).all()).results;
  let unresolved=[];try{unresolved=JSON.parse(intake.unresolved_json);}catch{}
  return { id, title:intake.title, received:true, recipients:rows.map(r=>({memberId:r.member_id,name:r.name,entryId:r.entry_id,
    state:r.approval_id?'submitted_for_review':r.state==='draft'?'pending_self_confirmation':r.state,
    approvalId:r.approval_id||null,approvalStatus:r.approval_status||null})),unresolvedCount:unresolved.length,
    notice:'流程：OA 本人确认 → 石永亮或冯永玄任一人审核 → 个人主页。' };
}
export async function intakePersonnelMaterial(db, actor, input) {
  if (!actor?.memberId||!actor.accountUserId||!actor.memberMutationRevision) throw new LedgerError('请先完成 OA 实名准入。',403);
  const title=String(input?.title||'助研收到的材料').trim();const text=input?.text;
  if (!title||title.length>150||typeof text!=='string'||text.trim().length<2||text.length>MATERIAL_MAX_TEXT) throw new LedgerError('材料标题最多150字，正文须为2–30000字。',400);
  const ready=await db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='personnel_material_intakes'").first();
  if(!ready)throw new LedgerError('助研自动分类送审尚未部署，材料未提交；原文件仍保留。',503);
  if (!await db.prepare(`SELECT 1 WHERE ${actorGuard}`).bind(...args(actor)).first()) throw new LedgerError('当前身份或准入已变化。',403);
  const digest=await sha(text.replace(/\r\n?/gu,'\n').trim());
  const old=await db.prepare(`SELECT id FROM personnel_material_intakes WHERE sender_member_id=? AND sender_account_user_id=? AND content_sha256=? AND ${actorGuard}`).bind(actor.memberId,actor.accountUserId,digest,...args(actor)).first();
  if(old)return {...await readMaterialReceipt(db,actor,old.id),duplicate:true};
  const roster=(await db.prepare(`SELECT m.id,m.account_user_id accountUserId,m.full_name name,m.chatgpt_account email
    FROM members m WHERE m.status='active' AND m.account_user_id IS NOT NULL AND ${admitted}`).all()).results;
  const extracted=extractPersonnelMaterial(text,roster,{senderId:actor.memberId,title});
  if(extracted.entries.length>50)throw new LedgerError('单份材料最多关联50位成员，请分批发送。',400);
  const id=crypto.randomUUID(),now=new Date().toISOString();
  const sourceId=`(SELECT id FROM personnel_material_intakes WHERE sender_member_id=? AND sender_account_user_id=? AND content_sha256=?)`;
  const sourceArgs=[actor.memberId,actor.accountUserId,digest];
  const statements=[db.prepare(`INSERT INTO personnel_material_intakes(id,sender_member_id,sender_account_user_id,content_sha256,title,source_text,unresolved_json,created_at)
    SELECT ?,?,?,?,?,?,?,? WHERE ${actorGuard} AND (SELECT count(*) FROM personnel_material_intakes WHERE sender_member_id=? AND created_at>=?)<100
    ON CONFLICT(sender_member_id,sender_account_user_id,content_sha256) DO NOTHING`).bind(id,...sourceArgs,title,text,JSON.stringify(extracted.unresolved),now,...args(actor),actor.memberId,now.slice(0,10))];
  for(const entry of extracted.entries){
    const entryId='auto-material-'+crypto.randomUUID(),content=materialContent(entry);
    const sourceText=entry.quotes.join('\n');
    statements.push(db.prepare(`INSERT INTO personnel_weekly_entries(id,member_id,source_key,source_title,source_text,title,content,client_key,created_at,updated_at,mutation_token)
      SELECT ?,m.id,'material:'||${sourceId},?,?,?,?,'weekly-'||?, ?,?,'material-intake'
      FROM members m WHERE m.id=? AND m.account_user_id=? AND m.status='active' AND ${admitted}
      AND ${actorGuard} AND ${sourceId} IS NOT NULL
      ON CONFLICT(member_id,source_key) DO NOTHING`).bind(entryId,...sourceArgs,title,sourceText,title,content,entryId,now,now,entry.memberId,entry.accountUserId,...args(actor),...sourceArgs));
    statements.push(db.prepare(`INSERT INTO personnel_material_assignments(intake_id,member_id,account_user_id,entry_id,categories_json,created_at)
      SELECT ${sourceId},w.member_id,m.account_user_id,w.id,?,? FROM personnel_weekly_entries w JOIN members m ON m.id=w.member_id
      WHERE w.member_id=? AND w.source_key='material:'||${sourceId} AND m.account_user_id=? AND m.status='active' AND ${admitted}
      AND ${actorGuard} ON CONFLICT(intake_id,member_id) DO NOTHING`).bind(...sourceArgs,JSON.stringify({procurement:entry.procurement,work:entry.work,achievement:entry.achievement}),now,entry.memberId,...sourceArgs,entry.accountUserId,...args(actor)));
  }
  // Native D1/SQLite batch is atomic. A freeze, invalid statement or storage failure
  // cannot leave a success receipt with half of the confirmation records.
  await db.batch(statements);
  const saved=await db.prepare(`SELECT id FROM personnel_material_intakes WHERE sender_member_id=? AND sender_account_user_id=? AND content_sha256=? AND ${actorGuard}`).bind(...sourceArgs,...args(actor)).first();
  if(!saved)throw new LedgerError('身份已变化或今日材料数量已达上限，未提交。',409);
  const receipt=await readMaterialReceipt(db,actor,saved.id);
  if(!receipt)throw new LedgerError('收件结果暂不能核实，请核对原记录。',409);
  return {...receipt,duplicate:saved.id!==id};
}
export function materialReceiptAnswer(receipt){
  const people=receipt.recipients.map(p=>`${String(p.name).replace(/[<>`\[\]*\r\n]/gu,'')}：${p.approvalStatus?'OA '+p.approvalStatus:p.state==='pending_self_confirmation'?'待本人确认':p.state==='submitting'?'本人已确认，待核对审核申请':p.state==='disputed'?'异议处理中':'待核对原确认单'}`).join('；');
  return {answer:`${receipt.duplicate?'已找到同份材料，沿用原确认单。':'材料已收到。'}已按采购账单、从事的工作、取得的成果整理。${people?`当前记录：${people}。`:'尚未唯一识别对应人员，材料已保留，等待核对身份。'}本人确认后由石永亮或冯永玄任一人审核，通过后显示在个人主页。${receipt.unresolvedCount?'部分内容未能关联账号，请核对原文。':''}\n\n收件编号：${receipt.id}`,
    mode:'personnel',sourceType:'oa_personnel_records',citations:[],images:[],
    personnelLinks:receipt.recipients.map(p=>({name:p.name,href:'/people-workbench?person='+encodeURIComponent(p.memberId)+'&tab=work'}))};
}
export async function prepareTaskMaterial(db,actor,task){
  if(!isPersonnelMaterialMessage(task.material)||!await db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='personnel_material_task_links'").first())return null;
  return intakePersonnelMaterial(db,actor,{title:task.title,text:task.material});
}
export function taskMaterialLinkStatement(db,actor,originKey,intakeId){
  return db.prepare(`INSERT INTO personnel_material_task_links(task_id,intake_id)
    SELECT t.id,? FROM ai_workbench_tasks t WHERE t.origin='oa' AND t.origin_key=? AND t.member_id=? AND t.account_user_id=?
    AND ${actorGuard} ON CONFLICT(task_id) DO NOTHING`).bind(intakeId,originKey,actor.memberId,actor.accountUserId,...args(actor));
}
