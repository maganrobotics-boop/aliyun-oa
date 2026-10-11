import { getD1Database } from '../../../../../../db';
import { getAuthorizedUser } from '../../../../_lib/auth';
import { applicationAttachment } from '../../../../../../lib/project-application-store.mjs';

export const dynamic = 'force-dynamic';
export async function GET(_request: Request, { params }: { params: Promise<{ id: string; fileId: string }> }) {
  const user = await getAuthorizedUser({ noTouch: true });
  if (!user) return Response.json({ error: '请先登录 OA。' }, { status: 401 });
  const { id, fileId } = await params;
  if (!/^[a-f0-9-]{36}$/u.test(id)) return new Response('Not Found', { status: 404 });
  const db = await getD1Database();
  const row = await db.prepare('SELECT requester_email,current_reviewer_email,payload_json FROM approvals WHERE id=?').bind(id).first<{ requester_email: string; current_reviewer_email: string; payload_json: string }>();
  const email = user.user.email.trim().toLowerCase();
  const isReviewer = row && JSON.parse(row.payload_json).circulationApprovers?.some((person: { email: string; accountUserId: string; memberId: string }) => person.email === email && person.accountUserId === user.accountUserId && person.memberId === user.memberId);
  if (!row || !(user.isAdmin || email === row.requester_email.toLowerCase() || isReviewer)) return new Response('Not Found', { status: 404 });
  const file = applicationAttachment(row, fileId);
  if (!file) return new Response('Not Found', { status: 404 });
  const { env } = await import('cloudflare:workers');
  const object = await env.KNOWLEDGE_ASSETS?.get(file.key);
  if (!object) return new Response('Not Found', { status: 404 });
  return new Response(object.body, { headers: { 'content-type': file.mimeType, 'content-disposition': `attachment; filename*=UTF-8''${encodeURIComponent(file.name)}`, 'cache-control': 'private, no-store', 'x-content-type-options': 'nosniff', 'content-security-policy': "default-src 'none'; sandbox", 'referrer-policy': 'no-referrer' } });
}
