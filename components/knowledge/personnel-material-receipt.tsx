'use client';
/* eslint-disable react-hooks/set-state-in-effect */
import { useCallback, useEffect, useRef, useState } from 'react';

type Receipt={id:string;received:boolean;duplicate:boolean;recipients:{name:string;memberId:string;state:string;approvalStatus?:string|null}[];unresolvedCount:number};
export function PersonnelMaterialReceipt({title,text}:{title:string;text:string}){
  const [receipt,setReceipt]=useState<Receipt|null>(null),[error,setError]=useState(''),[busy,setBusy]=useState(false);
  const generation=useRef(0);
  const submit=useCallback(async()=>{
    const version=++generation.current;setBusy(true);setError('');
    try{
      const response=await fetch('/api/personnel-materials',{method:'POST',credentials:'same-origin',cache:'no-store',
        headers:{'content-type':'application/json'},body:JSON.stringify({title:title.slice(0,150),text}),signal:AbortSignal.timeout(20000)});
      const data=await response.json().catch(()=>({})) as {receipt?:Receipt;error?:string};
      if(!response.ok||!data.receipt?.received)throw new Error(data.error||'材料送审结果尚未确认，请核对后重试。');
      if(version===generation.current){setReceipt(data.receipt);window.dispatchEvent(new Event('oa-personnel-updated'));}
    }catch(cause){if(version===generation.current)setError(cause instanceof Error&&cause.name!=='TimeoutError'?cause.message:'收件结果尚未确认。原材料保留，重试会沿用同份材料。');}
    finally{if(version===generation.current)setBusy(false);}
  },[title,text]);
  useEffect(()=>{void submit();return()=>{generation.current++;};},[submit]);
  return <div className="oa-source-archive" aria-label="助研材料自动送审">
    {busy&&<p role="status">正在按采购账单、从事的工作、取得的成果整理并提交 OA 本人确认待办…</p>}
    {receipt&&<><p role="status">{receipt.duplicate?'同份材料已收件，沿用原确认单。':'材料已收件。'}{!receipt.recipients.length&&'尚未唯一识别对应人员，材料已保留待核对。'}</p>
      {receipt.recipients.length>0&&<ul>{receipt.recipients.map(person=><li key={person.memberId}>{person.name}：{person.approvalStatus?'OA '+person.approvalStatus:person.state==='pending_self_confirmation'?'待本人确认':person.state==='submitting'?'本人已确认，待核对审核申请':person.state==='disputed'?'异议处理中':'待核对原确认单'}</li>)}</ul>}
      <p>本人确认后，由石永亮或冯永玄任一人审核，通过后显示在个人主页。</p>
      {receipt.unresolvedCount>0&&<p>部分内容尚未关联账号，请核对材料中的姓名。</p>}
      <p>收件编号：{receipt.id}</p><a href="/people-workbench?tab=work">查看本人确认与审核进度</a></>}
    {error&&<><p role="alert">{error}</p><button type="button" disabled={busy} onClick={()=>void submit()}>核对并重试送审</button></>}
  </div>;
}
