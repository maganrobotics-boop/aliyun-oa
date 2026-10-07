import type { KnowledgeItem, KnowledgeStatus } from "./knowledge-types";

export type KnowledgeStateFilter = "all" | "inactive" | KnowledgeStatus;
export type KnowledgeScopeFilter = "all" | "internal" | "public" | "unassigned";

export const knowledgeStateFilterOptions: ReadonlyArray<{ value: KnowledgeStateFilter; label: string }> = [
  { value: "all", label: "全部状态" },
  { value: "active", label: "已入库知识" },
  { value: "inactive", label: "未入库知识" },
  { value: "pending", label: "待审核" },
  { value: "returned", label: "已退回" },
  { value: "rejected", label: "已拒绝" },
  { value: "revoked", label: "已撤销" },
];

export const knowledgeScopeFilterOptions: ReadonlyArray<{ value: KnowledgeScopeFilter; label: string }> = [
  { value: "all", label: "全部范围" },
  { value: "internal", label: "对内" },
  { value: "public", label: "公开" },
  { value: "unassigned", label: "范围待定" },
];

export function approvedKnowledgeScope(item: KnowledgeItem): Exclude<KnowledgeScopeFilter, "all"> {
  if (item.status !== "active" && item.status !== "revoked") return "unassigned";
  return item.visibility === "public" ? "public" : "internal";
}

export function matchesKnowledgeListFilters(item: KnowledgeItem, state: KnowledgeStateFilter, scope: KnowledgeScopeFilter): boolean {
  const matchesState = state === "all" || (state === "inactive" ? item.status !== "active" : item.status === state);
  return matchesState && (scope === "all" || approvedKnowledgeScope(item) === scope);
}
