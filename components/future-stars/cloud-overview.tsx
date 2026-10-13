'use client';
/* eslint-disable react-hooks/set-state-in-effect */
import { useEffect, useState } from 'react';
import { ChevronLeft, ChevronRight, ExternalLink, RefreshCw, Search, Trophy, UsersRound } from 'lucide-react';

type Visitor = { id: string; kind: 'account' | 'guest'; displayName: string; firstSeen: number; lastSeen: number; visits: number };
type Dashboard = { asOf: number; trackingStartedAt: number; summary: { onlineCounts: Record<string, { accounts: number; guests: number }> }; records: Visitor[]; pagination: { page: number; total: number; totalPages: number } };
const windows = [{ id: '24h', label: '过去24小时' }, { id: '3d', label: '近3天' }, { id: '7d', label: '近7天' }];
const date = (value: number) => new Date(value).toLocaleString('zh-CN', { hour12: false, timeZone: 'Asia/Shanghai' });

export function CloudOverview({ onAwards }: { onAwards: () => void }) {
  const [window, setWindow] = useState('24h'), [kind, setKind] = useState('all'), [sort, setSort] = useState('recent');
  const [search, setSearch] = useState(''), [q, setQ] = useState(''), [page, setPage] = useState(1), [revision, setRevision] = useState(0);
  const [data, setData] = useState<Dashboard | null>(null), [loading, setLoading] = useState(true), [error, setError] = useState('');
  useEffect(() => {
    const controller = new AbortController(); setLoading(true); setError(''); setData(null);
    const params = new URLSearchParams({ view: 'cloud', window, kind, sort, q, page: String(page) });
    void fetch('/api/admin/future-stars?' + params, { credentials: 'same-origin', cache: 'no-store', signal: controller.signal }).then(async response => {
      const body = await response.json() as Dashboard & { error?: string };
      if (!response.ok) throw new Error(body.error || 'Cloud 上线统计暂不可用。');
      if (!controller.signal.aborted) setData(body);
    }).catch(reason => { if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : '读取未完成。'); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [window, kind, sort, q, page, revision]);
  return <div className="fs-cloud-overview">
    <div className="fs-time-cards" aria-label="Cloud 近期上线统计">{windows.map(item => <button key={item.id} type="button" className="fs-time-card" aria-pressed={window === item.id} onClick={() => { setWindow(item.id); setPage(1); }}>
      <span>{item.label}</span><strong>{loading || !data ? '—' : data.summary.onlineCounts[item.id].accounts}<small>人上线</small></strong>
      <em>登录账户 · 去重人数</em><span>游客浏览器 {loading || !data ? '—' : data.summary.onlineCounts[item.id].guests} 个</span>
    </button>)}</div>
    <div className="fs-section-heading fs-arena-heading"><div><h2>Cloud 上线统计</h2><p>查看云机器人近期访问、上线账户及最近活动。</p></div><div className="fs-inline">
      <a href="https://cloud.omindos.cn/" target="_blank" rel="noreferrer">打开 Cloud<ExternalLink size={14} /></a>
      <button type="button" onClick={onAwards}><Trophy size={15} />获奖登记</button><button type="button" disabled={loading} onClick={() => setRevision(n => n + 1)}><RefreshCw size={15} />刷新</button>
    </div></div>
    <form className="fs-filters" onSubmit={event => { event.preventDefault(); setQ(search.trim()); setPage(1); }}>
      <label className="fs-search"><Search size={16} /><input aria-label="搜索 Cloud 账户" value={search} onChange={event => setSearch(event.target.value)} placeholder="搜索 Cloud 账户或游客编号" maxLength={100} /></label>
      <select aria-label="访问身份" value={kind} onChange={event => { setKind(event.target.value); setPage(1); }}><option value="all">全部身份</option><option value="account">登录账户</option><option value="guest">游客浏览器</option></select>
      <select aria-label="Cloud 排序方式" value={sort} onChange={event => { setSort(event.target.value); setPage(1); }}><option value="recent">最近活动优先</option><option value="visits">访问次数最多优先</option></select><button type="submit">查询</button>
    </form>
    {error && <div className="fs-error" role="alert">{error}<button type="button" onClick={() => setRevision(n => n + 1)}>重新读取</button></div>}
    {loading ? <div className="fs-empty" role="status"><RefreshCw size={22} />正在读取 Cloud 上线统计…</div> : data && <>
      <p className="fs-activity-caption">统计始于 {date(data.trackingStartedAt)}（北京时间）<span>更新于 {date(data.asOf)}</span></p>
      <p className="fs-footnote">上线人数按 Cloud 登录账户去重；游客按浏览器标识单列，登录前后可能分别计入，两项不相加。连续 30 分钟无活动后再次访问计为新的一次。统计开始前暂无历史记录。</p>
      {data.records.length === 0 ? <div className="fs-empty"><UsersRound size={25} />所选时段暂无符合条件的 Cloud 上线记录。</div> : <div className="fs-arena-players">{data.records.map((row, index) => <article className="fs-arena-player" key={row.id}>
        <div className="fs-cloud-row"><div className="fs-person"><b className="fs-rank">{(page - 1) * 20 + index + 1}</b><span>{row.kind === 'guest' ? '客' : row.displayName.slice(0, 1)}</span><div><h3>{row.displayName}</h3><p>{row.kind === 'account' ? 'Cloud 登录账户' : '匿名游客浏览器'}</p></div></div>
          <div className="fs-arena-score"><label>最近上线</label><strong>{date(row.lastSeen)}</strong></div>
          <div className="fs-arena-count"><strong>{row.visits}<small>次访问</small></strong><span>所选时段内活跃的访问会话</span></div>
        </div>
      </article>)}</div>}
      <div className="fs-pages"><span>共 {data.pagination.total} 个账户／游客标识 · 第 {page} 页</span><button type="button" disabled={page <= 1} onClick={() => setPage(n => n - 1)}><ChevronLeft size={14} />上一页</button><button type="button" disabled={page >= data.pagination.totalPages} onClick={() => setPage(n => n + 1)}>下一页<ChevronRight size={14} /></button></div>
    </>}
  </div>;
}
