export const OAUTH_SESSION_COOKIE = "__Host-oa_oauth_session";
export const LEGACY_GITHUB_SESSION_COOKIE = "__Host-oa_github_session";
export const OAUTH_SESSION_MAX_AGE_SECONDS = 7 * 24 * 60 * 60;
export const OAUTH_SESSION_IDLE_MAX_AGE_MS = OAUTH_SESSION_MAX_AGE_SECONDS * 1000;

export type OAuthProvider = "github" | "feishu";
