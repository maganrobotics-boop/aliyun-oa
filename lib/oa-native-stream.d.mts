export type OaNativeEvent = { type: 'status'; phase: 'generating' | 'validating' | 'retrying' | 'continuing' } | { type: 'delta'; delta: string } | { type: 'reset' } | { type: 'final'; data: Record<string, unknown> & { answer: string } } | { type: 'error'; code: string };
export function checkStreamAbort(signal?: AbortSignal): void;
export function readSse(response: Response, onData: (data: string) => void | Promise<void>, options?: { signal?: AbortSignal; maximumBytes?: number }): Promise<void>;
export function consumeOaAnswerStream(response: Response, options?: { signal?: AbortSignal; onEvent?: (event: OaNativeEvent) => void | Promise<void> }): Promise<Record<string, unknown> & { answer: string }>;
export function privateAnswerStream(run: (emit: (event: OaNativeEvent) => void, signal: AbortSignal) => Promise<void>, requestSignal?: AbortSignal): Response;
