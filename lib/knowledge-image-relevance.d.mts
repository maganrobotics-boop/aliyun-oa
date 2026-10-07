type ImageChunk = { title: string; sectionTitle?: string; content: string };
export function requestedKnowledgeImageKinds(question: string): string[];
export function knowledgeImageReferenceScore(question: string, chunk: ImageChunk, alt: string, referenceCount?: number): number;
export function relevantKnowledgeImageReferences(question: string, chunk: ImageChunk): Map<string, string>;
export function knowledgeChunkMayShowImages(question: string, chunk: ImageChunk): boolean;
export function rankKnowledgeImageChunks<T extends ImageChunk & { id: string; itemId: string; updatedAt: string }>(
  question: string, candidates: T[], rankText: (question: string, candidates: T[], limit?: number) => Array<T & { score: number }>, limit?: number,
): Array<T & { score: number }>;
