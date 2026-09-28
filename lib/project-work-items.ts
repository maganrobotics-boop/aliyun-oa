export const OA_PROJECT = 'OriginMind × ARTS Robotics 联合研发项目';

export type WorkItemKind = 'task' | 'meeting_action' | 'risk' | 'milestone';
export type WorkItemStatus = 'open' | 'in_progress' | 'done' | 'cancelled';
export type MilestoneAcceptance = {
  deliverables: string; acceptanceCriteria: string; evidence: string; acceptanceNote: string;
  acceptedByName: string; acceptedByEmail: string; acceptedAt: string | null;
};
export type MilestoneRevision = {
  action: 'updated' | 'accepted' | 'reopened' | 'cancelled';
  changedAt: string; changedByName: string; changedByEmail: string;
  previousStatus: WorkItemStatus; previousDueAt: string | null; previousCompletedAt: string | null;
  previousUpdatedAt: string; previous: MilestoneAcceptance;
};
export type MilestoneDetail = MilestoneAcceptance & { history: MilestoneRevision[]; historyTruncated: boolean };
export type WorkItem = {
  id: string; project: string; title: string; detail: string; kind: WorkItemKind; status: WorkItemStatus;
  priority: 'low' | 'normal' | 'high'; assigneeName: string; assigneeEmail: string; dueAt: string | null;
  sourceType: 'manual' | 'meeting' | 'approval'; sourceId: string; createdByName: string; createdByEmail: string;
  completedAt: string | null; createdAt: string; updatedAt: string; milestone: MilestoneDetail | null;
};

export type WorkItemRow = {
  id: string; project: string; title: string; detail: string; kind: WorkItemKind; status: WorkItemStatus;
  priority: 'low' | 'normal' | 'high'; assignee_name: string; assignee_email: string; due_at: string | null;
  source_type: 'manual' | 'meeting' | 'approval'; source_id: string; created_by_name: string; created_by_email: string;
  completed_at: string | null; created_at: string; updated_at: string;
};

// Keep the existing table and source links intact. Legacy plain-text detail remains readable.
const milestonePrefix = 'OM_MILESTONE_V1\n';
const milestoneLimits = { deliverables: 2000, acceptanceCriteria: 2000, evidence: 4000, acceptanceNote: 2000 } as const;
export const emptyMilestoneDetail = (): MilestoneDetail => ({
  deliverables: '', acceptanceCriteria: '', evidence: '', acceptanceNote: '',
  acceptedByName: '', acceptedByEmail: '', acceptedAt: null, history: [], historyTruncated: false,
});
const object = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const isAcceptance = (value: unknown): value is MilestoneAcceptance => object(value) &&
  ['deliverables', 'acceptanceCriteria', 'evidence', 'acceptanceNote', 'acceptedByName', 'acceptedByEmail'].every(key => typeof value[key] === 'string') &&
  (value.acceptedAt === null || typeof value.acceptedAt === 'string');
const isRevision = (value: unknown): value is MilestoneRevision => object(value) &&
  ['updated', 'accepted', 'reopened', 'cancelled'].includes(String(value.action)) &&
  ['open', 'in_progress', 'done', 'cancelled'].includes(String(value.previousStatus)) &&
  ['changedAt', 'changedByName', 'changedByEmail', 'previousUpdatedAt'].every(key => typeof value[key] === 'string') &&
  ['previousDueAt', 'previousCompletedAt'].every(key => value[key] === null || typeof value[key] === 'string') && isAcceptance(value.previous);
const acceptanceSnapshot = (value: MilestoneAcceptance): MilestoneAcceptance => ({
  deliverables: value.deliverables, acceptanceCriteria: value.acceptanceCriteria, evidence: value.evidence,
  acceptanceNote: value.acceptanceNote, acceptedByName: value.acceptedByName, acceptedByEmail: value.acceptedByEmail,
  acceptedAt: value.acceptedAt,
});

export function readMilestoneDetail(detail: string): { detail: string; milestone: MilestoneDetail } {
  if (detail.startsWith(milestonePrefix)) {
    try {
      const value: unknown = JSON.parse(detail.slice(milestonePrefix.length));
      if (object(value) && value.version === 1 && typeof value.detail === 'string' && isAcceptance(value.milestone)) {
        const milestone = value.milestone;
        const extra = milestone as MilestoneAcceptance & { history?: unknown; historyTruncated?: unknown };
        const rawHistory = Array.isArray(extra.history) ? extra.history : [];
        const history = rawHistory.filter(isRevision).slice(-20);
        return { detail: value.detail, milestone: {
          ...acceptanceSnapshot(milestone), history,
          historyTruncated: extra.historyTruncated === true || history.length !== rawHistory.length,
        } };
      }
    } catch { /* A malformed/legacy value is displayed as its original detail, never silently discarded. */ }
  }
  return { detail, milestone: emptyMilestoneDetail() };
}

export const writeMilestoneDetail = (detail: string, milestone: MilestoneDetail) =>
  milestonePrefix + JSON.stringify({ version: 1, detail, milestone });

