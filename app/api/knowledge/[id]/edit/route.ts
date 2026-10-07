import { getDb } from '../../../../../db';
import { readBoundedJsonObject } from '../../../../../lib/bounded-json-request';
import { listKnowledgeRevisionAssets, referencedKnowledgeAssetPaths } from '../../../../../lib/knowledge-assets';
import { hashKnowledgeSubmission, parseImportedKnowledgeSubmission, splitKnowledgeStorageParts } from '../../../../../lib/knowledge-policy';
import { adminUpdateKnowledgeItem, findKnowledgeItem, knowledgeRevisionHashExists, type KnowledgeActor } from '../../../../../lib/knowledge-store';
import { consumeWriteRateLimit } from '../../../../../lib/write-rate-limit';
import { getAuthorizedUser } from '../../../_lib/auth';

const SAFE_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
function reply(data: unknown, status = 200) {
  return Response.json(data, { status, headers: { 'cache-control': 'private, no-store, max-age=0' } });
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const authorized = await getAuthorizedUser();
  if (!authorized) return reply({ error: '请先登录 OA。' }, 401);
  if (!authorized.isAdmin) return reply({ error: '只有系统管理员可以修改已上传的题目和内容。' }, 403);
  if (!authorized.ndaCompleted || !authorized.memberId || !authorized.accountUserId || !authorized.memberMutationRevision) return reply({ error: '请先完成 OA 成员激活及保密协议。' }, 403);
  if (request.headers.get('origin') !== new URL(request.url).origin || request.headers.get('sec-fetch-site') === 'cross-site') return reply({ error: '请在 OA 内保存修改。' }, 403);
  const { id } = await params;
  if (!SAFE_ID.test(id)) return reply({ error: '资料不存在。' }, 404);
  if (request.headers.get('content-type')?.split(';', 1)[0].trim().toLowerCase() !== 'application/json') return reply({ error: '请使用 JSON 保存修改。' }, 415);
  const parsed = await readBoundedJsonObject(request, 12 * 1024 * 1024);
  if (!parsed.ok) return reply({ error: '修改数据格式不正确或超过大小限制。' }, parsed.reason === 'too_large' ? 413 : 400);
  const body = parsed.value;
  if (Object.keys(body).some(key => !['title', 'body', 'mutationRevision'].includes(key)) || typeof body.mutationRevision !== 'string' || !body.mutationRevision) return reply({ error: '请重新打开资料后保存修改。' }, 400);
  const actor: KnowledgeActor = { memberId: authorized.memberId, accountUserId: authorized.accountUserId,
    memberMutationRevision: authorized.memberMutationRevision, name: authorized.user.displayName,
    email: authorized.user.email, isAdmin: true };
  try {
    const existing = await findKnowledgeItem(id, actor, true);
    if (!existing) return reply({ error: '资料不存在或当前账号不可操作。' }, 404);
    if (existing.mutation_revision !== body.mutationRevision) return reply({ error: '资料已被更新，请重新加载后核对修改。' }, 409);
    if (existing.status === 'active' && existing.current_revision_id !== existing.active_revision_id) return reply({ error: '该资料有尚未完成的图片更新，请先完成原更新。' }, 409);
    const submission = parseImportedKnowledgeSubmission({ title: body.title, content: body.body,
      category: existing.category, sourceLabel: existing.source_label || '', sourceUrl: existing.source_url || '' }, 5 * 1024 * 1024);
    if (!submission.ok) return reply({ error: submission.error }, 400);
    if (submission.value.title === existing.title && submission.value.content === existing.content) return reply({ received: true, item: { id: existing.id, title: existing.title, status: existing.status, visibility: existing.visibility } });
    const contentHash = await hashKnowledgeSubmission(submission.value);
    if (await knowledgeRevisionHashExists(existing.id, contentHash)) return reply({ error: '修改内容与已有历史版本相同，请调整后保存。' }, 409);
    let paths: string[];
    try { paths = referencedKnowledgeAssetPaths(submission.value.content); }
    catch { return reply({ error: '正文中的图片路径不合法，请保留 assets/ 下的图片引用。' }, 400); }
    const db = await getDb();
    const assets = paths.length && existing.current_revision_id ? await listKnowledgeRevisionAssets(db.$client, existing.current_revision_id) : [];
    const available = new Set(assets.map(asset => asset.assetPath));
    const missing = paths.filter(path => !available.has(path));
    if (missing.length) return reply({ error: `正文引用了未上传的图片：${missing.join('、')}` }, 400);
    if (!(await consumeWriteRateLimit(db, { actorSubject: actor.accountUserId, scope: 'knowledge_submit', limit: 20 }))) return reply({ error: '保存过于频繁，请稍后再试。' }, 429);
    const item = await adminUpdateKnowledgeItem(existing, actor, submission.value,
      contentHash, splitKnowledgeStorageParts(submission.value.content));
    return item ? reply({ received: true, item }) : reply({ error: '资料或账号权限已更新，请重新加载后重试。' }, 409);
  } catch { return reply({ error: '修改暂时无法保存，请保留当前编辑内容后重试。' }, 500); }
}
