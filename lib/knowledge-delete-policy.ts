export const KNOWLEDGE_DELETE_BATCH_SIZE = 20;
const SAFE_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

export type KnowledgeDeleteInput = { id: string; mutationRevision: string };
export type KnowledgeBatchDeleteResult = {
  deletedIds: string[];
  failed: { id: string; error: string }[];
};

export function parseKnowledgeDeleteItems(value: unknown): KnowledgeDeleteInput[] | null {
  if (!Array.isArray(value) || !value.length || value.length > KNOWLEDGE_DELETE_BATCH_SIZE) return null;
  const ids = new Set<string>();
  const result: KnowledgeDeleteInput[] = [];
  for (const entry of value) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) return null;
    const record = entry as Record<string, unknown>;
    if (Object.keys(record).some(key => key !== "id" && key !== "mutationRevision")
      || typeof record.id !== "string" || !SAFE_ID.test(record.id)
      || typeof record.mutationRevision !== "string" || !record.mutationRevision.trim()
      || record.mutationRevision.length > 128) return null;
    const id = record.id.toLowerCase();
    if (ids.has(id)) return null;
    ids.add(id);
    result.push({ id, mutationRevision: record.mutationRevision });
  }
  return result;
}
