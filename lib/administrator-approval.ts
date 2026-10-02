const REVIEW_STEPS: Record<string, readonly string[]> = {
  技术审核: ["技术顾问", "项目负责人"],
  采购审核: ["技术顾问", "项目负责人"],
  保密协议: ["项目负责人", "OA管理员"],
  劳务报酬: ["项目负责人", "经费负责人"],
  流转审批: ["指定审批"],
};

export function administratorReviewAllowed(type: string, step: string, status: string, isAdmin: boolean) {
  return isAdmin && ["待审核", "审批中"].includes(status) && REVIEW_STEPS[type]?.includes(step) === true;
}

export type AdministratorReview = {
  step: string;
  email: string;
  name: string;
  memberId: string;
  accountUserId: string;
  approvedAt: string;
  assignedReviewerEmail: string;
};

export function administratorReviews(payload: Record<string, unknown>): AdministratorReview[] {
  if (!Array.isArray(payload.administratorReviews)) return [];
  return payload.administratorReviews.filter((value): value is AdministratorReview => {
    if (!value || typeof value !== "object" || Array.isArray(value)) return false;
    const record = value as Record<string, unknown>;
    return ["step", "email", "name", "memberId", "accountUserId", "approvedAt", "assignedReviewerEmail"].every((key) => typeof record[key] === "string")
      && Boolean(record.memberId && record.accountUserId && record.email)
      && !Number.isNaN(Date.parse(record.approvedAt as string));
  });
}

export function hasAdministratorReview(payload: Record<string, unknown>, step: string, email: string) {
  return administratorReviews(payload).some((record) => record.step === step && record.email === email);
}
