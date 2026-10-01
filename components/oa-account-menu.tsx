"use client";
/* eslint-disable react-hooks/set-state-in-effect */
import { useEffect, useState, type ReactNode } from "react";
import { ArrowLeft, BookOpen, ChevronDown, HelpCircle, LogOut, Settings2, SlidersHorizontal, UserRound, X } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import "./oa-account-menu.css";

export type OaAccountUser = { email: string; displayName: string; authProvider?: string };
type Preferences = { largeText: boolean; compact: boolean; reduceMotion: boolean };
const defaults: Preferences = { largeText: false, compact: false, reduceMotion: false };
function normalize(value: unknown): Preferences {
  const raw = value && typeof value === "object" ? value as Partial<Preferences> : {};
  return { largeText: raw.largeText === true, compact: raw.compact === true, reduceMotion: raw.reduceMotion === true };
}
function applyPreferences(value: Preferences) {
  const root = document.documentElement;
  root.dataset.oaLargeText = String(value.largeText);
  root.dataset.oaCompact = String(value.compact);
  root.dataset.oaReduceMotion = String(value.reduceMotion);
}
type AccountProps = {
  user?: OaAccountUser | null; avatarDataUrl?: string; roleLabel?: string;
  onProfile?: () => void; loginContent?: ReactNode; loading?: boolean;
  defaultOpen?: boolean; openRequest?: number;
};
export function OaAccountMenu({ user, avatarDataUrl = "", roleLabel = "", onProfile, loginContent, loading = false, defaultOpen = false, openRequest = 0 }: AccountProps) {
  const [open, setOpen] = useState(defaultOpen);
  const [panel, setPanel] = useState(loginContent ? "login" : "menu");
  const [preferences, setPreferences] = useState<Preferences>(defaults);
  const [notice, setNotice] = useState("");
  const [loggingOut, setLoggingOut] = useState(false);
  const name = user?.displayName?.trim() || (user ? "成员" : "登录");
  const preferenceKey = "oa.ui.preferences.v1." + encodeURIComponent(user?.email || "guest");
  useEffect(() => {
    const read = () => {
      let next = defaults;
      try { next = normalize(JSON.parse(localStorage.getItem(preferenceKey) || "{}")); } catch { /* use defaults */ }
      setPreferences(next); applyPreferences(next);
    };
    read();
    const sync = (event: StorageEvent) => { if (event.key === preferenceKey || event.key === null) read(); };
    window.addEventListener("storage", sync);
    return () => {
      window.removeEventListener("storage", sync);
      delete document.documentElement.dataset.oaLargeText;
      delete document.documentElement.dataset.oaCompact;
      delete document.documentElement.dataset.oaReduceMotion;
    };
  }, [preferenceKey]);
  useEffect(() => {
    if (!openRequest || loading) return;
    setPanel(loginContent ? "login" : "menu"); setOpen(true);
  }, [openRequest, loading, loginContent]);
  const updatePreference = (next: Preferences) => {
    try {
      localStorage.setItem(preferenceKey, JSON.stringify(next));
      setPreferences(next); applyPreferences(next); setNotice("已保存到当前浏览器");
    } catch { setNotice("当前浏览器无法保存设置，请检查存储权限。"); }
  };
  const changePanel = (next: string) => { setPanel(next); setNotice(""); };
  const openProfile = () => {
    if (onProfile) { setOpen(false); onProfile(); } else changePanel("profile");
  };
  const logout = async () => {
    if (loggingOut) return;
    setLoggingOut(true); setNotice("");
    try {
      const response = await fetch("/api/session", { method: "DELETE", credentials: "same-origin", headers: { accept: "application/json" } });
      if (!response.ok) throw new Error("退出失败，请稍后重试。");
      window.location.assign(user?.authProvider === "chatgpt" ? "/signout-with-chatgpt?return_to=%2F" : "/");
    } catch (error) { setNotice(error instanceof Error ? error.message : "退出失败，请稍后重试。"); setLoggingOut(false); }
  };
  const items = [
    { label: "个性化", icon: SlidersHorizontal, action: () => changePanel("personalization") },
    { label: "个人资料", icon: UserRound, action: openProfile },
    { label: "设置", icon: Settings2, action: () => changePanel("settings") },
    { label: "帮助", icon: HelpCircle, action: () => changePanel("help") },
  ];
  const title = ({ login: "登录联合研发 OA", personalization: "个性化", settings: "设置", profile: "个人资料", help: "帮助" } as Record<string, string>)[panel] || "个人菜单";
  return <div className="oa-account-root">
    <Popover open={open} onOpenChange={(next) => { setOpen(next); if (next) changePanel(loginContent ? "login" : "menu"); }}>
      <PopoverTrigger asChild>
        <button type="button" className="oa-account-trigger" disabled={loading} aria-label={loading ? "正在加载登录状态" : user ? name + "的个人菜单" : "游客，点击登录"}>
          <span className="oa-account-avatar" aria-hidden="true">{avatarDataUrl ? <img src={avatarDataUrl} alt="" /> : user ? [...name][0] : <UserRound size={17} />}</span>
          <span className="oa-account-name">{loading ? "加载中" : name}</span><ChevronDown size={13} aria-hidden="true" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" side="bottom" sideOffset={8} collisionPadding={12} className={"oa-account-popover " + (panel === "menu" ? "oa-account-menu" : "oa-account-panel")} aria-label={title}>
        {panel === "menu" ? <>
          <div className="oa-account-identity"><span className="oa-account-avatar" aria-hidden="true">{avatarDataUrl ? <img src={avatarDataUrl} alt="" /> : [...name][0]}</span><div><strong>{name}</strong><small>{roleLabel || "OA 成员"}</small></div></div>
          <div className="oa-account-actions">{items.map(({ label, icon: Icon, action }) => <button key={label} type="button" onClick={action}><Icon size={19} aria-hidden="true" />{label}</button>)}</div>
          <div className="oa-account-divider" />
          <button className="oa-account-logout" type="button" disabled={loggingOut} onClick={() => void logout()}><LogOut size={19} aria-hidden="true" />{loggingOut ? "正在退出…" : "退出登录"}</button>
        </> : <>
          <div className="oa-account-panel-heading">{user && !loginContent && <button type="button" onClick={() => changePanel("menu")} aria-label="返回个人菜单"><ArrowLeft size={18} /></button>}<h2>{title}</h2><button type="button" onClick={() => setOpen(false)} aria-label="关闭账户面板"><X size={19} /></button></div>
          <div className="oa-account-panel-body">
            {panel === "login" ? loginContent : panel === "personalization" ? <>
              <p className="oa-account-muted">按你的习惯调整 OA，设置会保存在当前浏览器。</p>
              {([{ key: "largeText", label: "放大字体", detail: "让正文、输入框和资料更容易阅读" }, { key: "compact", label: "紧凑布局", detail: "减少工作台卡片和列表的间距" }, { key: "reduceMotion", label: "减少动画", detail: "减少弹层和界面的动态效果" }] as const).map(({ key, label, detail }) => <label className="oa-preference-row" key={key}><span><strong>{label}</strong><small>{detail}</small></span><input type="checkbox" checked={preferences[key]} onChange={(event) => updatePreference({ ...preferences, [key]: event.target.checked })} /></label>)}
              <button type="button" className="oa-account-secondary" onClick={() => updatePreference({ ...defaults })}>恢复默认</button>
            </> : panel === "help" ? <><p className="oa-account-muted">从工作台跟进任务，在审批中办理申请，在资料库查阅与提交资料。</p><a className="oa-account-link" href="/guide"><BookOpen size={18} />项目章程与使用指南</a></> : <>
              <dl className="oa-account-details"><div><dt>姓名</dt><dd>{name}</dd></div><div><dt>登录方式</dt><dd>{user?.authProvider === "feishu" ? "飞书" : user?.authProvider === "github" ? "GitHub" : user?.authProvider === "chatgpt" ? "ChatGPT" : "OA 账号"}</dd></div>{roleLabel && <div><dt>身份</dt><dd>{roleLabel}</dd></div>}</dl>
              {onProfile ? <button type="button" className="oa-account-secondary" onClick={openProfile}>编辑个人资料与账户设置</button> : <p className="oa-account-muted">完成当前页面的准入步骤后，可编辑个人资料。</p>}
              {panel === "settings" && <button type="button" className="oa-account-logout" disabled={loggingOut} onClick={() => void logout()}><LogOut size={18} />{loggingOut ? "正在退出…" : "退出登录"}</button>}
            </>}
          </div>
        </>}
        {notice && <p className="oa-account-status" role="status">{notice}</p>}
      </PopoverContent>
    </Popover>
  </div>;
}

