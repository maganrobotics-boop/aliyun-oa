const normalizedEmail = (value?: string) => value?.trim().toLowerCase() || '';

// Presentation filters only. Existing authenticated APIs remain the authority.
export function myReturnedApprovals<T extends { status: string; requesterEmail?: string }>(items: T[], email: string) {
  const current = normalizedEmail(email);
  return current ? items.filter(item => item.status === '已退回' && normalizedEmail(item.requesterEmail) === current) : [];
}

type PendingWork = { kind: string; status: string; assigneeEmail: string; milestone?: { evidence?: string; acceptedAt?: string | null } | null };
export function myPendingWork<T extends PendingWork>(items: T[], email: string, canAccept: boolean) {
  const current = normalizedEmail(email);
  if (!current) return { tasks: [] as T[], milestones: [] as T[] };
  const tasks = items.filter(item => item.kind !== 'milestone' && ['open', 'in_progress'].includes(item.status) && normalizedEmail(item.assigneeEmail) === current);
  const milestones = items.filter(item => item.kind === 'milestone' && item.status !== 'cancelled' && !item.milestone?.acceptedAt && (
    (['open', 'in_progress'].includes(item.status) && normalizedEmail(item.assigneeEmail) === current) ||
    (canAccept && (Boolean(item.milestone?.evidence?.trim()) || item.status === 'done'))
  ));
  return { tasks, milestones };
}
