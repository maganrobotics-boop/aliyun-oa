export const WECOM_APP_BROWSER_COOKIE = "__Host-oa_wecom_app";
export const WECOM_APP_TRANSACTION_SECONDS = 300;

export function isWecomBrowser(userAgent: string) {
  return /\bwxwork\//iu.test(userAgent);
}

export function wecomAppEntry(userAgent: string, search: string, enabled: boolean, action: string) {
  if (!enabled || action !== "login" || !isWecomBrowser(userAgent)) return "qr";
  const status = new URLSearchParams(search).get("wecom");
  if (status === "manual") return "qr";
  return status ? "notice" : "automatic";
}

export function wecomAppMessage(status: string | null) {
  if (status === "not-linked") return "此企微账号尚未绑定 OA。请先使用原登录方式进入 OA，在“设置 → 账号绑定”中绑定本人企业微信，再从企微应用进入。";
  if (status === "member-disabled") return "当前 OA 账号已停用或绑定状态发生变化，请联系管理员。";
  if (status === "signed-out") return "已退出 OA。点击下方按钮可使用当前企微身份重新登录。";
  if (status === "unavailable") return "企业微信登录暂时不可用，请稍后重试或使用其他登录方式。";
  return "企业微信登录未完成，请重试。若仍无法进入，可使用其他登录方式。";
}
