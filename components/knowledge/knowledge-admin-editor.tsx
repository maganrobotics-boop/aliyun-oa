'use client';

import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import type { KnowledgeAsset, KnowledgeDetailResponse, KnowledgeItem } from '@/lib/knowledge-types';
import { OaKnowledgeDraftFields, type KnowledgeTextDraft } from './oa-knowledge-draft-fields';

export function KnowledgeAdminEditor({ item, onSaved, onCancel, onReplace }: {
  item: { id: string; title: string }; onSaved: () => void; onCancel?: () => void; onReplace?: () => void;
}) {
  const [draft, setDraft] = useState<KnowledgeTextDraft>({ title: '', body: '' });
  const [snapshot, setSnapshot] = useState<KnowledgeItem | null>(null), [assets, setAssets] = useState<KnowledgeAsset[]>([]);
  const [loading, setLoading] = useState(true), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const [confirmed, setConfirmed] = useState(false), [reload, setReload] = useState(0);
  const live = useRef(true), lock = useRef(false);
  useEffect(() => {
    live.current = true; const controller = new AbortController();
    void fetch(`/api/knowledge/${encodeURIComponent(item.id)}`, { credentials: 'same-origin', cache: 'no-store', signal: AbortSignal.any([controller.signal, AbortSignal.timeout(30000)]) })
      .then(async response => {
        const data = await response.json() as KnowledgeDetailResponse;
        if (!response.ok || !data.item?.canAdminEdit || !data.item.mutationRevision) throw new Error(data.error || '当前账号无法编辑该资料。');
        const current = data.revisions?.find(revision => revision.id === data.item?.currentRevisionId);
        const body = current?.content ?? data.item.content;
        if (typeof body !== 'string' || !body.trim()) throw new Error('完整正文尚未加载，请重试。');
        if (!controller.signal.aborted) { setSnapshot(data.item); setDraft({ title: data.item.title, body }); setAssets(data.assets || []); setConfirmed(false); }
      }).catch(cause => { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : '资料暂时无法加载。'); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => { live.current = false; controller.abort(); };
  }, [item.id, reload]);
  async function save() {
    if (lock.current || !snapshot?.mutationRevision || !confirmed) return;
    lock.current = true; setBusy(true); setError('');
    try {
      const response = await fetch(`/api/knowledge/${encodeURIComponent(item.id)}/edit`, { method: 'PATCH', credentials: 'same-origin', cache: 'no-store', headers: { 'content-type': 'application/json' }, signal: AbortSignal.timeout(90000), body: JSON.stringify({ ...draft, mutationRevision: snapshot.mutationRevision }) });
      const data = await response.json() as { received?: boolean; item?: KnowledgeItem; error?: string };
      if (!response.ok || !data.received || !data.item) throw new Error(data.error || '保存结果尚未确认，请保留当前编辑内容。');
      if (live.current) onSaved();
    } catch (cause) { if (live.current) setError(cause instanceof Error ? cause.message : '保存失败，请重试。'); }
    finally { lock.current = false; if (live.current) setBusy(false); }
  }
  return <section className="oa-package-import" aria-label="管理员修改上传资料">
    <h2>修改题目和内容</h2><p>正在修改“{item.title}”。保存后保留当前审核状态、可见范围和修改历史。</p>
    {loading && <p role="status">正在加载完整正文和图片…</p>}
    {error && <p role="alert" className="oa-file-warning">{error}</p>}
    {!snapshot && !loading && <Button type="button" onClick={() => { setError(''); setLoading(true); setReload(value => value + 1); }}>重新加载</Button>}
    {snapshot && <><p>当前状态：{{ pending: '待审核', returned: '已退回', rejected: '已拒绝', active: '已入库', revoked: '已停止问答' }[snapshot.status]} · {snapshot.visibility === 'public' ? '对外公开' : 'OA 内部'}</p><OaKnowledgeDraftFields draft={draft} images={assets} disabled={busy} onChange={next => { setDraft(next); setConfirmed(false); }} />
      <label className="oa-package-confirm"><input type="checkbox" checked={confirmed} disabled={busy} onChange={event => setConfirmed(event.target.checked)} /><span>已核对题目、正文及图片说明，确认保存修改。</span></label>
      <Button type="button" disabled={!confirmed || busy || draft.title.trim().length < 2 || draft.body.trim().length < 10} onClick={() => void save()}>{busy ? '正在保存…' : '保存修改'}</Button></>}
    <Button type="button" variant="outline" disabled={busy} onClick={onCancel}>取消修改</Button>
    {snapshot?.status === 'active' && onReplace && <Button type="button" variant="outline" disabled={busy} onClick={onReplace}>重新上传整包资料</Button>}
  </section>;
}
