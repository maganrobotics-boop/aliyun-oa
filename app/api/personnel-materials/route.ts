import { getD1Database } from '../../../db';
import { getAuthorizedUser } from '../_lib/auth';
import { readBoundedJsonObject } from '../../../lib/bounded-json-request';
import { isMigrationWriteFrozen } from '../../../lib/migration-freeze';
import { intakePersonnelMaterial, readMaterialReceipt } from '../../../lib/personnel-material-store.mjs';

const json=(body:unknown,status=200)=>Response.json(body,{status,headers:{'cache-control':'private, no-store',vary:'Cookie'}});
async function access(){
  const user=await getAuthorizedUser();
  if(!user?.ndaCompleted||!user.memberId||!user.accountUserId||!user.memberMutationRevision)return null;
  return {memberId:user.memberId,accountUserId:user.accountUserId,memberMutationRevision:user.memberMutationRevision};
}
export async function GET(request:Request){
  const actor=await access();if(!actor)return json({error:'请先登录并完成 OA 准入。'},403);
  const url=new URL(request.url),id=url.searchParams.get('id');
  if(!id||!/^[0-9a-f-]{36}$/iu.test(id)||[...url.searchParams.keys()].some(k=>k!=='id'))return json({error:'收件编号不正确。'},400);
  try{const receipt=await readMaterialReceipt(await getD1Database(),actor,id);return receipt?json({receipt}):json({error:'材料不存在或无权查看。'},404);}
  catch{return json({error:'暂不能核对收件记录。'},503);}
}
export async function POST(request:Request){
  if(request.headers.get('origin')!==new URL(request.url).origin||request.headers.get('sec-fetch-site')==='cross-site')return json({error:'请从 OA 助研发送材料。'},403);
  if(isMigrationWriteFrozen(process.env))return json({error:'维护期间暂停提交；原材料仍保留。'},503);
  const actor=await access();if(!actor)return json({error:'请先登录并完成 OA 准入。'},403);
  if(request.headers.get('content-type')?.split(';')[0].trim().toLowerCase()!=='application/json')return json({error:'请使用 JSON 发送材料。'},415);
  const parsed=await readBoundedJsonObject(request,160000);
  if(!parsed.ok||Object.keys(parsed.value||{}).some(k=>!['title','text'].includes(k)))return json({error:'材料格式错误或超过大小限制。'},400);
  try{const receipt=await intakePersonnelMaterial(await getD1Database(),actor,parsed.value);return json({receipt},receipt.duplicate?200:201);}
  catch(error){const e=error as {status?:number;message?:string};return json({error:e.status?e.message:'材料送审结果暂不能核实，原材料保留；请核对后重试。'},e.status||503);}
}
