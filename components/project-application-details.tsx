'use client';
import { useEffect, useRef, useState } from 'react';
import { industrialProjects } from '../lib/project-catalogue.mjs';

type Chapter = { id: string; title: string; index: number; submissions: number; reviewed: number };
type Learning = { capturedAt: string; totalChapters: number; submittedChapters: number; submissionCount: number; reviewedCount: number; currentChapter: { index: number; title: string } | null; chapters: Chapter[]; graduation: { status: string; attempts: number; checks?: { id: string; title: string; passed: boolean }[] }; reviews: { id: string; chapter: string; review: string }[]; gradeNote: string; catalogue: { id: string; title: string; parentId?: string; openWithoutApplication?: boolean }[] };
type Application = { version: number; kind?: string; labProjectId?: string; selection?: { courseId: string; semesterId: string; semesterLabel: string; studentNumber?: string }; learning: Learning; files: { id: string; name: string; size: number }[]; identityNote: string };
type Reply = { id: string; reply: string; courseIds: string[]; state: string; createdAt: number };
export function ProjectApplicationDetails({ id, payload, status, currentEmail, onChanged }: { id: string; payload?: Record<string, unknown>; status?: string; currentEmail?: string; onChanged?: () => void }) {
  const application = payload?.projectApplication as Application | undefined;
  const [reply, setReply] = useState(''), [selected, setSelected] = useState<string[]>([]), [busy, setBusy] = useState(false), [message, setMessage] = useState(''), [replies, setReplies] = useState<Reply[]>([]);
  const pending = useRef<{ reply: string; courseIds: string[]; idempotencyKey: string } | null>(null);
  const approvers = payload?.circulationApprovers as { email: string }[] | undefined;
  const canReply = Boolean(application?.version === 1 && approvers?.some(person => person.email === currentEmail?.toLowerCase()));
  useEffect(() => { let cancelled = false; setReply(''); setSelected([]); setMessage(''); setReplies([]); pending.current = null; if (canReply) fetch(`/api/project-applications/${id}/reply`, { cache: 'no-store', credentials: 'same-origin' }).then(r => r.json()).then(value => { const data = value as { replies?: Reply[] }; if (!cancelled && Array.isArray(data.replies)) setReplies(data.replies); }).catch(() => {}); return () => { cancelled = true; }; }, [id, canReply]);
  if (application?.version !== 1 || !application.learning) return null;
  const learning = application.learning, isSelection = application.kind === 'course_project_selection', industrialProject = industrialProjects.find(p => p.id === application.labProjectId);
  const send = async (retry?: Reply) => {
    if (busy) return;
    const body = retry ? { reply: retry.reply, courseIds: retry.courseIds, idempotencyKey: retry.id } : pending.current || { reply: reply.trim(), courseIds: selected, idempotencyKey: crypto.randomUUID() };
    if (body.reply.length < 2) { setMessage('请填写回复内容。'); return; }
    if (!retry) pending.current = body;
    setBusy(true); setMessage('正在审批并同步回复与课程权限…');
    try {
      const response = await fetch(`/api/project-applications/${id}/reply`, { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
      const data = await response.json() as { error?: string; message?: string; delivered?: boolean }; if (!response.ok) throw new Error(data.error || '回复未完成。');
      setMessage(data.message || '回复已完成。');
      if (data.delivered) { pending.current = null; setReply(''); setSelected([]); }
      const history = await fetch(`/api/project-applications/${id}/reply`, { cache: 'no-store', credentials: 'same-origin' }).then(r => r.json()) as { replies?: Reply[] }; if (Array.isArray(history.replies)) setReplies(history.replies);
      onChanged?.();
    } catch(error) { setMessage(error instanceof Error ? error.message : '回复未完成，请重试。'); }
    finally { setBusy(false); }
  };
  return <section className="detail-section project-application-details" aria-label="项目报名材料与平台成绩">
    {isSelection && application.selection && <div className="project-selection-receipt"><h3>本学期课程选题</h3><p>{application.selection.semesterLabel} · {learning.catalogue.find(c => c.id === application.selection?.courseId)?.title || application.selection.courseId}</p><p>学号：{application.selection.studentNumber || '尚未提供'}。</p><p>学生每学期只可选一个课程项目。该项目章节已在选定时开放，此待办用于确认选题、安排项目工作与回复学生。</p></div>}
    {industrialProject && <div><h3>实验室项目意向</h3><p>{industrialProject.title} · {industrialProject.stage}</p><a href={industrialProject.url} target="_blank" rel="noopener noreferrer">查看官网项目介绍</a></div>}
    <h3>平台学习进度与成绩</h3>
    <p>{learning.currentChapter ? `最近学习第 ${learning.currentChapter.index} 章：${learning.currentChapter.title}` : '暂无章节学习记录'}。已提交 {learning.submittedChapters}/{learning.totalChapters} 章，{learning.submissionCount} 份作业，{learning.reviewedCount} 份已有助教点评。</p>
    <p>新手村最后一关：{({ passed: '已通过', needs_retry: '尚未通过', not_attempted: '尚未参加' } as Record<string, string>)[learning.graduation.status] || '暂无记录'}；尝试 {learning.graduation.attempts} 次。{learning.graduation.checks?.length ? `已通过 ${learning.graduation.checks.filter(c => c.passed).length}/${learning.graduation.checks.length} 项核验。` : ''}</p>
    <p>{learning.gradeNote} 记录于 {new Date(learning.capturedAt).toLocaleString('zh-CN')}。</p>
    {learning.chapters.length > 0 && <div className="project-application-table"><table><thead><tr><th>章节</th><th>作业提交</th><th>助教点评</th></tr></thead><tbody>{learning.chapters.map(chapter => <tr key={chapter.id}><td>第 {chapter.index} 章 · {chapter.title}</td><td>{chapter.submissions} 份</td><td>{chapter.reviewed} 份</td></tr>)}</tbody></table></div>}
    {learning.reviews.length > 0 && <details><summary>最近的助教点评（AI 反馈）</summary>{learning.reviews.map(review => <article key={review.id}><h4>{review.chapter}</h4><p className="circulation-content">{review.review}</p></article>)}</details>}
    {application.files.length > 0 && <div><h4>成绩单与项目材料</h4><ul>{application.files.map(file => <li key={file.id}><a href={`/api/project-applications/${encodeURIComponent(id)}/files/${file.id}`} target="_blank" rel="noopener noreferrer">{file.name}</a> · {Math.ceil(file.size / 1024)} KB</li>)}</ul></div>}
    <p>{application.identityNote}</p>
    {canReply && <div className="project-application-reply"><h3>回复学生并开通课程</h3><p>课程项目在选定后立即开放，无需等待审批。您可以按参与项目的需要另行开通课程。</p>{['待审核', '已归档'].includes(status || '') && <form onSubmit={event => { event.preventDefault(); void send(); }}><label>回复学生<textarea required minLength={2} maxLength={1000} rows={4} value={reply} disabled={busy} onChange={event => { setReply(event.target.value); pending.current = null; }} placeholder="填写项目安排及需要学习的课程" /></label><fieldset disabled={busy}><legend>选择开通的课程（可不选）</legend>{learning.catalogue?.filter(c => !c.openWithoutApplication && c.id !== 'graduation').map(course => <label key={course.id}><input type="checkbox" checked={selected.includes(course.id)} onChange={event => { setSelected(event.target.checked ? [...selected, course.id] : selected.filter(id => id !== course.id)); pending.current = null; }} />{course.title}</label>)}</fieldset><button type="submit" disabled={busy}>{status === '待审核' ? isSelection ? '确认选题、回复并开通所选课程' : '批准、回复并开通所选课程' : '回复并开通所选课程'}</button></form>}<p role="status" aria-live="polite">{message}</p>{replies.map(record => <article key={record.id}><p>{record.reply}</p><p>{record.courseIds.map(id => learning.catalogue?.find(c => c.id === id)?.title || id).join('、') || '未额外开通课程'} · {record.state === 'delivered' ? '已同步给学生' : '待同步'}</p>{record.state !== 'delivered' && <button disabled={busy} onClick={() => void send(record)}>重试同步此回复</button>}</article>)}</div>}
  </section>;
}
