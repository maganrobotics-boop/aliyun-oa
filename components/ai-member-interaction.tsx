'use client';

/* eslint-disable react-hooks/set-state-in-effect */
import { FormEvent, useCallback, useEffect, useId, useRef, useState } from 'react';
import { RefreshCw, Send, Square } from 'lucide-react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { OaRichAnswer } from './knowledge/oa-rich-answer';
import { aiMemberMessages as validMessages, readAiMemberEvents, type AiMemberChatMessage } from '@/lib/ai-member-stream-client.mjs';
import type { AiMemberSummary } from './ai-member-directory';

type ChatMessage = AiMemberChatMessage;
type AuditEvent = { seq: number; audience: string; event: string; targetId?: string; details?: unknown; createdAt: string | number };
type InteractionProps = { member: AiMemberSummary | null; mode: 'chat' | 'audit'; onClose: () => void };
const time = (value: string | number) => { const date = new Date(value); return Number.isFinite(date.getTime()) ? date.toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' }) : value; };
const eventLabels: Record<string, string> = { registered: '账号注册', profile_updated: '更新资料', artifact_created: '保存成果', question_asked: '提交问题', question_answered: '回答问题', course_submitted: '提交课程证据', disabled: '账号停用' };
const messageState: Record<string, string> = { running: '回答进行中', unknown: '回答未确认，请刷新核对', failed: '回答未完成', cancelled: '已停止' };
const mergeMessages = (left: ChatMessage[], right: ChatMessage[]) => [...new Map([...left, ...right].map(item => [item.id, item])).values()];

function RichAnswer({ answer }: { answer: string }) {
  return <div className="oa-ai-rich-answer"><OaRichAnswer answer={answer} /></div>;
}

/** A keyed child owns each member/mode lifecycle. Late events cannot target another member. */
export function AiMemberInteraction({ member, mode, onClose }: InteractionProps) {
  return <Dialog open={Boolean(member)} onOpenChange={open => { if (!open) onClose(); }}>
    {member && <InteractionContent key={`${member.id}:${mode}`} member={member} mode={mode} />}
  </Dialog>;
}

function InteractionContent({ member, mode }: { member: AiMemberSummary; mode: 'chat' | 'audit' }) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [events, setEvents] = useState<AuditEvent[]>([]);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [status, setStatus] = useState('');
  const [loading, setLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const [body, setBody] = useState('');
  const [partial, setPartial] = useState('');
  const [unconfirmed, setUnconfirmed] = useState(false);
  const [nextAfter, setNextAfter] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const requestSequence = useRef(0);
  const alive = useRef(false);
  const pending = useRef<{ message: string; key: string } | null>(null);
  const controllers = useRef(new Set<AbortController>());
  const sendController = useRef<AbortController | null>(null);
  const messageEnd = useRef<HTMLDivElement>(null);
  const scrollHost = useRef<HTMLDivElement>(null);
  const stickToEnd = useRef(true);
  const inputId = useId();
  const endpoint = `/api/ai-members/conversations/${encodeURIComponent(member.id)}/messages`;
  useEffect(() => {
    alive.current = true;
    const activeControllers = controllers.current;
    return () => { alive.current = false; requestSequence.current += 1; for (const controller of activeControllers) controller.abort(); activeControllers.clear(); };
  }, []);
  const load = useCallback(async (after = 0, preserveError = false) => {
    const sequence = ++requestSequence.current;
    const controller = new AbortController(); controllers.current.add(controller);
    setLoading(true); if (!preserveError) setError('');
    try {
      const path = mode === 'chat' ? endpoint : `/api/ai-members/admin/members/${encodeURIComponent(member.id)}/audit?after=${after}`;
      const response = await fetch(path, { credentials: 'same-origin', cache: 'no-store', headers: { accept: 'application/json' }, signal: controller.signal });
      const data = await response.json() as { messages?: ChatMessage[]; events?: AuditEvent[]; notice?: string; hasMore?: boolean; nextAfter?: number; error?: string };
      if (!response.ok) throw new Error(data.error || '记录暂不可用，请重试。');
      if (!alive.current || sequence !== requestSequence.current) return;
      if (mode === 'chat') { setMessages(validMessages(data.messages)); setNotice(data.notice || '回答不代表已执行任务或批准申请。'); }
      else { setEvents(previous => after ? [...new Map([...previous, ...(data.events || [])].map(event => [event.seq, event])).values()] : data.events || []); setHasMore(Boolean(data.hasMore)); setNextAfter(data.nextAfter || 0); }
    } catch (cause) { if (alive.current && sequence === requestSequence.current && !controller.signal.aborted) setError(cause instanceof Error ? cause.message : '记录读取失败。'); }
    finally { controllers.current.delete(controller); if (alive.current && sequence === requestSequence.current) setLoading(false); }
  }, [endpoint, member.id, mode]);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => { if (stickToEnd.current) messageEnd.current?.scrollIntoView({ block: 'nearest' }); }, [messages, partial, status]);

  const send = async (event: FormEvent) => {
    event.preventDefault(); const message = body.trim();
    if (!message || sendController.current || loading) return;
    // Keep the same key after an unknown result. Never automatically replay a POST.
    if (pending.current?.message !== message) pending.current = { message, key: crypto.randomUUID() };
    const request = pending.current;
    const controller = new AbortController(); controllers.current.add(controller); sendController.current = controller;
    const isCurrent = () => alive.current && sendController.current === controller;
    setSending(true); setError(''); setStatus('正在连接…'); setPartial(''); setUnconfirmed(false); stickToEnd.current = true;
    let completed = false;
    let terminalError = '';
    try {
      const response = await fetch(endpoint, { method: 'POST', credentials: 'same-origin', cache: 'no-store', headers: { 'content-type': 'application/json', accept: 'text/event-stream' }, body: JSON.stringify({ message: request.message, idempotencyKey: request.key }), signal: controller.signal });
      if (!response.ok) { const data = await response.json().catch(() => ({})) as { error?: string }; throw new Error(data.error || '请求未完成，请刷新记录核对。'); }
      await readAiMemberEvents(response, (kind, data) => {
        if (!isCurrent() || controller.signal.aborted || completed || terminalError) return;
        if (kind === 'meta') { setMessages(current => mergeMessages(current, validMessages(data.messages))); setStatus('正在生成回答…'); }
        else if (kind === 'status') { if (typeof data.message === 'string') setStatus(data.message); }
        else if (kind === 'delta') { if (typeof data.text === 'string') { setPartial(current => current + data.text); setStatus('正在回答…'); } }
        else if (kind === 'reset') { setPartial(''); setStatus(typeof data.message === 'string' ? data.message : '正在重新生成回答…'); }
        else if (kind === 'done') {
          const finalMessages = validMessages(data.messages);
          if (data.state !== 'succeeded' || !finalMessages.some(item => item.role === 'assistant' && item.content.trim())) throw new Error('回答尚未确认保存，请刷新记录核对。');
          completed = true; setMessages(current => mergeMessages(current, finalMessages)); setPartial(''); setBody(''); pending.current = null; setStatus('回答已保存');
        } else if (kind === 'error') { terminalError = typeof data.error === 'string' ? data.error : '回答未完成，请刷新记录核对。'; setMessages(current => mergeMessages(current, validMessages(data.messages))); }
      }, controller.signal);
      if (!completed) throw new Error(terminalError || '连接已结束，但未确认完整回答。请刷新记录核对。');
    } catch (cause) {
      if (!isCurrent()) return;
      if (completed) { setStatus('回答已保存'); return; }
      const reason = controller.signal.aborted ? '已停止接收。下面的片段不作为完整回答；请刷新记录核对服务端结果。' : cause instanceof Error ? cause.message : '回答未完成，请刷新记录核对。';
      setUnconfirmed(true); setError(reason); setStatus(controller.signal.aborted ? '已停止' : '回答未确认');
      await load(0, true);
    } finally {
      controllers.current.delete(controller);
      if (isCurrent()) { sendController.current = null; setSending(false); }
    }
  };

  return <DialogContent className="oa-ai-interaction"><DialogHeader><DialogTitle>{member.displayName} · {mode === 'chat' ? '私聊' : '操作记录'}</DialogTitle><DialogDescription>{mode === 'chat' ? '与该 AI 的独立会话，回答生成后逐段显示。' : '管理员可查看该 AI 的真实操作事件；空记录表示尚无已记录动作。'}</DialogDescription></DialogHeader>
    <div className="oa-ai-interaction-toolbar"><span>{mode === 'chat' ? notice : '仅展示系统实际记录，不推断未记录的执行结果。'}</span><button type="button" disabled={loading || sending} onClick={() => void load()} aria-label="刷新记录核对结果" title="刷新记录核对结果"><RefreshCw /></button></div>
    {error && <p className="oa-ai-directory-error" role="alert">{error}</p>}
    <div className="oa-ai-interaction-content" ref={scrollHost} aria-busy={loading} onScroll={() => { const element = scrollHost.current; if (element) stickToEnd.current = element.scrollHeight - element.scrollTop - element.clientHeight < 96; }}>
      {mode === 'chat' ? <>{messages.map(message => <article className={`oa-ai-message ${message.role}`} key={message.id}><small>{message.role === 'user' ? '我' : `${member.displayName} · AI`} · {time(message.createdAt)}</small>{message.role === 'assistant' ? <RichAnswer answer={message.content} /> : <p>{message.content}</p>}{message.state && !['succeeded', 'completed'].includes(message.state) && <small>{messageState[message.state] || '状态待核对'}</small>}</article>)}{!messages.length && !sending && <p className="project-empty">{loading ? '正在读取会话…' : '还没有消息，可以从一个具体问题开始。'}</p>}{partial && <article className={`oa-ai-message assistant ${unconfirmed ? 'unconfirmed' : 'streaming'}`}><small>{member.displayName} · AI · {unconfirmed ? '未确认片段' : '正在回答'}</small><RichAnswer answer={partial} /></article>}{status && <p className="oa-ai-stream-status" role="status" aria-live="polite">{status}</p>}</> : events.length ? <ol className="oa-ai-audit-list">{events.map(event => <li key={event.seq}><header><strong>{eventLabels[event.event] || event.event}</strong><time>{time(event.createdAt)}</time></header><small>{event.audience} · 记录 {event.seq}{event.targetId ? ` · ${event.targetId}` : ''}</small>{event.details !== undefined && <details><summary>查看记录内容</summary><pre>{typeof event.details === 'string' ? event.details : JSON.stringify(event.details, null, 2)}</pre></details>}</li>)}</ol> : <p className="project-empty">{loading ? '正在读取操作记录…' : '暂无操作事件。'}</p>}
      <div ref={messageEnd} />{mode === 'audit' && hasMore && <button type="button" disabled={loading} onClick={() => void load(nextAfter)}>{loading ? '读取中…' : '加载更多记录'}</button>}
    </div>
    {mode === 'chat' && <form className="oa-ai-message-composer" onSubmit={send}><label className="sr-only" htmlFor={inputId}>发送给 {member.displayName} 的问题</label><textarea id={inputId} rows={3} maxLength={2000} value={body} disabled={sending} onChange={event => setBody(event.target.value)} placeholder={`向${member.displayName}描述问题和希望获得的帮助…`} />{sending ? <button key="stop" type="button" className="oa-ai-stop" onClick={event => { event.preventDefault(); sendController.current?.abort(); }}><Square />停止</button> : <button key="send" type="submit" disabled={loading || !body.trim()}><Send />发送</button>}</form>}
  </DialogContent>;
}
