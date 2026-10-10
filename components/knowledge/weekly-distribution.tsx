'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';

type Person = { id: string; fullName: string; ndaCompleted: boolean };
type Delivery = { mutationRevision: string; title: string; sourceChanged: boolean; members: { memberId: string; name: string }[] };

export function KnowledgeWeeklyDistribution({ itemId }: { itemId: string }) {
  const [open, setOpen] = useState(false);
  return <section className="oa-weekly-distribution">
    <p>工作记录需由本人确认，再经石老师或冯永玄任一人审核，进入个人主页。</p>
    <Link href="/people-workbench?person=me&tab=work">核对我的工作量 →</Link>
    <button type="button" aria-expanded={open} onClick={() => setOpen(value => !value)}>{open ? '收起参与成员' : '分发给周会参与成员'}</button>
    {open && <DistributionForm key={itemId} itemId={itemId} />}
  </section>;
}

function DistributionForm({ itemId }: { itemId: string }) {
  const [people, setPeople] = useState<Person[]>([]), [delivery, setDelivery] = useState<Delivery | null>(null);
  const [ids, setIds] = useState<string[]>([]), [busy, setBusy] = useState(false), [loading, setLoading] = useState(true);
  const [error, setError] = useState(''), [message, setMessage] = useState(''), [reload, setReload] = useState(0);
  const locked = useRef(false);
  const endpoint = `/api/knowledge/${encodeURIComponent(itemId)}/participants`;
  useEffect(() => {
    const controller = new AbortController();
    const init = { credentials: 'same-origin' as const, cache: 'no-store' as const, signal: controller.signal };
    void Promise.all([fetch(endpoint, init), fetch('/api/people', init)]).then(async ([sourceResponse, peopleResponse]) => {
      const source = await sourceResponse.json() as Delivery & { error?: string };
      if (!sourceResponse.ok) throw new Error(source.error || '分发状态加载失败。');
      const directory = await peopleResponse.json() as { people?: Person[]; error?: string };
      if (!peopleResponse.ok) throw new Error(directory.error || '成员目录加载失败。');
      if (!controller.signal.aborted) {
        setDelivery(source); setPeople((directory.people || []).filter(p => p.ndaCompleted && !p.id.startsWith('account:'))); setLoading(false);
      }
    }).catch(cause => { if (!controller.signal.aborted) { setError(cause instanceof Error ? cause.message : '加载失败。'); setLoading(false); } });
    return () => controller.abort();
  }, [endpoint, reload]);

  async function distribute() {
    if (locked.current || !delivery || !ids.length) return;
    locked.current = true; setBusy(true); setError(''); setMessage('');
    try {
      const response = await fetch(endpoint, { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ memberIds: ids, mutationRevision: delivery.mutationRevision }), signal: AbortSignal.timeout(30000) });
      const result = await response.json() as { saved?: boolean; count?: number; error?: string };
      if (!response.ok || !result.saved) throw new Error(result.error || '分发结果未确认，请刷新核对。');
      setMessage(`已为 ${result.count} 位参与人生成独立确认单，请各自在“我的工作量”核对。重复分发不会重复建单。`);
      setIds([]); setLoading(true); setReload(value => value + 1);
    } catch (cause) { setError(cause instanceof Error ? cause.message : '分发失败，请刷新核对。'); }
    finally { locked.current = false; setBusy(false); }
  }
  const already = new Set(delivery?.members.map(p => p.memberId) || []);
  return <div className="oa-weekly-distribution-form">
    <p>选择实际参与人。他们将看到这份周会正文，并分别填写自己的工作内容；集体成果不会自动计为个人贡献。</p>
    {delivery?.sourceChanged && <p role="status">原资料已有修改。已有工作确认单保留首次保存的正文，后续参与人也收到同一份正文；新一轮工作请另传一份周报或周会。</p>}
    {delivery && <p>确认单来源：{delivery.title}。已分发 {delivery.members.length} 人{delivery.members.length ? `：${delivery.members.map(p => p.name).join('、')}` : ''}。</p>}
    {loading ? <p role="status">正在读取成员与分发状态…</p> : delivery && <fieldset disabled={busy}>
      <legend>参与成员（最多 50 人）</legend>
      <div className="oa-weekly-member-list">{people.map(person => <label key={person.id}>
        <input type="checkbox" checked={already.has(person.id) || ids.includes(person.id)} disabled={already.has(person.id)}
          onChange={event => setIds(old => event.target.checked ? [...old, person.id] : old.filter(id => id !== person.id))} />
        <span>{person.fullName}{already.has(person.id) ? ' · 已分发' : ''}</span>
      </label>)}</div>
      {!people.length && <p>暂无已完成准入的可选成员。</p>}
    </fieldset>}
    <button type="button" disabled={busy || loading || !delivery || !ids.length || already.size + ids.length > 50} onClick={() => void distribute()}>{busy ? '正在分发…' : `生成各人的工作确认单${ids.length ? `（${ids.length} 人）` : ''}`}</button>
    {already.size + ids.length > 50 && <p role="alert">每份资料最多选择 50 位参与人。</p>}
    {error && <div role="alert"><p>{error}</p><button type="button" disabled={busy} onClick={() => { setError(''); setLoading(true); setDelivery(null); setReload(value => value + 1); }}>刷新分发状态</button></div>}
    {message && <p role="status">{message}</p>}
  </div>;
}
