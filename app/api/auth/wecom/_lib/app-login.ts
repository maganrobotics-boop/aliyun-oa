import { and, eq, gt, isNull, lt, sql } from "drizzle-orm";
import { cookies } from "next/headers";
import { getDb } from "../../../../../db";
import { authIdentities, members, oauthSessions, oauthTransactions } from "../../../../../db/schema";
import { normalizeReturnPath, randomBase64Url, sha256Hex } from "../../../../../lib/github-oauth";
import { OAUTH_SESSION_COOKIE, OAUTH_SESSION_MAX_AGE_SECONDS } from "../../../../../lib/oauth-session";
import { validQrNonce } from "../../../../../lib/qr-login";
import { WECOM_APP_BROWSER_COOKIE, WECOM_APP_TRANSACTION_SECONDS, isWecomBrowser } from "../../../../../lib/wecom-app-entry";
import { buildWecomAuthorizeUrl, exchangeWecomCode, getWecomOAuthConfig, WECOM_PROVIDER } from "../../../../../lib/wecom-oauth";
import { consumeWriteRateLimit } from "../../../../../lib/write-rate-limit";
import { getAuthorizedUser } from "../../../_lib/auth";

const headers = { "cache-control": "private, no-store, max-age=0", "referrer-policy": "no-referrer", "x-content-type-options": "nosniff" };
const cookieOptions = { httpOnly: true, secure: true, sameSite: "lax" as const, path: "/", maxAge: WECOM_APP_TRANSACTION_SECONDS };

function returnPath(value: string | null) {
  const path = normalizeReturnPath(value);
  const url = new URL(path, "https://oa.invalid");
  if (/^\/(?:api|auth|signin-with-chatgpt|signout-with-chatgpt)(?:\/|$)/u.test(url.pathname)) return "/";
  url.searchParams.delete("wecom");
  return url.pathname + url.search + url.hash;
}

function redirect(origin: string, path: string, status?: string) {
  const target = new URL(returnPath(path), origin);
  if (status) target.searchParams.set("wecom", status);
  return new Response(null, { status: 303, headers: { ...headers, location: target.href } });
}

function configForApp() {
  const config = getWecomOAuthConfig();
  return { ...config, callbackUrl: `${config.origin}/api/auth/wecom/callback` };
}

export async function startWecomAppLogin(request: Request) {
  let config;
  try { config = configForApp(); }
  catch { return new Response(null, { status: 303, headers: { ...headers, location: "/?wecom=unavailable" } }); }
  const url = new URL(request.url);
  if (url.origin !== config.origin) return Response.json({ error: "登录域名不正确。" }, { status: 400, headers });
  const destination = returnPath(url.searchParams.get("return_to"));
  // Browser detection selects a presentation only; it never proves identity.
  if (!isWecomBrowser(request.headers.get("user-agent") || "")) return redirect(config.origin, destination, "manual");
  try {
    if (await getAuthorizedUser({ readOnly: true })) return redirect(config.origin, destination);
    const db = await getDb();
    const now = new Date();
    const clientIp = process.env.OA_RUNTIME === "aliyun" ? request.headers.get("x-real-ip") : request.headers.get("cf-connecting-ip");
    const fingerprint = await sha256Hex(clientIp || "unknown");
    if (!(await consumeWriteRateLimit(db, { actorSubject: fingerprint, scope: "qr_login_start", limit: 12, now }))) {
      return redirect(config.origin, destination, "unavailable");
    }
    const state = randomBase64Url(32);
    const nonce = randomBase64Url(32);
    await db.batch([
      db.delete(oauthTransactions).where(and(eq(oauthTransactions.provider, WECOM_PROVIDER), lt(oauthTransactions.expiresAt, now.toISOString()))),
      db.insert(oauthTransactions).values({
        stateHash: await sha256Hex(state), provider: WECOM_PROVIDER,
        browserNonceHash: await sha256Hex(nonce), pkceVerifier: "wecom-app-no-pkce",
        action: "login", memberId: null, returnPath: destination,
        createdAt: now.toISOString(), expiresAt: new Date(now.getTime() + WECOM_APP_TRANSACTION_SECONDS * 1000).toISOString(),
      }),
    ]);
    (await cookies()).set(WECOM_APP_BROWSER_COOKIE, nonce, cookieOptions);
    return new Response(null, { status: 303, headers: { ...headers, location: buildWecomAuthorizeUrl(config, state).href } });
  } catch { return redirect(config.origin, destination, "unavailable"); }
}

