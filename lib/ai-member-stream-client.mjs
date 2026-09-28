/** SQLite stores milliseconds; older JSON transports may serialize an ISO timestamp. */
export function aiMemberMessages(value) {
  return Array.isArray(value) ? value.filter(item => Boolean(item && typeof item.id === 'string' && ['user', 'assistant'].includes(item.role) && typeof item.content === 'string' && (typeof item.createdAt === 'string' || (typeof item.createdAt === 'number' && Number.isFinite(item.createdAt))))) : [];
}

/** Read actual SSE events; never synthesize tokens from a completed JSON reply. */
export async function readAiMemberEvents(response, onEvent, signal) {
  if (!response.body || !response.headers.get('content-type')?.includes('text/event-stream')) throw new Error('服务器未返回流式回答，请刷新记录核对。');
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '', event = 'message', data = [], size = 0;
  const abort = () => { void reader.cancel().catch(() => {}); };
  const dispatch = () => {
    if (data.length) {
      let payload;
      try { payload = JSON.parse(data.join('\n')); } catch { throw new Error('回答数据不完整，请刷新记录核对。'); }
      if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw new Error('回答数据格式异常，请刷新记录核对。');
      if (signal?.aborted) throw new DOMException('已停止', 'AbortError');
      onEvent(event, payload);
      if (signal?.aborted) throw new DOMException('已停止', 'AbortError');
    }
    event = 'message'; data = []; size = 0;
  };
  const line = value => {
    if (!value) { dispatch(); return; }
    if (value.startsWith(':')) return;
    const colon = value.indexOf(':');
    const field = colon < 0 ? value : value.slice(0, colon);
    const raw = colon < 0 ? '' : value.slice(colon + 1);
    const content = raw.startsWith(' ') ? raw.slice(1) : raw;
    if (field === 'event') event = content;
    if (field === 'data') { size += content.length; if (size > 1_048_576) throw new Error('回答过长，请刷新记录核对。'); data.push(content); }
  };
  signal?.addEventListener('abort', abort, { once: true });
  try {
    while (true) {
      if (signal?.aborted) throw new DOMException('已停止', 'AbortError');
      const { value, done } = await reader.read();
      if (signal?.aborted) throw new DOMException('已停止', 'AbortError');
      buffer += decoder.decode(value, { stream: !done });
      let end;
      while ((end = buffer.indexOf('\n')) >= 0) { line(buffer.slice(0, end).replace(/\r$/u, '')); buffer = buffer.slice(end + 1); }
      if (buffer.length > 1_048_576) throw new Error('回答数据过长，请刷新记录核对。');
      if (done) { if (buffer) line(buffer.replace(/\r$/u, '')); dispatch(); break; }
    }
  } finally {
    signal?.removeEventListener('abort', abort);
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
