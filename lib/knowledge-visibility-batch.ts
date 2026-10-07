import { isPublicKnowledgeConfirmation } from "./knowledge-policy";
import type { KnowledgeItem, KnowledgeVisibility } from "./knowledge-types";

export const KNOWLEDGE_VISIBILITY_BATCH_SIZE = 20;
const SAFE_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
export type KnowledgeVisibilityInput = { id: string; mutationRevision: string };
export type KnowledgeVisibilityUpdate = {
  id: string; visibility: KnowledgeVisibility; mutationRevision: string; updatedAt: string;
};
export type KnowledgeBatchVisibilityResult = {
  changed: KnowledgeVisibilityUpdate[];
  failed: { id: string; error: string }[];
  stopped?: boolean;
};
export type KnowledgeBatchVisibilityRequest = {
  items: KnowledgeVisibilityInput[]; visibility: KnowledgeVisibility; publicConfirmation?: string;
};

export function parseKnowledgeBatchVisibility(value: Record<string, unknown>): KnowledgeBatchVisibilityRequest | null {
  if (Object.keys(value).some(key => !["items", "visibility", "publicConfirmation"].includes(key))) return null;
  if (value.visibility !== "internal" && value.visibility !== "public") return null;
  if (value.visibility === "public" && !isPublicKnowledgeConfirmation(value.publicConfirmation)) return null;
  if (value.visibility === "internal" && Object.hasOwn(value, "publicConfirmation")) return null;
  if (!Array.isArray(value.items) || !value.items.length || value.items.length > KNOWLEDGE_VISIBILITY_BATCH_SIZE) return null;
  const ids = new Set<string>();
  const items: KnowledgeVisibilityInput[] = [];
  for (const entry of value.items) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) return null;
    const row = entry as Record<string, unknown>;
    if (Object.keys(row).some(key => key !== "id" && key !== "mutationRevision")
      || typeof row.id !== "string" || !SAFE_ID.test(row.id)
      || typeof row.mutationRevision !== "string" || !row.mutationRevision.trim()
      || row.mutationRevision.length > 128) return null;
    const id = row.id.toLowerCase();
    if (ids.has(id)) return null;
    ids.add(id); items.push({ id, mutationRevision: row.mutationRevision });
  }
  return { items, visibility: value.visibility,
    ...(value.visibility === "public" ? { publicConfirmation: value.publicConfirmation as string } : {}) };
}

export function canBatchSetKnowledgeVisibility(item: KnowledgeItem, target: KnowledgeVisibility): boolean {
  return item.status === "active" && item.canSetVisibility === true
    && (item.visibility === "internal" || item.visibility === "public") && item.visibility !== target
    && Boolean(item.currentRevisionId) && item.activeRevisionId === item.currentRevisionId
    && Boolean(item.mutationRevision?.trim());
}
