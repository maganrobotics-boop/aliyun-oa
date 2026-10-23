import type { KnowledgeItem } from './knowledge-types';

export const DEFAULT_KNOWLEDGE_RETURN_NOTE: string;
export type KnowledgeReturnFailure = { id: string; title: string; uncertain: boolean; message: string };
export function returnKnowledgeBatch(items: KnowledgeItem[], note?: string, options?: {
  request?: typeof fetch;
  shouldStop?: () => boolean;
  onProgress?: (progress: { index: number; total: number; title: string }) => void;
  wait?: (ms: number) => Promise<unknown>;
}): Promise<{ succeededIds: string[]; failures: KnowledgeReturnFailure[]; unprocessed: number }>;
