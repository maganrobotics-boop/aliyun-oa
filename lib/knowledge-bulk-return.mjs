export const DEFAULT_KNOWLEDGE_RETURN_NOTE = '请补充或修改后重新提交';

export async function returnKnowledgeBatch(items, note = '', options = {}) {
  const { request = fetch, shouldStop = () => false, onProgress = () => {},
    wait = ms => new Promise(resolve => setTimeout(resolve, ms)) } = options;
  const reason = note.trim() || DEFAULT_KNOWLEDGE_RETURN_NOTE;
  if (reason.length < 2 || reason.length > 1000) throw new Error('退回意见请填写 2 至 1000 个字符。');
  if (!Array.isArray(items) || !items.length || items.length > 1000) throw new Error('请选择需要退回的资料。');
  if (new Set(items.map(item => item.id)).size !== items.length) throw new Error('资料不能重复选择。');
  if (items.some(item => !item.id || !item.mutationRevision?.trim() || item.status !== 'pending' || item.canReview === false || item.canReturn === false)) {
    throw new Error('所选资料状态、权限或版本信息已变化，请刷新后重新选择。');
  }
  const succeededIds = [];
  const failures = [];
  let processed = 0;
  for (const item of items) {
    if (shouldStop()) break;
    onProgress({ index: processed + 1, total: items.length, title: item.title });
    let writing = false;
    let stop = false;
    try {
      const url = `/api/knowledge/${encodeURIComponent(item.id)}`;
      const detailResponse = await request(url, { credentials: 'same-origin', cache: 'no-store',
        headers: { accept: 'application/json' }, signal: AbortSignal.timeout(20000) });
      const detail = await detailResponse.json();
      if (!detailResponse.ok || !detail.item) {
        stop = [401, 403, 429].includes(detailResponse.status);
        throw new Error(detail.error || '资料读取失败');
      }
      const current = detail.item;
      if (current.id !== item.id || current.status !== 'pending' || current.canReview === false || current.canReturn === false) {
        throw new Error('状态或权限已变化，请刷新后核对');
      }
      if (current.mutationRevision !== item.mutationRevision) throw new Error('选中后资料已更新，请重新审核');
      if (shouldStop()) break;
      writing = true;
      const response = await request(url, { method: 'PATCH', credentials: 'same-origin',
        headers: { 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify({ action: 'return', mutationRevision: item.mutationRevision, note: reason }),
        signal: AbortSignal.timeout(20000) });
      const result = await response.json().catch(() => null);
      if (response.ok && result?.item?.id === item.id && result.item.status === 'returned') {
        succeededIds.push(item.id);
      } else {
        const uncertain = response.ok || response.status >= 500;
        failures.push({ id: item.id, title: item.title, uncertain,
          message: result?.error || '未能确认退回结果，请刷新核对。' });
        stop = uncertain || [401, 403, 429].includes(response.status);
      }
    } catch (error) {
      failures.push({ id: item.id, title: item.title, uncertain: writing,
        message: writing ? '连接中断，退回结果待核对，请刷新查看。' : error instanceof Error ? error.message : '资料读取失败' });
      if (writing) stop = true;
    }
    processed += 1;
    if (stop) break;
    // The existing knowledge-review API allows 20 writes per minute.
    if (processed < items.length && !shouldStop()) await wait(3200);
  }
  return { succeededIds, failures, unprocessed: items.length - processed };
}
