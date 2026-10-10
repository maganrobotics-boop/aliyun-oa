import { getAuthorizedUser } from '../../../_lib/auth';
import { getD1Database } from '../../../../../db';
import { readBoundedJsonObject } from '../../../../../lib/bounded-json-request';
import { taskActorGuard, taskNdaGuard } from '../../../../../lib/ai-workbench-store';
import { isMigrationWriteFrozen } from '../../../../../lib/migration-freeze';

const json = (data: unknown, status = 200) => Response.json(data, { status, headers: { 'cache-control': 'private, no-store', vary: 'Cookie' } });
type Context = { params: Promise<{ id: string }> };
type Source = { item_id: string; submitter_member_id: string; mutation_revision: string; current_revision_id: string; title: string; source_text: string; kind: string };
type Member = { id: string; account_user_id: string };

async function access(context: Context) {
  const user = await getAuthorizedUser();
  if (!user?.ndaCompleted || !user.memberId || !user.accountUserId || !user.memberMutationRevision) return json({ error: '请先完成成员准入。' }, 403);
  const { id } = await context.params;
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(id)) return json({ error: '资料不存在。' }, 404);
  const db = await getD1Database();
  const args = [user.memberId, user.accountUserId, user.memberMutationRevision];
  // Only the submitting account may share its pending material. Reviewing does not grant sharing authority.
  const guard = `s.item_id=? AND s.submitter_member_id=? AND lower(s.submitter_email)=lower(?) AND ${taskActorGuard}`;
  const values = [id, user.memberId, user.user.email, ...args];
  const source = await db.prepare(`SELECT s.* FROM personnel_knowledge_weekly_source s WHERE ${guard}`).bind(...values).first<Source>();
  if (!source || !source.source_text.trim()) return json({ error: '仅可分发本人提交、正文完整且未撤销的周报或周会资料。' }, 404);
  return { user, db, source, guard, values };
}

export async function GET(_request: Request, context: Context) {
  try {
    const ctx = await access(context); if (ctx instanceof Response) return ctx;
    const { db, source } = ctx;
    const owner = await db.prepare('SELECT source_title,source_text,created_at FROM personnel_weekly_entries WHERE member_id=? AND source_key=?')
      .bind(source.submitter_member_id, `knowledge-item:${source.item_id}`).first<{ source_title: string; source_text: string; created_at: string }>();
    const members = (await db.prepare(`SELECT p.member_id AS memberId,m.full_name AS name FROM personnel_knowledge_participants p
      JOIN members m ON m.id=p.member_id WHERE p.item_id=?`).bind(source.item_id).all()).results;
    return json({ mutationRevision: source.mutation_revision, title: owner?.source_title || source.title, members,
      sourceChanged: Boolean(owner && (owner.source_text !== source.source_text || owner.source_title !== source.title)) });
  } catch { return json({ error: '周会分发暂不可用，请联系管理员核对资料库工作流升级。' }, 503); }
}

