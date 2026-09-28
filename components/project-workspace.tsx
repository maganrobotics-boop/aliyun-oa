'use client';

/* The API remains the authority for work-item state and permissions. */
/* eslint-disable react-hooks/set-state-in-effect */
import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, CalendarDays, CheckCircle2, CircleDot, ClipboardCheck, ExternalLink, FileCheck2, Flag, History, ListTodo, Plus, RefreshCw, Target } from 'lucide-react';
import { toast } from 'sonner';
import { OA_PROJECT, type WorkItem } from '@/lib/project-work-items';
import { ProjectMilestoneCard } from './project-milestone-card';
import './project-workspace.css';
import './project-workspace-v2.css';

type ApprovalSummary = { id: string; title: string; type: string; status: string; step: string; updatedAt: string; project?: string; currentReviewerEmail?: string };
type KnowledgeReviewSummary = { id: string; title: string; category: string; submitterName?: string; submitterEmail?: string };
type PersonOption = { email: string; name: string };
type Props = { mode: 'todos' | 'project'; approvals: ApprovalSummary[]; approvalsReady?: boolean; currentUserEmail?: string; people?: PersonOption[]; canReviewKnowledge?: boolean; canManageProject?: boolean; onOpenApproval: (id: string) => void; onOpenKnowledgeReview: () => void; onOpenLibrary?: () => void };
const kindLabel: Record<WorkItem['kind'], string> = { task: '任务', meeting_action: '会议行动项', risk: '风险', milestone: '里程碑' };
const statusLabel: Record<WorkItem['status'], string> = { open: '待处理', in_progress: '进行中', done: '已完成', cancelled: '已取消' };
const localDate = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
const isOpen = (item: WorkItem) => item.status !== 'done' && item.status !== 'cancelled';
const byDue = (left: WorkItem, right: WorkItem) => (left.dueAt || '9999-12-31').localeCompare(right.dueAt || '9999-12-31') || left.title.localeCompare(right.title, 'zh-CN');
async function readJson<T>(response: Response): Promise<T> { try { return await response.json() as T; } catch { throw new Error('服务器未返回有效数据，请稍后重试。'); } }

