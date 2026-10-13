import { FutureStarsError } from './future-stars-client';

export async function callCloudActivity(params: URLSearchParams): Promise<Record<string, unknown>> {
  const allowed = new Set(['view', 'window', 'kind', 'q', 'sort', 'page']);
  for (const key of params.keys()) {
    if (!allowed.has(key) || params.getAll(key).length !== 1) throw new FutureStarsError('筛选参数不正确。', 400);
  }
  const window = params.get('window') || '24h', kind = params.get('kind') || 'all';
  const sort = params.get('sort') || 'recent', q = (params.get('q') || '').trim(), page = params.get('page') || '1';
  if (!['24h', '3d', '7d'].includes(window) || !['all', 'account', 'guest'].includes(kind) || !['recent', 'visits'].includes(sort) || q.length > 100 || !/^[1-9][0-9]{0,4}$/.test(page)) throw new FutureStarsError('筛选参数不正确。', 400);
  const { env } = await import('cloudflare:workers');
  const token = (env as typeof env & { CLOUD_ACTIVITY_TOKEN?: string }).CLOUD_ACTIVITY_TOKEN || '';
  if (!/^[a-f0-9]{64}$/.test(token)) throw new FutureStarsError('Cloud 上线统计尚未连接。', 503);
  try {
    const response = await fetch('https://cloud.omindos.cn/v1/oa-activity?' + new URLSearchParams({ window, kind, sort, q, page }), {
      headers: { authorization: `Bearer ${token}` }, credentials: 'omit', redirect: 'error', cache: 'no-store', signal: AbortSignal.timeout(10000),
    });
    if (!response.ok || !response.headers.get('content-type')?.startsWith('application/json') || !response.body) throw new Error('Cloud unavailable');
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = []; let size = 0;
    try {
      for (;;) {
        const { value, done } = await reader.read(); if (done) break;
        size += value.length; if (size > 128 * 1024) { await reader.cancel(); throw new Error('Cloud response too large'); }
        chunks.push(value);
      }
    } finally { reader.releaseLock(); }
    const bytes = new Uint8Array(size); let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
    const data = JSON.parse(new TextDecoder().decode(bytes)) as Record<string, unknown>;
    if (data.source !== 'cloud' || !data.summary || !Array.isArray(data.records) || !data.pagination || typeof data.trackingStartedAt !== 'number') throw new Error('Invalid Cloud data');
    return data;
  } catch {
    throw new FutureStarsError('Cloud 上线统计暂不可用，请稍后重试。', 503);
  }
}
