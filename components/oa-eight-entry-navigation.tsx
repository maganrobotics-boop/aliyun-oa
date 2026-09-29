'use client';

import { useRef } from 'react';
import { useOaViewport } from '@/hooks/use-oa-viewport';
import './oa-viewport-fixes.css';
import { BookOpen, Bot, ClipboardCheck, LayoutDashboard, Mail, Upload } from 'lucide-react';

export type OaPrimaryView = 'project' | 'dashboard' | 'library' | 'model';
export const OA_PRIMARY_ENTRIES = [
  { key: 'project', label: '工作台', icon: LayoutDashboard },
  { key: 'dashboard', label: '审批', icon: ClipboardCheck },
  { key: 'library', label: '资料库', icon: BookOpen },
  { key: 'model', label: '大模型', icon: Bot },
] as const;
export function OaPrimaryNavigation({ active, onNavigate }: { active: OaPrimaryView; onNavigate: (view: OaPrimaryView) => void }) {
  const nav = useRef<HTMLElement>(null);
  useOaViewport(nav);
  return <nav ref={nav} className="oa-primary-navigation" aria-label="OA 主导航">{OA_PRIMARY_ENTRIES.map(({ key, label, icon: Icon }) =>
    <button type="button" key={key} onClick={() => onNavigate(key)} aria-current={active === key ? 'page' : undefined}><Icon aria-hidden="true" /><span>{label}</span></button>
  )}</nav>;
}

export function OaQuickNavigation({ active, hidden = false, onApproval, onUpload, onLibrary, onMail }: {
  active?: 'approval' | 'upload' | 'library'; hidden?: boolean;
  onMail?: () => void; onApproval: () => void; onUpload: () => void; onLibrary: () => void;
}) {
  return <nav className="oa-quick-navigation" aria-label="固定业务入口" hidden={hidden}>
    <button type="button" onClick={onApproval} aria-current={active === 'approval' ? 'page' : undefined}><span><ClipboardCheck aria-hidden="true" /></span><strong>审批</strong></button>
    <button type="button" onClick={onUpload} aria-current={active === 'upload' ? 'page' : undefined}><span><Upload aria-hidden="true" /></span><strong>上传</strong></button>
    <button type="button" onClick={onLibrary} aria-current={active === 'library' ? 'page' : undefined}><span><BookOpen aria-hidden="true" /></span><strong>资料库</strong></button>
    <button type="button" onClick={onMail}><span><Mail aria-hidden="true" /></span><strong>邮箱</strong></button>
  </nav>;
}
