type ReturnedApproval = { requesterEmail: string; status: string; updatedAt: string };
export function returnedApprovalDeletionError(approval: ReturnedApproval, actorEmail: string, expectedUpdatedAt: unknown): { status: number; error: string } | null {
  if (!actorEmail.trim() || approval.requesterEmail.trim().toLowerCase() !== actorEmail.trim().toLowerCase()) return { status: 404, error: "申请不存在或当前账号不可删除。" };
  if (approval.status !== "已退回") return { status: 409, error: "只能删除退回给本人的申请。" };
  if (typeof expectedUpdatedAt !== "string" || expectedUpdatedAt !== approval.updatedAt) return { status: 409, error: "申请已更新，请刷新后再删除。" };
  return null;
}