export async function POST(request: Request, context: Context) {
  if (request.headers.get('origin') !== new URL(request.url).origin || request.headers.get('sec-fetch-site') === 'cross-site') return json({ error: '请在 OA 内分发周会资料。' }, 403);
  if (isMigrationWriteFrozen(process.env)) return json({ error: '维护期间暂停修改。' }, 503);
  if (request.headers.get('content-type')?.split(';')[0].trim() !== 'application/json') return json({ error: '请使用 JSON。' }, 415);
  const parsed = await readBoundedJsonObject(request, 12000);
  if (!parsed.ok) return json({ error: '请求格式不正确。' }, 400);
  const { memberIds, mutationRevision } = parsed.value;
  if (Object.keys(parsed.value).some(k => !['memberIds', 'mutationRevision'].includes(k)) || typeof mutationRevision !== 'string' || !mutationRevision || mutationRevision.length > 128
    || !Array.isArray(memberIds) || !memberIds.length || memberIds.length > 50 || memberIds.some(x => typeof x !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(x)) || new Set(memberIds).size !== memberIds.length) return json({ error: '请选择 1–50 位参与成员并刷新资料版本。' }, 400);
  try {
    const ctx = await access(context); if (ctx instanceof Response) return ctx;
    const { db, source, guard, values, user } = ctx;
    if (source.mutation_revision !== mutationRevision) return json({ error: '资料已更新，请刷新后重新核对参与人。' }, 409);
    const selected = JSON.stringify(memberIds);
    const eligible = `m.status='active' AND m.account_user_id IS NOT NULL AND ${taskNdaGuard}`;
    const rows = (await db.prepare(`SELECT m.id,m.account_user_id FROM members m JOIN json_each(?) j ON j.value=m.id WHERE ${eligible}`).bind(selected).all<Member>()).results;
    if (rows.length !== memberIds.length) return json({ error: '部分参与人尚未完成准入或账号已变化，请重新选择。' }, 409);
    const existing = (await db.prepare('SELECT member_id,account_user_id FROM personnel_knowledge_participants WHERE item_id=?').bind(source.item_id).all<{ member_id: string; account_user_id: string }>()).results;
    if (existing.length + rows.filter(m => !existing.some(p => p.member_id === m.id)).length > 50) return json({ error: '每份资料最多分发给 50 位参与人。' }, 409);
    if (rows.some(m => existing.some(p => p.member_id === m.id && p.account_user_id !== m.account_user_id))) return json({ error: '参与人的绑定账号已变化，请联系管理员核对原确认单。' }, 409);
    const now = new Date().toISOString();
    const currentSource = `EXISTS(SELECT 1 FROM personnel_knowledge_weekly_source s WHERE ${guard} AND s.mutation_revision=?)`;
    // Recheck the whole selected set at write time. No partial delivery if one account changes.
    const targets = JSON.stringify(rows);
    const allEligible = `(SELECT COUNT(*) FROM members m JOIN json_each(?) j ON json_extract(j.value,'$.id')=m.id
      AND json_extract(j.value,'$.account_user_id')=m.account_user_id WHERE ${eligible})=?`;
    await db.batch([
      db.prepare(`INSERT INTO personnel_weekly_entries(id,member_id,source_key,source_title,source_text,title,content,client_key,created_at,updated_at,mutation_token)
        SELECT 'auto-knowledge-'||s.item_id||'-'||s.submitter_member_id,s.submitter_member_id,'knowledge-item:'||s.item_id,s.title,s.source_text,s.title,
        CASE WHEN s.kind='weekly' AND length(s.source_text)<=3500 THEN s.source_text ELSE '' END,
        'weekly-auto-'||lower(hex(randomblob(16))),?,?,'auto:'||s.current_revision_id FROM personnel_knowledge_weekly_source s
        WHERE ${guard} AND s.mutation_revision=? AND ${allEligible} ON CONFLICT(member_id,source_key) DO NOTHING`)
        .bind(now, now, ...values, mutationRevision, targets, rows.length),
      db.prepare(`INSERT INTO personnel_knowledge_participants(item_id,member_id,account_user_id,added_by_member_id,created_at)
        SELECT ?,m.id,m.account_user_id,?,? FROM members m JOIN json_each(?) j ON json_extract(j.value,'$.id')=m.id
          AND json_extract(j.value,'$.account_user_id')=m.account_user_id
        WHERE ${eligible} AND ${currentSource} AND ${allEligible}
          AND NOT EXISTS(SELECT 1 FROM personnel_knowledge_participants p JOIN json_each(?) x ON json_extract(x.value,'$.id')=p.member_id
            WHERE p.item_id=? AND p.account_user_id<>json_extract(x.value,'$.account_user_id'))
          AND EXISTS(SELECT 1 FROM personnel_weekly_entries WHERE member_id=? AND source_key=?)
          AND (SELECT COUNT(*) FROM personnel_knowledge_participants WHERE item_id=? AND member_id NOT IN (SELECT value FROM json_each(?)))+?<=50
        ON CONFLICT(item_id,member_id) DO NOTHING`)
        .bind(source.item_id, user.memberId, now, targets, ...values, mutationRevision, targets, rows.length, targets, source.item_id,
          user.memberId, `knowledge-item:${source.item_id}`, source.item_id, selected, rows.length),
    ]);
    const saved = (await db.prepare(`SELECT p.member_id,p.account_user_id FROM personnel_knowledge_participants p
      JOIN personnel_weekly_entries w ON w.member_id=p.member_id AND w.source_key='knowledge-item:'||p.item_id
      WHERE p.item_id=? AND ${currentSource} AND ${allEligible}`)
      .bind(source.item_id, ...values, mutationRevision, targets, rows.length).all<{ member_id: string; account_user_id: string }>()).results;
    if (rows.some(m => !saved.some(p => p.member_id === m.id && p.account_user_id === m.account_user_id))) return json({ error: '资料或账号已变化，请刷新核对分发结果后重试。' }, 409);
    return json({ saved: true, count: rows.length });
  } catch { return json({ error: '分发结果尚未确认，请刷新核对后重试；重复分发不会重复建单。' }, 503); }
}
