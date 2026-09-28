'use client';

import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { Bot, MessageCircle, RefreshCw } from 'lucide-react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useOaConversation } from '@/components/knowledge/oa-conversation-context';
import { AiMemberInteraction } from './ai-member-interaction';

export type AiRoleKey = 'research' | 'ta' | 'senior' | 'sister';
export type AiMemberSummary = {
  id: string; role: AiRoleKey; displayName: string;
  status: 'active' | 'registered' | 'paused' | 'pending';
  ownerName?: string; description?: string; scopeLabel?: string;
  canChat: boolean; currentTask?: string;
};
const profiles: Array<{ role: AiRoleKey; name: string; summary: string }> = [
  { role: 'research', name: '助研', summary: '协助整理公开资料与自身测试材料，提供预检建议。' },
  { role: 'ta', name: '助教', summary: '讲解课程、回答问题，核对代码与实验依据。' },
  { role: 'senior', name: '学长', summary: '独立完成学习任务，记录真实过程与成果。' },
  { role: 'sister', name: '学姐', summary: '独立复测学习与项目流程，反馈使用体验。' },
];
const statusLabel = { active: '已接入', registered: '已注册', paused: '已停用', pending: '待接入' };
const scopeDescription = (scope?: string) => {
  if (!scope) return '尚未配置';
  if (scope === 'public_courses_and_own_test_materials' || scope === '公开课程和自身测试资料') return '公开课程与本账号自己的测试资料';
  return '范围说明待确认，以账号实际授权为准';
};

type DirectoryRecord = { id: string; role: string; displayName: string; status: string; canChat: boolean; scope?: string };
const roleMap: Record<string, AiRoleKey> = { research_assistant: 'research', teaching_assistant: 'ta', senior_practice: 'senior', senior_review: 'sister' };
type WorkspaceValue = {
  members: AiMemberSummary[]; loading: boolean; error: string; canViewAudit: boolean;
  reload: () => void; openPicker: () => void; openMember: (member: AiMemberSummary, mode?: 'chat' | 'audit') => void;
};
const WorkspaceContext = createContext<WorkspaceValue | null>(null);
function useAiMembers() {
  const value = useContext(WorkspaceContext);
  if (!value) throw new Error('AI member controls require the authenticated OA workspace');
  return value;
}
const available = (member?: AiMemberSummary) => Boolean(member && ['active', 'registered'].includes(member.status) && member.canChat);

/** One directory and one dialog host for every chat entrance in the signed-in workspace. */
export function OaAiMemberProvider({ children, onTeamChat }: { children: ReactNode; onTeamChat: () => void }) {
  const chat = useOaConversation();
  const [members, setMembers] = useState<AiMemberSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [canViewAudit, setCanViewAudit] = useState(false);
  const [selected, setSelected] = useState<AiMemberSummary | null>(null);
  const [interactionMode, setInteractionMode] = useState<'chat' | 'audit'>('chat');
  const [pickerOpen, setPickerOpen] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const afterPickerClose = useRef<(() => void) | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true); setError('');
    void fetch('/api/ai-members/directory', { credentials: 'same-origin', cache: 'no-store', headers: { accept: 'application/json' }, signal: controller.signal })
      .then(async response => {
        const data = await response.json() as { members?: DirectoryRecord[]; canViewAudit?: boolean; error?: string };
        if (!response.ok || !Array.isArray(data.members)) throw new Error(data.error || 'AI 成员状态暂不可用，请稍后重试。');
        return data;
      })
      .then(data => {
        if (controller.signal.aborted) return;
        setCanViewAudit(Boolean(data.canViewAudit));
        setMembers((data.members || []).filter(member => roleMap[member.role]).map(member => ({ id: member.id, role: roleMap[member.role], displayName: member.displayName, status: member.status === 'registered' ? 'registered' : member.status === 'active' ? 'active' : member.status === 'disabled' ? 'paused' : 'pending', canChat: Boolean(member.canChat), scopeLabel: scopeDescription(member.scope) })));
      })
      .catch((cause: unknown) => { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : 'AI 成员状态读取失败。'); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [reloadKey]);
  const openMember = (member: AiMemberSummary, mode: 'chat' | 'audit' = 'chat') => {
    if (mode === 'chat' && (loading || error || !available(member))) return;
    if (mode === 'audit' && !canViewAudit) return;
    const open = () => { setInteractionMode(mode); setSelected(member); };
    if (pickerOpen) { afterPickerClose.current = open; setPickerOpen(false); } else open();
  };
  const openDestination = (action: () => void) => { afterPickerClose.current = action; setPickerOpen(false); };
  return <WorkspaceContext.Provider value={{ members, loading, error, canViewAudit, reload: () => setReloadKey(value => value + 1), openPicker: () => setPickerOpen(true), openMember }}>
    {children}
    <Dialog open={pickerOpen} onOpenChange={setPickerOpen}><DialogContent className="oa-chat-picker" onCloseAutoFocus={event => { const action = afterPickerClose.current; if (action) { event.preventDefault(); afterPickerClose.current = null; window.requestAnimationFrame(action); } }}><DialogHeader><DialogTitle>开始聊天</DialogTitle><DialogDescription>选择 AI 伙伴；每个角色分别保存与您的对话。</DialogDescription></DialogHeader>
      <AiMemberChatChoices />
      <div className="oa-chat-picker-other"><button type="button" onClick={() => openDestination(chat.showAi)}><Bot /><span><strong>实验室 AI 助手</strong><small>知识问答、资料整理与会议功能</small></span></button><button type="button" onClick={() => openDestination(chat.chooseMember)}><MessageCircle /><span><strong>与成员私聊</strong><small>选择已通过 OA 准入的成员</small></span></button><button type="button" onClick={() => openDestination(onTeamChat)}><MessageCircle /><span><strong>团队消息</strong><small>继续原有消息与协作</small></span></button></div>
    </DialogContent></Dialog>
    <AiMemberInteraction member={selected} mode={interactionMode} onClose={() => setSelected(null)} />
  </WorkspaceContext.Provider>;
}

