export type AiMemberChatMessage = { id: string; role: 'user' | 'assistant'; content: string; createdAt: string | number; state?: string };
export function aiMemberMessages(value: unknown): AiMemberChatMessage[];
export function readAiMemberEvents(response: Response, onEvent: (event: string, data: Record<string, unknown>) => void, signal?: AbortSignal): Promise<void>;