export function ProjectWorkspace({ mode, approvals, approvalsReady = true, currentUserEmail = '', people = [], canReviewKnowledge = false, canManageProject = false, onOpenApproval, onOpenKnowledgeReview, onOpenLibrary }: Props) {
  const [items, setItems] = useState<WorkItem[]>([]);
  const [knowledgeReviews, setKnowledgeReviews] = useState<KnowledgeReviewSummary[]>([]);
  const [directory, setDirectory] = useState<PersonOption[]>(people);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [auxiliaryError, setAuxiliaryError] = useState('');
  const [creating, setCreating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [updatingId, setUpdatingId] = useState('');
  const [title, setTitle] = useState('');
  const [detail, setDetail] = useState('');
  const [deliverables, setDeliverables] = useState('');
  const [acceptanceCriteria, setAcceptanceCriteria] = useState('');
  const [kind, setKind] = useState<'task' | 'risk' | 'milestone'>('task');
  const [priority, setPriority] = useState<'low' | 'normal' | 'high'>('normal');
  const [dueAt, setDueAt] = useState('');
  const [assigneeEmail, setAssigneeEmail] = useState(currentUserEmail);
  const [backfilling, setBackfilling] = useState(false);
  const [backfillStatus, setBackfillStatus] = useState('');
  const [taskFilter, setTaskFilter] = useState<'open' | 'mine' | 'all'>('open');
  const currentEmail = currentUserEmail.trim().toLowerCase();

  const load = useCallback(async () => {
    setLoading(true);
    const get = (path: string) => fetch(path, { credentials: 'same-origin', cache: 'no-store', headers: { accept: 'application/json' } });
    const [workResult, peopleResult, reviewResult] = await Promise.allSettled([
      get('/api/work-items'), get('/api/people'), canReviewKnowledge ? get('/api/knowledge?scope=review') : Promise.resolve(null),
    ]);
    try {
      if (workResult.status === 'rejected') throw new Error('工作项读取失败，请检查连接后重试。');
      const data = await readJson<{ items?: WorkItem[]; error?: string }>(workResult.value);
      if (!workResult.value.ok || !Array.isArray(data.items)) throw new Error(data.error || '工作项读取失败');
      setItems(data.items); setError('');
    } catch (cause) { setError(cause instanceof Error ? cause.message : '读取失败'); }
    const warnings: string[] = [];
    try {
      if (peopleResult.status === 'rejected') throw new Error();
      const data = await readJson<{ people?: Array<{ email: string; fullName: string }> }>(peopleResult.value);
      if (!peopleResult.value.ok || !Array.isArray(data.people)) throw new Error();
      setDirectory(data.people.map(person => ({ email: person.email, name: person.fullName })));
    } catch { warnings.push('成员目录暂不可用，负责人列表保留上次结果。'); }
    if (canReviewKnowledge) {
      try {
        if (reviewResult.status === 'rejected' || !reviewResult.value) throw new Error();
        const data = await readJson<{ items?: KnowledgeReviewSummary[] }>(reviewResult.value);
        if (!reviewResult.value.ok || !Array.isArray(data.items)) throw new Error();
        setKnowledgeReviews(data.items);
      } catch { warnings.push('资料待审列表暂不可用。'); }
    }
    setAuxiliaryError(warnings.join(' ')); setLoading(false);
  }, [canReviewKnowledge]);
  useEffect(() => { void load(); }, [load]);

  const pendingApprovals = useMemo(() => approvals.filter(item => ['待审核', '审批中'].includes(item.status) && item.currentReviewerEmail?.toLowerCase() === currentEmail), [approvals, currentEmail]);
  const mine = items.filter(item => item.assigneeEmail.toLowerCase() === currentEmail && isOpen(item));
  const tasks = items.filter(item => item.kind === 'task' || item.kind === 'meeting_action');
  const countableTasks = tasks.filter(item => item.status !== 'cancelled');
  const openItems = items.filter(isOpen);
  const risks = openItems.filter(item => item.kind === 'risk');
  const milestones = items.filter(item => item.kind === 'milestone').sort((a, b) => Number(!isOpen(a)) - Number(!isOpen(b)) || byDue(a, b));
  const overdue = openItems.filter(item => item.dueAt && item.dueAt < localDate()).sort(byDue);
  const nextMilestone = milestones.find(item => item.status !== 'cancelled' && !item.milestone?.acceptedAt);
  const visibleTasks = tasks.filter(item => taskFilter === 'all' || (taskFilter === 'mine' ? item.assigneeEmail.toLowerCase() === currentEmail && isOpen(item) : isOpen(item)));
  const evidence = approvals.filter(item => item.type === '技术审核').sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  const known = !loading && !error;
  const canUpdate = (item: WorkItem) => canManageProject || item.createdByEmail.toLowerCase() === currentEmail || item.assigneeEmail.toLowerCase() === currentEmail;

  const update = async (item: WorkItem, status: WorkItem['status'], milestone?: { deliverables: string; acceptanceCriteria: string; evidence: string; acceptanceNote: string }, dueAt?: string | null): Promise<boolean> => {
    if (updatingId || !canUpdate(item)) return false;
    setUpdatingId(item.id);
    try {
      const response = await fetch('/api/work-items', { method: 'PATCH', credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id: item.id, status, expectedUpdatedAt: item.updatedAt, ...(milestone ? { milestone } : {}), ...(dueAt !== undefined ? { dueAt } : {}) }) });
      const data = await readJson<{ item?: WorkItem; error?: string }>(response);
      if (!response.ok || !data.item) throw new Error(data.error || '状态未保存');
      setItems(current => current.map(value => value.id === item.id ? data.item! : value));
      toast.success('工作项状态已保存'); return true;
    } catch (cause) { toast.error(cause instanceof Error ? cause.message : '状态未保存'); return false; }
    finally { setUpdatingId(''); }
  };
  const create = async (event: FormEvent) => {
    event.preventDefault(); if (saving) return; setSaving(true);
    try {
      const person = directory.find(value => value.email === assigneeEmail);
      const response = await fetch('/api/work-items', { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: 'create', title, detail, kind, priority, dueAt: dueAt || null, assigneeEmail, assigneeName: person?.name || '', ...(kind === 'milestone' ? { milestone: { deliverables, acceptanceCriteria } } : {}) }) });
      const data = await readJson<{ item?: WorkItem; error?: string }>(response);
      if (!response.ok || !data.item) throw new Error(data.error || '工作项未创建');
      setItems(current => [data.item!, ...current]); setTitle(''); setDetail(''); setDeliverables(''); setAcceptanceCriteria(''); setDueAt(''); setCreating(false); toast.success('工作项已保存');
    } catch (cause) { toast.error(cause instanceof Error ? cause.message : '工作项未创建'); }
    finally { setSaving(false); }
  };
  const backfillMeetings = async () => {
    setBackfilling(true); setBackfillStatus('正在读取历史会议并提取行动项…');
    try {
      const response = await fetch('/api/work-items', { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: 'backfill_meetings' }) });
      const data = await readJson<{ meetings?: number; discovered?: number; error?: string }>(response);
      if (!response.ok) throw new Error(data.error || '历史会议导入失败');
      await load();
      const message = `已检查 ${data.meetings ?? 0} 场历史会议，发现 ${data.discovered ?? 0} 条行动项；重复来源不会重复创建。`;
      setBackfillStatus(message); toast.success(message);
    } catch (cause) { const message = cause instanceof Error ? cause.message : '历史会议导入失败'; setBackfillStatus(message); toast.error(message); }
    finally { setBackfilling(false); }
  };
  const openCreate = (nextKind: typeof kind = 'task') => { setKind(nextKind); setCreating(true); };
  const workRow = (item: WorkItem) => <article className={`project-task ${item.priority === 'high' ? 'urgent' : ''}`} key={item.id}>
    <span className="project-task-check" aria-hidden="true">{item.status === 'done' ? <CheckCircle2 /> : <CircleDot />}</span>
    <div><div className="project-task-title"><strong>{item.title}</strong><span>{kindLabel[item.kind]}</span>{item.priority === 'high' && <span>高优先级</span>}</div><p>{item.assigneeName || item.assigneeEmail || '待指定负责人'}{item.dueAt ? ` · 计划 ${item.dueAt}` : ' · 尚未设置日期'}</p>{item.detail && <p className="project-task-detail">{item.detail}</p>}{item.sourceType !== 'manual' && <p>来源：{item.sourceType === 'meeting' ? '会议纪要' : '审批记录'}{item.sourceId && item.sourceType === 'approval' && <button type="button" className="project-source-link" onClick={() => onOpenApproval(item.sourceId)}>查看来源 <ExternalLink /></button>}</p>}{item.completedAt && <p>完成记录：{new Date(item.completedAt).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })}</p>}</div>
    {canUpdate(item) && item.kind !== 'milestone' ? <select value={item.status} disabled={Boolean(updatingId)} onChange={event => void update(item, event.target.value as WorkItem['status'])} aria-label={`${item.title}的状态`}>{Object.entries(statusLabel).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select> : <span className={`project-status status-${item.status}`}>{statusLabel[item.status]}</span>}
  </article>;
  const noData = (message: string) => <p className="project-empty">{loading ? '正在读取工作项…' : error ? '数据暂不可用，请刷新重试。' : message}</p>;

  if (mode === 'todos') return <div className="project-page">
    <header className="project-page-head"><div><span>统一待办</span><h1>今天需要处理的事</h1><p>审批、项目任务与会议行动项集中在这里。</p></div><button type="button" onClick={() => void load()} disabled={loading}><RefreshCw />刷新</button></header>
    {error && <p className="project-error" role="alert">{error}</p>}{auxiliaryError && <p className="project-inline-status" role="status">{auxiliaryError}</p>}
    <section className="project-panel"><h2><ClipboardCheck />待我审批</h2>{!approvalsReady ? <p className="project-empty">正在读取审批…</p> : pendingApprovals.length ? pendingApprovals.map(item => <button type="button" className="approval-todo" key={item.id} onClick={() => onOpenApproval(item.id)}><div><strong>{item.title}</strong><span>{item.type} · {item.step}</span></div><b>处理</b></button>) : <p className="project-empty">目前没有待你审批的申请。</p>}</section>
    {canReviewKnowledge && <section className="project-panel"><h2><ClipboardCheck />资料待审</h2>{loading || auxiliaryError.includes('资料待审') ? <p className="project-empty">{loading ? '正在读取资料…' : '待审状态暂不可用，请刷新重试。'}</p> : knowledgeReviews.length ? knowledgeReviews.map(item => <button type="button" className="approval-todo" key={item.id} onClick={onOpenKnowledgeReview}><div><strong>{item.title}</strong><span>{item.category} · {item.submitterName || item.submitterEmail || '项目成员'}</span></div><b>审核</b></button>) : <p className="project-empty">目前没有待审核的资料。</p>}</section>}
    <section className="project-panel"><h2><ListTodo />我的任务与行动项</h2>{known && mine.length ? mine.map(workRow) : noData('目前没有分配给你的未完成工作项。')}</section>
  </div>;

  return <div className="project-page">
    <header className="project-page-head"><div><span>工作台 · 项目进展</span><h1>{OA_PROJECT}</h1><p>围绕里程碑推进，任务、风险和成果记录可回看。</p></div><div className="project-head-actions"><button type="button" onClick={() => void load()} disabled={loading}><RefreshCw />刷新</button><button type="button" className="project-primary" onClick={() => setCreating(value => !value)} aria-expanded={creating}><Plus />新建工作项</button></div></header>
    {creating && <form className="project-create" onSubmit={create}><label className="project-create-title">标题<input required maxLength={240} value={title} onChange={event => setTitle(event.target.value)} placeholder="明确要交付或处理的事项" /></label><label>类型<select value={kind} onChange={event => setKind(event.target.value as typeof kind)}><option value="task">任务</option><option value="milestone">里程碑</option><option value="risk">风险</option></select></label><label>优先级<select value={priority} onChange={event => setPriority(event.target.value as typeof priority)}><option value="normal">普通</option><option value="high">高优先级</option><option value="low">低优先级</option></select></label><label>负责人<select value={assigneeEmail} onChange={event => setAssigneeEmail(event.target.value)}><option value="">待指定负责人</option>{directory.map(person => <option key={person.email} value={person.email}>{person.name || person.email}</option>)}</select></label><label>计划日期<input type="date" value={dueAt} onChange={event => setDueAt(event.target.value)} /></label><label className="project-create-detail">说明与证据出处<textarea maxLength={2000} rows={3} value={detail} onChange={event => setDetail(event.target.value)} placeholder="写清目标、交付物和验收依据；未有证据时请如实注明。" /></label><>{kind === 'milestone' && <><label className="project-create-detail">交付内容<textarea maxLength={2000} rows={2} value={deliverables} onChange={event => setDeliverables(event.target.value)} /></label><label className="project-create-detail">验收标准<textarea maxLength={2000} rows={2} value={acceptanceCriteria} onChange={event => setAcceptanceCriteria(event.target.value)} /></label></>}</><div className="project-create-actions"><button type="button" onClick={() => setCreating(false)} disabled={saving}>收起</button><button type="submit" disabled={saving}>{saving ? '保存中…' : '保存工作项'}</button></div></form>}
    {error && <p className="project-error" role="alert">{error}</p>}{auxiliaryError && <p className="project-inline-status" role="status">{auxiliaryError}</p>}
    <section className="project-overview" aria-label="项目总览"><div><span className="project-overview-label">下一里程碑</span><h2>{loading ? '读取中…' : error ? '暂不可用' : nextMilestone?.title || '暂无待验收里程碑'}</h2>{known && nextMilestone && <p>{nextMilestone.dueAt || '日期待定'} · {nextMilestone.assigneeName || nextMilestone.assigneeEmail || '负责人待定'} · {statusLabel[nextMilestone.status]}</p>}{known && !nextMilestone && <button type="button" className="project-source-link" onClick={() => openCreate('milestone')}>添加里程碑 <Plus /></button>}</div><p>任务完成与里程碑验收分别记录；验收需有交付内容、标准、证据和负责人意见。</p></section>
    <section className="project-metrics" aria-label="工作项统计"><div><Target /><span>任务完成</span><strong>{known ? `${countableTasks.filter(item => item.status === 'done').length}/${countableTasks.length}` : '—'}</strong></div><div><Flag /><span>待验收里程碑</span><strong>{known ? milestones.filter(item => item.status !== 'cancelled' && !item.milestone?.acceptedAt).length : '—'}</strong></div><div><AlertTriangle /><span>已登记风险</span><strong>{known ? risks.length : '—'}</strong></div><div><CalendarDays /><span>已过计划日期</span><strong>{known ? overdue.length : '—'}</strong></div></section>
    <p className="project-count-note">统计当前已加载的任务与会议行动项，排除已取消项；不表示项目完成率。</p>
    <div className="project-columns"><div><section className="project-panel"><div className="project-panel-head"><h2><Flag />里程碑</h2><button type="button" className="project-source-link" onClick={() => openCreate('milestone')}><Plus />添加</button></div>{known && milestones.length ? milestones.map(item => <ProjectMilestoneCard key={item.id} item={item} canEdit={canUpdate(item)} canAccept={canManageProject} busy={Boolean(updatingId)} onSave={(status, milestone, dueAt) => update(item, status, milestone, dueAt)} />) : noData('尚未设置里程碑。请添加交付要求、负责人和计划日期。')}</section>
    <section className="project-panel"><div className="project-panel-head"><h2><ListTodo />任务与行动项</h2><select value={taskFilter} onChange={event => setTaskFilter(event.target.value as typeof taskFilter)} aria-label="筛选任务"><option value="open">未完成</option><option value="mine">分配给我</option><option value="all">全部状态</option></select></div>{known && visibleTasks.length ? visibleTasks.map(workRow) : noData('当前筛选下没有任务。')}</section>
    <section className="project-panel"><div className="project-panel-head"><h2><FileCheck2 />成果与证据</h2>{onOpenLibrary && <button type="button" className="project-source-link" onClick={onOpenLibrary}>查看资料库 <ExternalLink /></button>}</div><p className="project-section-note">以下为可访问的技术成果审批。请打开记录核对附件、版本与审核结论。</p>{!approvalsReady ? <p className="project-empty">正在读取成果记录…</p> : evidence.length ? evidence.slice(0, 8).map(item => <button type="button" className="project-activity" key={item.id} onClick={() => onOpenApproval(item.id)}><strong>{item.title}</strong><span>{item.project ? `${item.project} · ` : ''}{item.status} · {item.updatedAt}</span></button>) : <p className="project-empty">尚无可访问的技术成果审批记录。</p>}</section></div>
    <aside><section className="project-panel project-risk"><h2><AlertTriangle />已登记风险</h2>{known && risks.length ? risks.map(workRow) : noData('当前没有未关闭的风险记录。')}</section><section className="project-panel"><h2><CalendarDays />已过计划日期</h2>{known && overdue.length ? overdue.map(workRow) : noData('当前没有已过计划日期的未完成工作项。')}</section>{canManageProject && <section className="project-panel"><h2><History />会议行动项</h2><p className="project-section-note">从已有会议纪要提取行动项，导入后补充负责人和计划日期。</p><button type="button" className="project-source-link" disabled={backfilling} onClick={() => void backfillMeetings()}>{backfilling ? '正在读取…' : '从历史会议导入'}</button>{backfillStatus && <p className="project-inline-status" role="status">{backfillStatus}</p>}</section>}</aside></div>
  </div>;
}
