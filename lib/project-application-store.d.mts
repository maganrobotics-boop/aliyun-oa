import type { planApprovalRevisions } from './approval-revision-store';
export type ApplicationReviewer = { memberId: string; email: string; name: string; accountUserId: string };
export function handleProjectApplication(request: Request, options: { db: D1Database; secret: string; bucket?: R2Bucket; getReviewer: () => Promise<ApplicationReviewer | null>; planRevisions: typeof planApprovalRevisions }, now?: number): Promise<Response>;
export function applicationAttachment(row: { payload_json: string } | null, fileId: string): { id: string; name: string; size: number; mimeType: string; key: string } | null;
