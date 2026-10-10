"use client";

import { useEffect, useId, useState } from "react";
import { Building2, CheckCircle2 } from "lucide-react";
import { OaQrLogin } from "./oa-qr-login";

type BindingStatus = { wecomLoginEnabled: boolean; wecomLinked: boolean };

export function OaAccountConnections() {
  const qrId = useId();
  const [status, setStatus] = useState<BindingStatus | null>(null);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  const [binding, setBinding] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    const load = async () => {
      try {
        const response = await fetch("/api/profile", {
          credentials: "same-origin", cache: "no-store",
          signal: AbortSignal.any([controller.signal, AbortSignal.timeout(12_000)]),
        });
        const data = await response.json() as Partial<BindingStatus> & { error?: string };
        if (!response.ok) throw new Error(data.error || "绑定状态加载失败，请重试。");
        if (!controller.signal.aborted) {
          setStatus({ wecomLoginEnabled: data.wecomLoginEnabled === true, wecomLinked: data.wecomLinked === true });
        }
      } catch (cause) {
        if (!controller.signal.aborted) setError(cause instanceof Error && cause.name !== "TimeoutError" ? cause.message : "绑定状态加载失败，请重试。");
      }
    };
    void load();
    return () => controller.abort();
  }, [attempt]);

  return <section className="oa-account-connections" aria-label="账号绑定">
    <h3>账号绑定</h3>
    <div className="oa-account-binding-heading"><Building2 size={20} aria-hidden="true" /><strong>企业微信</strong></div>
    {error ? <div className="oa-profile-load-error"><p role="alert">{error}</p><button type="button" className="oa-account-secondary" onClick={() => { setError(""); setStatus(null); setAttempt(value => value + 1); }}>重新加载绑定状态</button></div>
      : !status ? <p className="oa-account-muted" role="status">正在加载绑定状态…</p>
      : status.wecomLinked ? <p className="oa-account-binding-success" role="status"><CheckCircle2 size={18} aria-hidden="true" />已绑定，可使用企业微信登录当前账号</p>
      : status.wecomLoginEnabled ? <>
        <p className="oa-account-muted">绑定后，飞书和企业微信均可登录当前账号，继续使用原有资料和权限。</p>
        <button type="button" className="oa-account-secondary" aria-expanded={binding} aria-controls={qrId} onClick={() => setBinding(value => !value)}>{binding ? "关闭绑定二维码" : "绑定企业微信"}</button>
        {binding && <div id={qrId} className="oa-account-binding-qr"><OaQrLogin feishuEnabled={false} wecomEnabled action="link" onLinked={() => { setStatus({ wecomLoginEnabled: true, wecomLinked: true }); setBinding(false); }} /></div>}
      </> : <p className="oa-account-muted" role="status">企业微信登录暂未启用。</p>}
  </section>;
}
