'use client';

import { useState } from 'react';
import { CalendarDays, CheckCircle2, Flag } from 'lucide-react';
import type { WorkItem } from '@/lib/project-work-items';

type MilestoneInput = { deliverables: string; acceptanceCriteria: string; evidence: string; acceptanceNote: string };
export function ProjectMilestoneCard({ item, canEdit, canAccept, busy, onSave }: {
  item: WorkItem; canEdit: boolean; canAccept: boolean; busy: boolean;
  onSave: (status: WorkItem['status'], milestone: MilestoneInput, dueAt: string | null) => Promise<boolean>;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<MilestoneInput>({ deliverables: '', acceptanceCriteria: '', evidence: '', acceptanceNote: '' });
  const [status, setStatus] = useState<WorkItem['status']>(item.status);
  const [dueAt, setDueAt] = useState(item.dueAt || '');
  const record = item.milestone;
  const accepted = item.status === 'done' && Boolean(record?.acceptedAt);
  const mayEdit = canEdit && (item.status !== 'done' || canAccept);
  const open = () => {
    setDraft({ deliverables: record?.deliverables || '', acceptanceCriteria: record?.acceptanceCriteria || '', evidence: record?.evidence || '', acceptanceNote: record?.acceptanceNote || '' });
    setStatus(item.status); setDueAt(item.dueAt || ''); setEditing(true);
  };
  const save = async (nextStatus: WorkItem['status']) => { if (await onSave(nextStatus, draft, dueAt || null)) setEditing(false); };
  const label = accepted ? '已验收' : item.status === 'done' ? '历史完成 · 待核验' : item.status === 'cancelled' ? '已取消' : item.status === 'in_progress' ? '进行中 · 未验收' : '待处理 · 未验收';
  return <article className={`project-milestone-card ${accepted ? 'accepted' : ''}`}>
    <header><span aria-hidden="true">{accepted ? <CheckCircle2 /> : <Flag />}</span><div><h3>{item.title}</h3><p><CalendarDays aria-hidden="true" />{item.dueAt || '尚未设置计划日期'} · {item.assigneeName || item.assigneeEmail || '负责人待指定'}</p></div><strong>{label}</strong></header>
    {item.detail && <p className="project-section-note">{item.detail}</p>}
    <dl className="project-milestone-record"><div><dt>交付内容</dt><dd>{record?.deliverables || '尚未填写'}</dd></div><div><dt>验收标准</dt><dd>{record?.acceptanceCriteria || '尚未填写'}</dd></div><div><dt>成果证据</dt><dd>{record?.evidence || '尚未提交证据'}</dd></div>{record?.acceptanceNote && <div><dt>验收意见</dt><dd>{record.acceptanceNote}</dd></div>}{accepted && <div><dt>验收记录</dt><dd>{record?.acceptedByName || record?.acceptedByEmail} · {record?.acceptedAt ? new Date(record.acceptedAt).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' }) : ''}</dd></div>}</dl>
    {Boolean(record?.history?.length) && <details className="project-milestone-history"><summary>最近变更（{record?.history?.length} 条）</summary>{record?.historyTruncated && <p>这里只保留最近 20 条变更，不代表完整历史。</p>}<ol>{[...(record?.history || [])].reverse().map((revision, index) => <li key={`${revision.changedAt}-${index}`}><strong>{{ updated: '更新记录', accepted: '确认验收', reopened: '撤回验收', cancelled: '取消里程碑' }[revision.action]}</strong><span>{revision.changedByName || revision.changedByEmail} · {new Date(revision.changedAt).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })}</span><small>变更前计划日期：{revision.previousDueAt || '未设置'}</small>{revision.previous.evidence && <details><summary>变更前证据与验收意见</summary><p>{revision.previous.evidence}</p><p>{revision.previous.acceptanceNote || '未填写验收意见'}</p></details>}</li>)}</ol></details>}
    {!editing && mayEdit && <button type="button" className="project-source-link" onClick={open}>{canAccept ? '填写 / 核对验收记录' : '补充交付与证据'}</button>}
    {editing && <form className="project-milestone-form" onSubmit={event => { event.preventDefault(); void save(status); }}><label>计划日期<input type="date" value={dueAt} onChange={event => setDueAt(event.target.value)} /></label><label>交付内容<textarea maxLength={2000} rows={2} value={draft.deliverables} onChange={event => setDraft(value => ({ ...value, deliverables: event.target.value }))} /></label><label>验收标准<textarea maxLength={2000} rows={2} value={draft.acceptanceCriteria} onChange={event => setDraft(value => ({ ...value, acceptanceCriteria: event.target.value }))} /></label><label>成果证据<textarea maxLength={4000} rows={3} value={draft.evidence} onChange={event => setDraft(value => ({ ...value, evidence: event.target.value }))} placeholder="填写可核对的 OA 记录、文件版本、测试结果与日志出处。" /></label>{canAccept && <label>验收意见<textarea maxLength={2000} rows={2} value={draft.acceptanceNote} onChange={event => setDraft(value => ({ ...value, acceptanceNote: event.target.value }))} placeholder="说明核对结果和限制，验收时必填。" /></label>}<label>工作状态<select value={status} onChange={event => setStatus(event.target.value as WorkItem['status'])}><option value="open">待处理</option><option value="in_progress">进行中</option>{item.status === 'done' && <option value="done">保留完成状态并核对验收</option>}<option value="cancelled">已取消</option></select></label>{item.status === 'done' && status !== 'done' && <p className="project-section-note">保存后将撤回当前验收状态，证据与说明继续保留。</p>}<div className="project-create-actions"><button type="button" onClick={() => setEditing(false)} disabled={busy}>取消</button><button type="submit" disabled={busy || (status === 'done' && !Object.values(draft).every(value => value.trim()))}>{busy ? '保存中…' : '保存记录'}</button>{canAccept && <button type="button" disabled={busy || !Object.values(draft).every(value => value.trim())} onClick={() => void save('done')}>确认验收</button>}</div><small>确认验收需填写四项内容，仅项目负责人或管理员可执行；服务器记录验收人与时间。</small></form>}
  </article>;
}
