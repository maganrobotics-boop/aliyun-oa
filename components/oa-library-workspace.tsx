'use client';

/* eslint-disable react-hooks/set-state-in-effect */
import { useCallback, useEffect, useRef, useState } from 'react';
import { BookOpen, RefreshCw, Search } from 'lucide-react';
import { OaRichAnswer } from './knowledge/oa-rich-answer';
import type { KnowledgeAsset, KnowledgeDetailResponse, KnowledgeItem } from '@/lib/knowledge-types';

const labels: Record<string, string> = { pending: '待审核', returned: '已退回', rejected: '已拒绝', active: '已入库', revoked: '已撤销' };
export function OaLibraryWorkspace({ onMine, onManage, canManage = false }: { onMine: () => void; onManage: () => void; canManage?: boolean }) {
  const [items, setItems] = useState<KnowledgeItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<KnowledgeItem | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState('');
  const [assets, setAssets] = useState<KnowledgeAsset[]>([]);
  const sequence = useRef(0);
  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const response = await fetch('/api/knowledge?scope=all', { credentials: 'same-origin', cache: 'no-store', headers: { accept: 'application/json' } });
      const data = await response.json() as { items?: KnowledgeItem[]; error?: string };
      if (!response.ok || !Array.isArray(data.items)) throw new Error(data.error || '资料列表暂不可用');
      setItems(data.items);
    } catch (cause) { setError(cause instanceof Error ? cause.message : '资料列表暂不可用'); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { void load(); return () => { sequence.current += 1; }; }, [load]);
  const open = async (item: KnowledgeItem) => {
    const request = ++sequence.current; setSelected(item); setAssets([]); setDetailLoading(true); setDetailError('');
    try {
      const response = await fetch(`/api/knowledge/${encodeURIComponent(item.id)}`, { credentials: 'same-origin', cache: 'no-store', headers: { accept: 'application/json' } });
      const data = await response.json() as KnowledgeDetailResponse & { error?: string };
      if (!response.ok || !data.item || data.item.id !== item.id) throw new Error(data.error || '资料正文暂不可用');
      if (request === sequence.current) {
        const revision = data.revisions?.find(value => value.id === data.item?.currentRevisionId) || [...(data.revisions || [])].sort((a, b) => (b.revisionNo || 0) - (a.revisionNo || 0))[0];
        setSelected({ ...data.item, content: revision?.content || data.item.content || '' });
        setAssets(data.assets || []);
      }
    } catch (cause) { if (request === sequence.current) setDetailError(cause instanceof Error ? cause.message : '资料正文暂不可用'); }
    finally { if (request === sequence.current) setDetailLoading(false); }
  };
  const visible = items.filter(item => !query.trim() || `${item.title} ${item.summary || ''} ${item.category}`.toLowerCase().includes(query.trim().toLowerCase()));
  if (selected) return <section className="oa-library-workspace"><button type="button" className="oa-library-back" onClick={() => { sequence.current += 1; setSelected(null); }}>← 返回资料库</button><header><div><span>{selected.category} · {labels[selected.status] || selected.status}</span><h1>{selected.title}</h1></div></header>{detailLoading ? <p role="status">正在读取正文…</p> : detailError ? <div role="alert"><p>{detailError}</p><button type="button" onClick={() => void open(selected)}>重试</button></div> : <><p>{selected.summary}</p><small>版本：{selected.currentRevisionNo || '未标记'} · 来源：{selected.sourceLabel || '未填写来源说明'}</small><div className="oa-library-content"><OaRichAnswer answer={selected.content || '本条记录没有可显示的正文。'} assets={assets} /></div></>}</section>;
  return <section className="oa-library-workspace"><header><div><span>获准访问的资料</span><h1>资料库</h1><p>展示当前账号有权查看的资料，审核与可见范围由 OA 记录决定。</p></div><button type="button" onClick={() => void load()} disabled={loading}><RefreshCw />刷新</button></header><div className="oa-library-tools"><label><Search aria-hidden="true" /><input value={query} onChange={event => setQuery(event.target.value)} placeholder="筛选本次加载的标题、摘要与分类" aria-label="筛选已加载资料" /></label><button type="button" onClick={onMine}>我的提交</button>{canManage && <button type="button" onClick={onManage}>审核与管理</button>}</div>{loading ? <p className="project-empty" role="status">正在读取资料…</p> : error ? <p className="project-error" role="alert">{error}</p> : <><p className="project-section-note">当前加载 {items.length} 条；这里只筛选已加载记录，不代表全部历史资料。</p>{visible.length ? <div className="oa-library-grid">{visible.map(item => <button type="button" className="oa-library-card" key={item.id} onClick={() => void open(item)}><span><BookOpen />{item.category}<small>{labels[item.status] || item.status}</small></span><h2>{item.title}</h2><p>{item.summary || '未填写摘要'}</p><small>查看正文与版本 →</small></button>)}</div> : <p className="project-empty">{query.trim() ? '已加载资料中没有匹配项，请调整关键词。' : '目前没有当前账号可查看的资料。'}</p>}</>}</section>;
}