export function parseMilestoneDueAt(value: unknown, current: string | null):
  { ok: true; dueAt: string | null } | { ok: false; error: string } {
  if (value === undefined) return { ok: true, dueAt: current };
  if (value === null || value === '') return { ok: true, dueAt: null };
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/u.test(value) && Number(value.slice(0, 4)) > 0) {
    const timestamp = Date.parse(`${value}T00:00:00.000Z`);
    if (Number.isFinite(timestamp) && new Date(timestamp).toISOString().slice(0, 10) === value) return { ok: true, dueAt: value };
  }
  return { ok: false, error: '计划日期须为真实的 YYYY-MM-DD 日期。' };
}

// Bounded recent revisions preserve revoked acceptance evidence. This is not a complete audit log.
export function appendMilestoneRevision(milestone: MilestoneDetail, previous: WorkItemRow, nextStatus: WorkItemStatus,
  actor: { name: string; email: string }, changedAt: string): MilestoneDetail {
  const previousMilestone = readMilestoneDetail(previous.detail).milestone;
  const entry: MilestoneRevision = {
    action: nextStatus === 'done' ? 'accepted' : previous.status === 'done' ? 'reopened' : nextStatus === 'cancelled' ? 'cancelled' : 'updated',
    changedAt, changedByName: actor.name, changedByEmail: actor.email,
    previousStatus: previous.status, previousDueAt: previous.due_at, previousCompletedAt: previous.completed_at,
    previousUpdatedAt: previous.updated_at, previous: acceptanceSnapshot(previousMilestone),
  };
  const history = [...previousMilestone.history, entry];
  return { ...milestone, history: history.slice(-20), historyTruncated: previousMilestone.historyTruncated || history.length > 20 };
}

// Only editable fields are accepted from the browser. Reviewer identity/time are server owned.
export function mergeMilestoneInput(input: unknown, current = emptyMilestoneDetail()):
  { ok: true; milestone: MilestoneDetail } | { ok: false; error: string } {
  if (input !== undefined && !object(input)) return { ok: false, error: '里程碑交付与验收信息格式不正确。' };
  const milestone = { ...current };
  for (const [field, max] of Object.entries(milestoneLimits) as Array<[keyof typeof milestoneLimits, number]>) {
    if (input === undefined || !Object.prototype.hasOwnProperty.call(input, field)) continue;
    const value = (input as Record<string, unknown>)[field];
    if (typeof value !== 'string' || value.length > max) return { ok: false, error: `里程碑字段 ${field} 格式错误或超过 ${max} 字。` };
    milestone[field] = value.trim();
  }
  return { ok: true, milestone };
}

export function milestoneCompletionError(milestone: MilestoneDetail): string | null {
  if (!milestone.deliverables) return '请补充里程碑交付物。';
  if (!milestone.acceptanceCriteria) return '请补充里程碑验收标准。';
  if (!milestone.evidence) return '请提供里程碑验收证据，如成果资料编号、测试报告或运行记录。';
  if (!milestone.acceptanceNote) return '请填写验收说明后再确认里程碑完成。';
  return null;
}

export const serializeWorkItem = (row: WorkItemRow): WorkItem => {
  const parsed = row.kind === 'milestone' ? readMilestoneDetail(row.detail) : null;
  return {
    id: row.id, project: row.project, title: row.title, detail: parsed?.detail ?? row.detail, kind: row.kind, status: row.status,
    priority: row.priority, assigneeName: row.assignee_name, assigneeEmail: row.assignee_email, dueAt: row.due_at,
    sourceType: row.source_type, sourceId: row.source_id, createdByName: row.created_by_name,
    createdByEmail: row.created_by_email, completedAt: row.completed_at, createdAt: row.created_at, updatedAt: row.updated_at,
    milestone: parsed?.milestone ?? null,
  };
};

const cleanLine = (value: string) => value.replace(/^\s*(?:[-*•]|\d+[.)、])\s*/u, '').replace(/\s+/gu, ' ').trim();
const actionHeading = /^(?:#{1,6}\s*|\*\*\s*)?(?:行动项|待办(?:事项)?|行动计划|后续(?:安排|计划|工作)|责任分工|下一步)(?:\s*\*\*)?[：:]?\s*$/u;
const anyHeading = /^(?:#{1,6}\s+|\*\*[^*]+\*\*\s*$)/u;

export function extractMeetingActions(markdown: string) {
  const lines = markdown.split(/\r?\n/u);
  let inActions = false;
  const actions: string[] = [];
  for (const raw of lines) {
    const line = raw.trim();
    if (actionHeading.test(line)) { inActions = true; continue; }
    if (inActions && anyHeading.test(line)) break;
    if (!inActions || !/^\s*(?:[-*•]\s+|\d+[.)、]\s*)/u.test(raw)) continue;
    const title = cleanLine(raw);
    if (title && !/^(?:暂无|无|待补充)[。.!！]?$/u.test(title) && title.length <= 240) actions.push(title);
  }
  return [...new Set(actions)].slice(0, 30);
}
