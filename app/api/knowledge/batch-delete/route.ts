import { getDb } from "../../../../db";
import { readBoundedJsonObject } from "../../../../lib/bounded-json-request";
import { parseKnowledgeDeleteItems } from "../../../../lib/knowledge-delete-policy";
import { deleteOwnKnowledgeItems, type KnowledgeActor } from "../../../../lib/knowledge-store";
import { consumeWriteRateLimit } from "../../../../lib/write-rate-limit";
import { getAuthorizedUser } from "../../_lib/auth";

function privateJson(data: unknown, init: ResponseInit = {}) {
  const headers = new Headers(init.headers);
  headers.set("cache-control", "private, no-store, max-age=0");
  return Response.json(data, { ...init, headers });
}

export async function POST(request: Request) {
  const authorized = await getAuthorizedUser();
  if (!authorized) return privateJson({ error: "请先完成成员注册。" }, { status: 401 });
  if (!authorized.ndaCompleted || !authorized.memberId || !authorized.accountUserId || !authorized.memberMutationRevision)
    return privateJson({ error: "请先完成 OA 准入与保密协议签署。" }, { status: 403 });
  const origin = request.headers.get("origin");
  if ((origin && origin !== new URL(request.url).origin) || request.headers.get("sec-fetch-site") === "cross-site")
    return privateJson({ error: "请在 OA 内删除本人资料。" }, { status: 403 });
  if (request.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase() !== "application/json")
    return privateJson({ error: "请使用 JSON 提交删除请求。" }, { status: 415 });
  const body = await readBoundedJsonObject(request, 8192);
  if (!body.ok || Object.keys(body.value).some(key => key !== "items"))
    return privateJson({ error: "删除请求格式不正确。" }, { status: 400 });
  const items = parseKnowledgeDeleteItems(body.value.items);
  if (!items) return privateJson({ error: "每次可删除 1–20 条资料，请刷新后重新选择。" }, { status: 400 });
  const actor: KnowledgeActor = {
    memberId: authorized.memberId, accountUserId: authorized.accountUserId,
    memberMutationRevision: authorized.memberMutationRevision, name: authorized.user.displayName,
    email: authorized.user.email, isAdmin: authorized.isAdmin,
  };
  try {
    const db = await getDb();
    if (!(await consumeWriteRateLimit(db, { actorSubject: actor.accountUserId, scope: "knowledge_delete", limit: 20 })))
      return privateJson({ error: "删除操作过于频繁，请稍后再试。" }, { status: 429, headers: { "retry-after": "60" } });
    return privateJson(await deleteOwnKnowledgeItems(items, actor));
  } catch {
    return privateJson({ error: "资料暂时无法删除，请刷新核对后重试。" }, { status: 500 });
  }
}
