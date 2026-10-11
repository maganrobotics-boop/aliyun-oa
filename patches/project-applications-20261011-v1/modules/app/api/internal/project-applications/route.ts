import { getD1Database } from '../../../../db';
import { isAdministrator } from '../../_lib/auth';
import { planApprovalRevisions } from '../../../../lib/approval-revision-store';
import { handleProjectApplication } from '../../../../lib/project-application-store.mjs';

export const dynamic = 'force-dynamic';
export async function POST(request: Request) {
  const { env } = await import('cloudflare:workers');
  const db = await getD1Database();
  return handleProjectApplication(request, {
    db, secret: env.PUBLIC_LAB_AI_SERVICE_TOKEN || '', bucket: env.KNOWLEDGE_ASSETS,
    planRevisions: planApprovalRevisions,
    async getReviewer() {
      const email = (process.env.PROJECT_APPLICATION_REVIEWER_EMAIL || 'maganrobotics@gmail.com').trim().toLowerCase();
      const member = await db.prepare("SELECT id,full_name,chatgpt_account,account_user_id FROM members WHERE lower(chatgpt_account)=? AND status='active'").bind(email).first<{ id: string; full_name: string; chatgpt_account: string; account_user_id: string }>();
      return member && isAdministrator(email, member.account_user_id) ? { memberId: member.id, accountUserId: member.account_user_id, email, name: member.full_name } : null;
    },
  });
}
