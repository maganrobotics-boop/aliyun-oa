'use client';

import { BookOpen, ClipboardCheck, LayoutDashboard, MessageCircle, Upload, UserRound, UsersRound } from 'lucide-react';

export type OaPrimaryView = 'chat' | 'project' | 'people' | 'profile';
export const OA_PRIMARY_ENTRIES = [
  { key: 'chat', label: '消息', icon: MessageCircle },
  { key: 'people', label: '通讯录', icon: UsersRound },
  { key: 'project', label: '工作台', icon: LayoutDashboard },
  { key: 'profile', label: '我的', icon: UserRound },
] as const;

export function OaPrimaryNavigation({ active, onNavigate }: { active: OaPrimaryView; onNavigate: (view: OaPrimaryView) => void }) {
  return <nav className="oa-primary-navigation" aria-label="OA 主导航">{OA_PRIMARY_ENTRIES.map(({ key, label, icon: Icon }) =>
    <button type="button" key={key} onClick={() => onNavigate(key)} aria-current={active === key ? 'page' : undefined}><Icon aria-hidden="true" /><span>{label}</span></button>
  )}</nav>;
}

export function OaQuickNavigation({ active, hidden = false, onApproval, onUpload, onLibrary }: {
  active?: 'approval' | 'upload' | 'library'; hidden?: boolean;
  onApproval: () => void; onUpload: () => void; onLibrary: () => void;
}) {
  return <nav className="oa-quick-navigation" aria-label="固定业务入口" hidden={hidden}>
    <button type="button" onClick={onApproval} aria-current={active === 'approval' ? 'page' : undefined}><span><ClipboardCheck aria-hidden="true" /></span><strong>审批</strong></button>
    <button type="button" onClick={onUpload} aria-current={active === 'upload' ? 'page' : undefined}><span><Upload aria-hidden="true" /></span><strong>上传</strong></button>
    <button type="button" onClick={onLibrary} aria-current={active === 'library' ? 'page' : undefined}><span><BookOpen aria-hidden="true" /></span><strong>资料库</strong></button>
    <a href="https://chat.omindos.cn/newbie-village" target="_blank" rel="noreferrer" aria-label="新手村，在新窗口打开"><span><UsersRound aria-hidden="true" /></span><strong>新手村 <small>↗</small></strong></a>
  </nav>;
}
