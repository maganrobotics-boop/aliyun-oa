"use client";
import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
type InstallEvent = Event & { prompt: () => Promise<void>; userChoice: Promise<{outcome: string}> };
const Context = createContext({ installed: false, install: async () => {}, message: "" });
export function OaPwaProvider({children}: {children: ReactNode}) {
  const pending = useRef<InstallEvent | null>(null);
  const [installed, setInstalled] = useState(false);
  const [message, setMessage] = useState("");
  useEffect(() => {
    const media = window.matchMedia("(display-mode: standalone)");
    const sync = () => setInstalled(media.matches || Boolean((navigator as Navigator & {standalone?: boolean}).standalone));
    sync(); media.addEventListener("change", sync);
    const before = (e: Event) => { e.preventDefault(); pending.current = e as InstallEvent; };
    const done = () => { pending.current = null; setInstalled(true); setMessage("OA 已安装，可从桌面打开。"); };
    window.addEventListener("beforeinstallprompt", before);
    window.addEventListener("appinstalled", done);
    if ("serviceWorker" in navigator) navigator.serviceWorker.register("/oa-sw.js", {scope: "/", updateViaCache: "none"}).catch(() => {});
    return () => { media.removeEventListener("change", sync); window.removeEventListener("beforeinstallprompt", before); window.removeEventListener("appinstalled", done); };
  }, []);
  const install = async () => {
    if (installed) { setMessage("OA 已在独立应用窗口中打开。"); return; }
    const event = pending.current;
    if (!event) {
      setMessage((/iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1)) ? "在 Safari 中打开 OA，点击分享，再选择“添加到主屏幕”。" : "请在 Chrome 或 Edge 的浏览器菜单中选择“安装应用”或“添加到主屏幕”。若在微信或飞书内，请先用系统浏览器打开。");
      return;
    }
    try { await event.prompt(); const choice = await event.userChoice; pending.current = null; setMessage(choice.outcome === "accepted" ? "已确认安装，请从桌面打开 OA。" : "已取消安装，仍可继续使用网页版。"); }
    catch { setMessage("请通过浏览器菜单中的“安装应用”或“添加到主屏幕”完成安装。"); }
  };
  return <Context.Provider value={{installed, install, message}}>{children}</Context.Provider>;
}
export function OaInstallButton({className}: {className?: string}) {
  const {installed, install, message} = useContext(Context);
  return <div><button type="button" className={className} onClick={() => void install()}>{installed ? "OA 已安装" : "安装 OA"}</button>{message && <p role="status" style={{fontSize: "13px", lineHeight: 1.6, padding: "8px 0", overflowWrap: "anywhere"}}>{message}</p>}</div>;
}
