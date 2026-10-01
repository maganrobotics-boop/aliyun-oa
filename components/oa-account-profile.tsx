"use client";
import { useEffect, useId, useState, type FormEvent } from "react";
import type { OaAccountUser } from "./oa-account-menu";

type Draft = { fullName: string; position: string; phone: string; bio: string };
type ProfileResponse = {
  error?: string; officialName?: string; user?: { displayName?: string };
  profile?: { avatarDataUrl?: string; position?: string; phone?: string; bio?: string };
};
const text = (value: unknown) => typeof value === "string" ? value : "";

export function OaAccountProfile({ user, onIdentityChanged }: {
  user: OaAccountUser; onIdentityChanged: (fullName: string, avatarDataUrl: string) => void;
}) {
  const fieldId = useId();
  const [draft, setDraft] = useState<Draft>({ fullName: user.displayName, position: "", phone: "", bio: "" });
  const [avatar, setAvatar] = useState("");
  const [loading, setLoading] = useState(true);
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [loadError, setLoadError] = useState("");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [saveError, setSaveError] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    const load = async () => {
      try {
        const response = await fetch("/api/profile", { credentials: "same-origin", cache: "no-store", signal: controller.signal });
        const data = await response.json() as ProfileResponse;
        if (!response.ok) throw new Error(data.error || "资料加载失败，请重试。");
        if (!data.profile) throw new Error("资料加载失败，请重试。");
        if (controller.signal.aborted) return;
        setDraft({ fullName: text(data.officialName || data.user?.displayName), position: text(data.profile.position), phone: text(data.profile.phone), bio: text(data.profile.bio) });
        setAvatar(text(data.profile.avatarDataUrl));
      } catch (error) {
        if (!controller.signal.aborted) setLoadError(error instanceof Error ? error.message : "资料加载失败，请重试。");
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    };
    void load();
    return () => controller.abort();
  }, [user.email, loadAttempt]);

  const update = (key: keyof Draft, value: string) => {
    setDraft(current => ({ ...current, [key]: value })); setMessage("");
  };
  const save = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (saving || loading || loadError) return;
    const fullName = draft.fullName.trim();
    if (fullName.length < 2 || fullName.length > 40) {
      setSaveError(true); setMessage("姓名需为 2–40 个字符。"); return;
    }
    setSaving(true); setMessage(""); setSaveError(false);
    try {
      const response = await fetch("/api/profile", {
        method: "PATCH", credentials: "same-origin", headers: { "content-type": "application/json" },
        body: JSON.stringify({ fullName, profile: { position: draft.position.trim(), phone: draft.phone.trim(), bio: draft.bio.trim() } }),
      });
      const data = await response.json() as ProfileResponse;
      if (!response.ok) throw new Error(data.error || "保存失败，请重试。");
      const nextName = text(data.officialName || data.user?.displayName) || fullName;
      const nextAvatar = data.profile?.avatarDataUrl === undefined ? avatar : text(data.profile.avatarDataUrl);
      setDraft(current => ({ ...current, fullName: nextName }));
      setAvatar(nextAvatar); onIdentityChanged(nextName, nextAvatar); setMessage("已保存");
    } catch (error) {
      setSaveError(true); setMessage(error instanceof Error ? error.message : "保存失败，请重试。");
    } finally { setSaving(false); }
  };

  if (loading) return <p className="oa-account-muted" role="status">加载中…</p>;
  if (loadError) return <div className="oa-profile-load-error"><p role="alert">{loadError}</p><button type="button" className="oa-account-secondary" onClick={() => { setLoading(true); setLoadError(""); setLoadAttempt(value => value + 1); }}>重试</button></div>;
  return <form className="oa-profile-compact" onSubmit={event => void save(event)}>
    <fieldset className="oa-profile-fields" disabled={saving}>
      <label htmlFor={fieldId + "-name"}><span>姓名</span><input id={fieldId + "-name"} name="fullName" autoComplete="name" required minLength={2} maxLength={40} value={draft.fullName} onChange={event => update("fullName", event.target.value)} /></label>
      <label htmlFor={fieldId + "-position"}><span>负责方向</span><input id={fieldId + "-position"} name="position" maxLength={80} value={draft.position} onChange={event => update("position", event.target.value)} /></label>
      <label className="oa-profile-wide" htmlFor={fieldId + "-phone"}><span>联系方式</span><input id={fieldId + "-phone"} name="phone" autoComplete="tel" maxLength={40} value={draft.phone} onChange={event => update("phone", event.target.value)} /></label>
      <label className="oa-profile-wide" htmlFor={fieldId + "-bio"}><span>简介</span><textarea id={fieldId + "-bio"} name="bio" rows={2} maxLength={240} value={draft.bio} onChange={event => update("bio", event.target.value)} /></label>
    </fieldset>
    <div className="oa-profile-footer"><span className={saveError ? "oa-profile-error" : ""} role={saveError ? "alert" : "status"}>{message}</span><button type="submit" disabled={saving}>{saving ? "保存中…" : "保存"}</button></div>
  </form>;
}
