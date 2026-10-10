'use client';
import {useEffect,useState} from 'react';
import Link from 'next/link';
export function WeeklyParticipants({taskId}:{taskId:string}) {
  const [people,setPeople]=useState<{id:string;fullName:string;ndaCompleted:boolean}[]>([]);
  const [ids,setIds]=useState<string[]>([]),[busy,setBusy]=useState(false),[message,setMessage]=useState(''),[error,setError]=useState('');
  useEffect(()=>{let alive=true;fetch('/api/people',{credentials:'same-origin',cache:'no-store'}).then(async r=>{if(!r.ok)throw new Error('成员目录暂不可用');return r.json() as Promise<{people?:{id:string;fullName:string;ndaCompleted:boolean}[]}>;}).then(d=>{if(alive)setPeople((d.people||[]).filter((p:{id:string;ndaCompleted:boolean})=>p.ndaCompleted&&!p.id.startsWith('account:')));}).catch(()=>{if(alive)setError('参与成员未能加载，请刷新。');});return()=>{alive=false;};},[]);
  async function save(){
    setBusy(true);setError('');setMessage('');
    try {const r=await fetch('/api/lab-ai/tasks/participants',{method:'POST',credentials:'same-origin',headers:{'content-type':'application/json'},body:JSON.stringify({id:taskId,memberIds:ids})});const d=await r.json() as {error?:string};if(!r.ok)throw new Error(d.error||'关联失败');setMessage('已分别生成工作确认单，等待各人核对；重复选择不会重复生成。');setIds([]);}
    catch(e){setError(e instanceof Error?e.message:'关联失败，请刷新核对。');}finally{setBusy(false);}
  }
  return <section className="weekly-participants"><h3>周报与周会工作确认</h3><p>本人确认单自动进入 OA 待办。集体总结请关联参与成员；每人只确认自己的工作量，由石老师或冯永玄任一人审核后进入个人主页。</p><Link href="/people-workbench?person=me&tab=work">核对我的工作量 →</Link>
    <details><summary>关联本次参与成员</summary><p>选中成员将看到这份总结，并分别填写本人的工作内容。使用已登记账号关联。</p><fieldset><legend>参与成员（最多 50 人）</legend>{people.map(p=><label key={p.id} style={{display:'flex',gap:8,alignItems:'center'}}><input type="checkbox" checked={ids.includes(p.id)} onChange={e=>setIds(old=>e.target.checked?[...old,p.id]:old.filter(id=>id!==p.id))}/>{p.fullName}</label>)}</fieldset><button disabled={busy||!ids.length||ids.length>50} onClick={()=>void save()}>{busy?'正在关联…':'生成各人的工作确认单'}</button></details>
    {error&&<p role="alert">{error}</p>}{message&&<p role="status">{message}</p>}
  </section>;
}
