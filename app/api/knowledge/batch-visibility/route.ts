import { getDb } from "../../../../db";
import { readBoundedJsonObject } from "../../../../lib/bounded-json-request";
import { parseKnowledgeBatchVisibility, type KnowledgeBatchVisibilityResult } from "../../../../lib/knowledge-visibility-batch";
import { findKnowledgeItem, setKnowledgeItemVisibility, type KnowledgeActor } from "../../../../lib/knowledge-store";
import { consumeWriteRateLimit } from "../../../../lib/write-rate-limit";
import { getAuthorizedUser, isProjectOwner } from "../../_lib/auth";

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
  if (!authorized.isAdmin && authorized.role !== "project_owner")
    return privateJson({ error: "只有项目负责人或 OA 管理员可以批量调整资料范围。" }, { status: 403 });
  const origin = request.headers.get("origin");
  if ((origin && origin !== new URL(request.url).origin) || request.headers.get("sec-fetch-site") === "cross-site")
    return privateJson({ error: "请在 OA 内调整资料范围。" }, { status: 403 });
  if (request.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase() !== "application/json")
    return privateJson({ error: "请使用 JSON 提交调整请求。" }, { status: 415 });
  const body = await readBoundedJsonObject(request, 8192);
  const input = body.ok ? parseKnowledgeBatchVisibility(body.value) : null;
  if (!input) return privateJson({ error: "每次可调整 1–20 条已入库资料；对外公开须完成精确确认。" }, { status: 400 });
  const actor: KnowledgeActor = {
    memberId: authorized.memberId, accountUserId: authorized.accountUserId,
    memberMutationRevision: authorized.memberMutationRevision, name: authorized.user.displayName,
    email: authorized.user.email, isAdmin: authorized.isAdmin,
    configuredReviewer: isProjectOwner(authorized.user.email, authorized.accountUserId),
  };
  const result: KnowledgeBatchVisibilityResult = { changed: [], failed: [] };
  try {
    const db = await getDb();
    if (!(await consumeWriteRateLimit(db, { actorSubject: actor.accountUserId, scope: "knowledge_review", limit: 20 })))
      return privateJson({ error: "资料调整过于频繁，请稍后再试。" }, { status: 429, headers: { "retry-after": "60" } });
    for (let index = 0; index < input.items.length; index += 1) {
      const selected = input.items[index];
      try {
        const existing = await findKnowledgeItem(selected.id, actor, true);
        let error = "";
        if (!existing || existing.is_deleted) error = "资料不存在或当前账号无权处理。";
        else {
          const memberMatches = existing.submitter_member_id === actor.memberId;
          const emailMatches = existing.submitter_email.trim().toLowerCase() === actor.email.trim().toLowerCase();
          if ((memberMatches || emailMatches) && !(actor.isAdmin && memberMatches && emailMatches))
            error = "本人投稿需由其他负责人调整范围。";
          else if (existing.mutation_revision !== selected.mutationRevision) error = "资料已更新，请刷新后重新选择。";
          else if (existing.status !== "active" || !existing.current_revision_id || existing.active_revision_id !== existing.current_revision_id)
            error = "只有已入库且当前版本已启用的资料可以调整范围。";
          else if (existing.visibility === input.visibility) error = "资料已经是所选范围。";
        }
        if (error || !existing) { result.failed.push({ id: selected.id, error }); continue; }
        const changed = await setKnowledgeItemVisibility(existing, actor, input.visibility, input.publicConfirmation);
        if (!changed) result.failed.push({ id: selected.id, error: "资料或账号权限已变化，请刷新后重试。" });
        else result.changed.push({
          id: changed.id, visibility: changed.visibility, mutationRevision: changed.mutationRevision, updatedAt: changed.updatedAt,
        });
      } catch {
        result.stopped = true;
        result.failed.push({ id: selected.id, error: "调整结果未能确认，请刷新核对。" });
        result.failed.push(...input.items.slice(index + 1).map(item => ({ id: item.id, error: "本批次已停止，请重新选择。" })));
        break;
      }
    }
    return privateJson(result);
  } catch {
    return privateJson({ error: "资料暂时无法调整，请刷新核对后重试。" }, { status: 500 });
  }
}
