'use client';

/* eslint-disable react-hooks/set-state-in-effect */
import { useCallback, useEffect, useRef, useState } from 'react';
import { BookOpen, ChevronRight, RefreshCw, Search, X } from 'lucide-react';
import { OaRichAnswer } from './knowledge/oa-rich-answer';
import type { KnowledgeAsset, KnowledgeDetailResponse, KnowledgeItem } from '@/lib/knowledge-types';
import { approvedKnowledgeScope as approvedScope, knowledgeScopeFilterOptions, knowledgeStateFilterOptions, matchesKnowledgeListFilters, type KnowledgeStateFilter as StateFilter, type KnowledgeScopeFilter as ScopeFilter } from '@/lib/knowledge-list-filters';

const labels: Record<string, string> = { pending: '待审核', returned: '已退回', rejected: '已拒绝', active: '已入库', revoked: '已撤销' };
export function OaLibraryWorkspace({ onMine, onManage, canManage = false }: { onMine: () => void; onManage: () => void; canManage?: boolean }) {
  const [items, setItems] = useState<KnowledgeItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const [stateFilter, setStateFilter] = useState<StateFilter>('all');
  const [scopeFilter, setScopeFilter] = useState<ScopeFilter>('all');
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
  useEffect(() => { const refresh = () => { void load(); }; refresh(); window.addEventListener("oa-library-updated", refresh); return () => { sequence.current += 1; window.removeEventListener("oa-library-updated", refresh); }; }, [load]);
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
  const keyword = query.trim().toLowerCase();
  const filtered = stateFilter !== 'all' || scopeFilter !== 'all' || Boolean(keyword);
  const visible = items.filter(item => {
    const matchesFilters = matchesKnowledgeListFilters(item, stateFilter, scopeFilter);
    const matchesQuery = !keyword || `${item.title} ${item.summary || ''} ${item.category}`.toLowerCase().includes(keyword);
    return matchesFilters && matchesQuery;
  });
  const clearFilters = () => { setQuery(''); setStateFilter('all'); setScopeFilter('all'); };
  if (selected) return <section className="oa-library-workspace oa-library-detail" data-layout="compact"><button type="button" className="oa-library-back" onClick={() => { sequence.current += 1; setSelected(null); }}>← 返回资料库</button><header><div><span>{selected.category} · {labels[selected.status] || selected.status}</span><h1>{selected.title}</h1></div></header>{detailLoading ? <p role="status">正在读取正文…</p> : detailError ? <div role="alert"><p>{detailError}</p><button type="button" onClick={() => void open(selected)}>重试</button></div> : <><p>{selected.summary}</p><small>版本：{selected.currentRevisionNo || '未标记'} · 来源：{selected.sourceLabel || '未填写来源说明'}</small><div className="oa-library-content"><OaRichAnswer answer={selected.content || '本条记录没有可显示的正文。'} assets={assets} /></div></>}</section>;
  return <section className="oa-library-workspace" data-layout="compact">
    <header>
      <div className="oa-library-heading"><h1>资料库</h1><span className="oa-library-count" role="status" aria-live="polite">{loading ? '加载中…' : `显示 ${visible.length} / ${items.length} 条`}</span></div>
      <div className="oa-library-actions">
        <button type="button" onClick={onMine}>我的提交</button>
        {canManage && <button type="button" onClick={onManage}>审核与管理</button>}
        <button type="button" onClick={() => void load()} disabled={loading} aria-label="刷新资料库"><RefreshCw aria-hidden="true" />刷新</button>
      </div>
    </header>
    <div className="oa-library-tools" role="search" aria-label="筛选资料库">
      <label className="oa-library-search"><Search aria-hidden="true" /><input type="search" value={query} onChange={event => setQuery(event.target.value)} placeholder="搜索标题、摘要或分类" aria-label="搜索已加载资料" /></label>
      <div className="oa-library-filters">
        <select value={stateFilter} onChange={event => setStateFilter(event.target.value as StateFilter)} aria-label="知识入库状态">
          {knowledgeStateFilterOptions.map(option => <option value={option.value} key={option.value}>{option.label}</option>)}
        </select>
        <select value={scopeFilter} onChange={event => setScopeFilter(event.target.value as ScopeFilter)} aria-label="知识可见范围">
          {knowledgeScopeFilterOptions.map(option => <option value={option.value} key={option.value}>{option.label}</option>)}
        </select>
        {filtered && <button type="button" className="oa-library-clear" onClick={clearFilters} aria-label="清除全部筛选" title="清除全部筛选"><X aria-hidden="true" /></button>}
      </div>
    </div>
    {loading ? <p className="project-empty" role="status">正在读取资料…</p> : error ? <p className="project-error" role="alert">{error}</p> : <>
      {visible.length ? <div className="oa-library-grid oa-library-list">{visible.map(item => {
        const scope = approvedScope(item);
        return <button type="button" className="oa-library-card oa-library-row" key={item.id} onClick={() => void open(item)} aria-label={`查看“${item.title}”的正文与版本`}>
          <BookOpen className="oa-library-row-icon" aria-hidden="true" />
          <span className="oa-library-row-body">
            <span className="oa-library-row-heading"><strong className="oa-library-row-title">{item.title}</strong><span className={`oa-library-status oa-library-status-${item.status}`}>{labels[item.status] || item.status}</span><span className={`oa-library-scope oa-library-scope-${scope}`}>{scope === 'public' ? '公开' : scope === 'internal' ? '对内' : '范围待定'}</span></span>
            <span className="oa-library-row-meta">{item.category}{item.summary ? ` · ${item.summary}` : ''}</span>
          </span>
          <ChevronRight className="oa-library-row-arrow" aria-hidden="true" />
        </button>;
      })}</div> : <p className="project-empty">{filtered ? '当前筛选下没有资料，可调整或清除筛选条件。' : '目前没有当前账号可查看的资料。'}</p>}
      <p className="oa-library-footnote">仅展示当前账号可见资料，本次最多加载 1000 条。{stateFilter === 'inactive' && ' 未入库包含待审核、退回、拒绝与已撤销的记录。'}</p>
    </>}
  </section>;
}