export function OaAiChatButton({ variant = 'top', onOpen }: { variant?: 'top' | 'sidebar'; onOpen?: () => void }) {
  const workspace = useAiMembers();
  return <button type="button" className={variant === 'sidebar' ? 'oa-sidebar-new-chat' : 'oa-ai-top-chat'} onClick={() => { onOpen?.(); workspace.openPicker(); }} aria-haspopup="dialog" aria-label="聊天：选择助研、助教、学长、学姐或成员"><MessageCircle size={18} /><span>聊天</span></button>;
}

function AiMemberChatChoices() {
  const workspace = useAiMembers();
  return <>{workspace.error && <p className="oa-ai-directory-error" role="alert">{workspace.error}<button type="button" onClick={workspace.reload}><RefreshCw size={14} />重新读取</button></p>}<div className="oa-ai-chat-choices" aria-label="四位 AI 伙伴">{profiles.map(profile => {
    const member = workspace.members.find(item => item.role === profile.role);
    const ready = !workspace.loading && !workspace.error && available(member);
    return <button type="button" key={profile.role} disabled={!ready} onClick={() => { if (member) workspace.openMember(member); }}><span className="oa-ai-member-avatar"><Bot aria-hidden="true" /></span><span><strong>{member?.displayName || profile.name} <small>AI</small></strong><small>{workspace.loading ? '正在读取…' : workspace.error ? '状态暂不可用' : ready ? profile.summary : member?.status === 'paused' ? '已停用' : '暂不可聊天'}</small></span><MessageCircle aria-hidden="true" /></button>;
  })}</div></>;
}

/** Shown alongside team messages; the existing CollaborationWorkspace remains intact. */
export function OaAiChatEntrances() {
  return <section className="oa-ai-chat-entrances" aria-label="AI 聊天"><header><strong>AI 伙伴</strong><span>选择角色，开始独立会话</span></header><AiMemberChatChoices /></section>;
}

/** The same-origin gateway supplies metadata only; OA and Chat keep separate sessions. */
export function OaAiMemberDirectory() {
  const workspace = useAiMembers();
  return <AiMemberDirectory members={workspace.members} loading={workspace.loading} error={workspace.error} onChat={workspace.openMember} onAudit={workspace.canViewAudit ? member => workspace.openMember(member, 'audit') : undefined} />;
}

/** A role card is a capability description, not a registered account or an online claim. */
export function AiMemberDirectory({ members = [], loading = false, error = '', onChat, onAudit }: {
  members?: AiMemberSummary[]; loading?: boolean; error?: string; onChat?: (member: AiMemberSummary) => void; onAudit?: (member: AiMemberSummary) => void;
}) {
  const [expanded, setExpanded] = useState<AiRoleKey | null>(null);
  return <section className="oa-ai-directory" aria-labelledby="oa-ai-directory-title">
    <header><div><span>AI 伙伴</span><h2 id="oa-ai-directory-title">助研、助教与学长学姐</h2></div><p>独立身份，操作留痕；账号与执行状态以系统记录为准。</p></header>
    {error && <p className="oa-ai-directory-error" role="alert">{error}</p>}
    <div className="oa-ai-member-grid">{profiles.map(profile => {
      const member = members.find(value => value.role === profile.role);
      const ready = !loading && !error && member && ['active', 'registered'].includes(member.status) && member.canChat && Boolean(onChat);
      const label = loading ? '读取中' : error ? '状态未知' : member ? statusLabel[member.status] : '待接入';
      return <article className="oa-ai-member-card" key={profile.role}>
        <div className="oa-ai-member-heading"><span className="oa-ai-member-avatar"><Bot aria-hidden="true" /></span><div><h3>{member?.displayName || profile.name} <small>AI</small></h3><span className={`oa-ai-member-status ${member?.status === 'active' && !error ? 'connected' : ''}`}>{label}</span></div></div>
        <p>{member?.description || profile.summary}</p>
        <div className="oa-ai-member-actions"><button type="button" aria-expanded={expanded === profile.role} onClick={() => setExpanded(value => value === profile.role ? null : profile.role)}>角色资料</button><button type="button" disabled={!ready} onClick={() => { if (ready && member) onChat?.(member); }}><MessageCircle aria-hidden="true" />{ready ? '私聊' : loading || error ? label : '私聊待接入'}</button></div>
        {expanded === profile.role && <dl className="oa-ai-member-details"><div><dt>身份</dt><dd>AI 成员</dd></div><div><dt>负责人</dt><dd>{member?.ownerName || '本目录未提供'}</dd></div><div><dt>访问范围</dt><dd>{member?.scopeLabel || '尚未配置'}</dd></div><div><dt>当前任务</dt><dd>{member?.currentTask || '本目录未提供任务状态'}</dd></div><div><dt>权限</dt><dd>预检建议不等于正式审批；权限以账号实际授权为准。</dd></div>{onAudit && member && member.status !== 'pending' && <div><dt>实际过程</dt><dd><button type="button" onClick={() => onAudit(member)}>查看操作记录</button></dd></div>}</dl>}
      </article>;
    })}</div>
  </section>;
}
