/** Private OA streaming transport. No storage, navigation, HTML, or model reasoning. */
const enc = new TextEncoder();
const abortError = () => new DOMException('Request cancelled', 'AbortError');
export function checkStreamAbort(signal) { if (signal?.aborted) throw abortError(); }

/** Strict bounded SSE parser shared by the private bridge and its browser client. */
export async function readSse(response, onData, { signal, maximumBytes = 512 * 1024 } = {}) {
  if (!response.ok || !response.body || response.headers.get('content-type')?.split(';', 1)[0].trim() !== 'text/event-stream') {
    await response.body?.cancel().catch(() => {});
    throw new Error('OA_STREAM_RESPONSE_INVALID');
  }
  const reader = response.body.getReader(), decoder = new TextDecoder('utf-8', { fatal: true });
  let buffer = '', bytes = 0;
  const cancel = () => { void reader.cancel().catch(() => {}); };
  signal?.addEventListener('abort', cancel, { once: true });
  try {
    checkStreamAbort(signal);
    for (;;) {
      const { value, done } = await reader.read();
      checkStreamAbort(signal);
      if (done) break;
      bytes += value.byteLength;
      if (bytes > maximumBytes) throw new Error('OA_STREAM_LIMIT');
      buffer += decoder.decode(value, { stream: true });
      let boundary;
      while ((boundary = /\r?\n\r?\n/u.exec(buffer))) {
        const frame = buffer.slice(0, boundary.index);
        buffer = buffer.slice(boundary.index + boundary[0].length);
        const data = frame.split(/\r?\n/u).filter(line => line.startsWith('data:')).map(line => line.slice(5).replace(/^ /u, '')).join('\n');
        if (data) await onData(data);
        checkStreamAbort(signal);
      }
      if (buffer.length > 128 * 1024) throw new Error('OA_STREAM_FRAME_LIMIT');
    }
    buffer += decoder.decode();
    if (buffer.trim()) throw new Error('OA_STREAM_INCOMPLETE_FRAME');
    checkStreamAbort(signal);
  } finally {
    signal?.removeEventListener('abort', cancel);
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

export async function consumeOaAnswerStream(response, { signal, onEvent = () => {} } = {}) {
  let final = null, draft = '';
  await readSse(response, async data => {
    const event = JSON.parse(data);
    if (!event || typeof event !== 'object' || Array.isArray(event) || final) throw new Error('OA_STREAM_PROTOCOL');
    if (event.type === 'status') {
      if (!['generating', 'validating', 'retrying', 'continuing'].includes(event.phase)) throw new Error('OA_STREAM_PROTOCOL');
    } else if (event.type === 'delta') {
      if (typeof event.delta !== 'string' || !event.delta.isWellFormed() || draft.length + event.delta.length > 12000) throw new Error('OA_STREAM_LIMIT');
      draft += event.delta;
    } else if (event.type === 'reset') { draft = ''; }
    else if (event.type === 'final') {
      // OA adds a trusted source label to a general answer after the private
      // bridge has enforced its original 12,000-character content bound.
      if (!event.data || typeof event.data.answer !== 'string' || !event.data.answer.trim() || event.data.answer.length > 13000 || !event.data.answer.isWellFormed()) throw new Error('OA_STREAM_FINAL_INVALID');
      final = event.data;
    } else if (event.type === 'error') { throw new Error('OA_STREAM_FAILED'); }
    else throw new Error('OA_STREAM_PROTOCOL');
    await onEvent(event);
  }, { signal });
  if (!final) throw new Error('OA_STREAM_INTERRUPTED');
  return final;
}

/** run must emit exactly one final result after all authorization/validation. */
export function privateAnswerStream(run, requestSignal) {
  const cancel = new AbortController();
  const signal = requestSignal ? AbortSignal.any([cancel.signal, requestSignal]) : cancel.signal;
  let closed = false;
  return new Response(new ReadableStream({
    start(controller) {
      const emit = event => {
        checkStreamAbort(signal);
        if (closed) throw abortError();
        controller.enqueue(enc.encode(`data: ${JSON.stringify(event)}\n\n`));
      };
      const heartbeat = setInterval(() => {
        if (!closed && !signal.aborted) controller.enqueue(enc.encode(': keepalive\n\n'));
      }, 15000);
      void (async () => {
        try { await run(emit, signal); }
        catch {
          if (!signal.aborted && !closed) {
            emit({ type: 'reset' });
            emit({ type: 'error', code: 'OA_STREAM_FAILED' });
          }
        } finally {
          clearInterval(heartbeat);
          if (!closed) { closed = true; controller.close(); }
        }
      })();
    },
    cancel() { closed = true; cancel.abort(); },
  }), { headers: {
    'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'private, no-store, no-transform',
    'x-content-type-options': 'nosniff', 'x-accel-buffering': 'no', 'referrer-policy': 'no-referrer',
  } });
}