export function OaLoginWorkspace({ user, loginContent, loading = false, children }: { user?: OaAccountUser | null; loginContent?: ReactNode; loading?: boolean; children?: ReactNode }) {
  const [openRequest, setOpenRequest] = useState(0);
  return <div className="oa-login-workspace">
    <header className="oa-login-header"><div className="oa-login-header-brand"><strong>机器人自主移动与操作实验室</strong><span>OriginMind × ARTS Robotics · 联合研发 OA</span></div><OaAccountMenu key={loading ? "loading" : user?.email || "guest"} user={user} loginContent={loginContent} loading={loading} defaultOpen={Boolean(user && loginContent)} openRequest={openRequest} /></header>
    {children ? <main className="oa-access-content">{children}</main> : <main className="oa-login-welcome">
      <span className="oa-login-welcome-kicker">联合研发工作空间</span><h1>让工作有进展，让成果有记录。</h1><p>登录后跟进项目、处理审批、积累团队知识。</p>
      <button type="button" className="oa-login-primary" disabled={loading} onClick={() => setOpenRequest(value => value + 1)}>{loading ? "正在加载登录方式…" : "登录 OA"}<ChevronDown size={16} /></button>
      <div className="oa-login-overview">{[{ title: "工作台", text: "任务进展与项目里程碑" }, { title: "审批", text: "申请办理与审核归档" }, { title: "资料库", text: "团队资料与知识积累" }, { title: "大模型", text: "内部问答与研发协作" }].map(item => <button type="button" key={item.title} disabled={loading} onClick={() => setOpenRequest(value => value + 1)}><strong>{item.title}</strong><span>{item.text}</span></button>)}</div>
      <a className="oa-login-guide" href="/guide"><BookOpen size={17} />第一次使用？查看使用指南</a>
    </main>}
  </div>;
}