export async function finishWecomAppLogin(request: Request) {
  let config;
  try { config = configForApp(); }
  catch { return new Response(null, { status: 303, headers: { ...headers, location: "/?wecom=unavailable" } }); }
  const url = new URL(request.url);
  if (url.origin !== config.origin) return Response.json({ error: "登录回调域名不正确。" }, { status: 400, headers });
  const jar = await cookies();
  const nonce = jar.get(WECOM_APP_BROWSER_COOKIE)?.value;
  jar.set(WECOM_APP_BROWSER_COOKIE, "", { ...cookieOptions, maxAge: 0 });
  const state = url.searchParams.get("state");
  const code = url.searchParams.get("code") || "";
  const denied = url.searchParams.has("error");
  if (!validQrNonce(nonce) || !validQrNonce(state) || (!denied && (!code || new TextEncoder().encode(code).length > 512 || /[\u0000-\u0020\u007f]/u.test(code)))) {
    return redirect(config.origin, "/", "failed");
  }
  let destination = "/";
  try {
    const db = await getDb();
    const now = new Date().toISOString();
    // Atomically consume provider-pinned, browser-bound state before exchange.
    const [transaction] = await db.update(oauthTransactions).set({ consumedAt: now }).where(and(
      eq(oauthTransactions.stateHash, await sha256Hex(state)), eq(oauthTransactions.provider, WECOM_PROVIDER),
      eq(oauthTransactions.browserNonceHash, await sha256Hex(nonce)), eq(oauthTransactions.action, "login"),
      eq(oauthTransactions.pkceVerifier, "wecom-app-no-pkce"), isNull(oauthTransactions.memberId),
      isNull(oauthTransactions.consumedAt), gt(oauthTransactions.expiresAt, now),
    )).returning({ returnPath: oauthTransactions.returnPath });
    if (!transaction) return redirect(config.origin, "/", "failed");
    destination = returnPath(transaction.returnPath);
    if (denied) return redirect(config.origin, destination, "failed");
    const identity = await exchangeWecomCode(config, code);
    const [binding] = await db.select().from(authIdentities).where(and(
      eq(authIdentities.provider, WECOM_PROVIDER), eq(authIdentities.providerSubject, identity.providerSubject),
    )).limit(1);
    if (!binding) return redirect(config.origin, destination, "not-linked");
    if (binding.unlinkedAt) return redirect(config.origin, destination, "member-disabled");
    const token = randomBase64Url(48);
    const tokenHash = await sha256Hex(token);
    const expiresAt = new Date(Date.now() + OAUTH_SESSION_MAX_AGE_SECONDS * 1000).toISOString();
    // Select the existing active member inside the insert itself. No automatic
    // member creation/linking or change to another browser's valid sessions.
    const rows = await db.insert(oauthSessions).select(db.select({
      tokenHash: sql<string>`${tokenHash}`.as("token_hash"),
      provider: sql<string>`${WECOM_PROVIDER}`.as("provider"), providerSubject: authIdentities.providerSubject,
      memberId: members.id, loginSnapshot: sql<string>`${identity.userId}`.as("login_snapshot"),
      emailSnapshot: members.chatgptAccount, displayNameSnapshot: members.fullName,
      createdAt: sql<string>`${now}`.as("created_at"), lastSeenAt: sql<string>`${now}`.as("last_seen_at"),
      expiresAt: sql<string>`${expiresAt}`.as("expires_at"), revokedAt: sql<string | null>`NULL`.as("revoked_at"),
    }).from(authIdentities).innerJoin(members, eq(authIdentities.memberId, members.id)).where(and(
      eq(authIdentities.id, binding.id), eq(authIdentities.memberId, binding.memberId),
      eq(authIdentities.provider, WECOM_PROVIDER), eq(authIdentities.providerSubject, identity.providerSubject),
      isNull(authIdentities.unlinkedAt), eq(members.status, "active"), sql`${members.accountUserId} IS NOT NULL AND ${members.accountUserId} <> ''`,
    ))).returning({ tokenHash: oauthSessions.tokenHash });
    if (!rows[0]) return redirect(config.origin, destination, "member-disabled");
    jar.set(OAUTH_SESSION_COOKIE, token, { ...cookieOptions, maxAge: OAUTH_SESSION_MAX_AGE_SECONDS });
    return redirect(config.origin, destination, "signed-in");
  } catch { return redirect(config.origin, destination, "failed"); }
}
