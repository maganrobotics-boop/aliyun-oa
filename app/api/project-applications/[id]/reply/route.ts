import { getD1Database } from '../../../../../db';
import { getAuthorizedUser } from '../../../_lib/auth';
import { PATCH as approveApplication } from '../../../approvals/[id]/route';
import { handleApplicationReply } from '../../../../../lib/project-application-replies.mjs';

export const dynamic = 'force-dynamic';
async function handle(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const authorized = await getAuthorizedUser({ noTouch: true });
  if (!authorized?.accountUserId || !authorized.memberId) return Response.json({ error: '请先登录 OA。' }, { status: 401 });
  const { id } = await params;
  const { env } = await import('cloudflare:workers');
  return handleApplicationReply(request, id, {
    db: await getD1Database(), secret: env.PUBLIC_LAB_AI_SERVICE_TOKEN || '', transport: (env as unknown as { CHAT_SERVICE?: { fetch: (url: string, init: RequestInit) => Promise<Response> } }).CHAT_SERVICE,
    actor: { email: authorized.user.email, memberId: authorized.memberId, accountUserId: authorized.accountUserId },
    approve: note => approveApplication(new Request(new URL(`/api/approvals/${id}`, request.url), { method: 'PATCH', headers: request.headers, body: JSON.stringify({ action: 'approve', note }) }), { params: Promise.resolve({ id }) }),
  });
}
export const GET = handle;
export const POST = handle;
