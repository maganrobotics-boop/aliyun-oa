import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import { readFile } from 'node:fs/promises';
import { createIntegration, isAiMemberPath, incomingAiRequest, sendAiResponse, requestCancellation } from './ai-members/integration.mjs';
process.env.NODE_ENV = 'production';
const { default: next } = await import('next');

process.env.OA_RUNTIME = 'aliyun';
const root = fileURLToPath(new URL('../', import.meta.url));
const publicOrigin = new URL(process.env.OA_PUBLIC_ORIGIN || '');
if (publicOrigin.href !== 'https://oa.omindos.cn/') throw new Error('Unexpected OA_PUBLIC_ORIGIN');
const listenPort = Number(process.env.PORT || 3000);
if (!Number.isInteger(listenPort) || listenPort < 1024 || listenPort > 65535) throw new Error('Invalid PORT');
// Isolated AI member data only. Existing OA identity, data and routes stay in Next.
let aiMembers = null;
try {
  const snapshot = JSON.parse(await readFile(new URL('./ai-members/courses.json', import.meta.url), 'utf8'));
  aiMembers = createIntegration({
    audience: 'oa', databasePath: '/var/lib/originmind-ai-members/ai-members.sqlite', origin: publicOrigin.origin,
    courses: snapshot.courses, courseVersion: snapshot.courseVersion, port: listenPort,
  });
} catch { console.error('AI member integration unavailable; existing OA routes remain available'); }
const app = next({ dev: false, dir: root, hostname: publicOrigin.hostname, port: 443 });
await app.prepare();
const handle = app.getRequestHandler();
const server = createServer(async (req, res) => {
  if (typeof req.url !== 'string' || !req.url.startsWith('/') || req.url.startsWith('//') || req.url.includes('\\')) {
    res.writeHead(400); res.end('Invalid request target'); return;
  }
  const trustedHost = ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req.socket.remoteAddress)
    && req.headers.host === publicOrigin.host
    && req.headers['x-forwarded-host'] === publicOrigin.host;
  if (trustedHost && req.headers['x-forwarded-proto'] === 'http' && ['GET', 'HEAD'].includes(req.method)) {
    const target = new URL(req.url, publicOrigin);
    res.writeHead(308, { location: publicOrigin.origin + target.pathname + target.search, 'cache-control': 'no-store' });
    res.end();
    return;
  }
  if (!trustedHost || req.headers['x-forwarded-proto'] !== 'https') {
    res.writeHead(421, { 'cache-control': 'no-store' });
    res.end('Invalid proxy origin');
    return;
  }
  if (isAiMemberPath(req.url)) {
    const lifecycle = requestCancellation(req, res);
    try {
      if (!aiMembers) {
        res.writeHead(503, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
        res.end(JSON.stringify({ error: 'AI 成员服务尚未就绪' }));
        return;
      }
      const request = await incomingAiRequest(req, publicOrigin.origin, { signal: lifecycle.signal });
      const response = await aiMembers.handle(request, { peer: req.socket.remoteAddress || 'unknown-peer' });
      await sendAiResponse(res, response || Response.json({ error: 'AI 接口不存在' }, { status: 404 }));
    } catch (error) {
      if (!res.headersSent) {
        const status = error?.statusCode === 413 ? 413 : 503;
        res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
        res.end(JSON.stringify({ error: status === 413 ? '请求内容过长' : 'AI 成员服务暂时不可用' }));
      } else { res.destroy(); }
      console.error('AI member OA request failed');
    } finally { lifecycle.cleanup(); }
    return;
  }
  try { await handle(req, res); }
  catch {
    if (!res.headersSent) res.writeHead(500);
    res.end();
    console.error('OA request failed');
  }
});
server.on('error', () => { console.error('OA listener failed'); process.exit(1); });
let stopping = false;
const shutdown = () => {
  if (stopping) return;
  stopping = true;
  const timeout = setTimeout(() => { server.closeAllConnections(); process.exit(1); }, 90000);
  timeout.unref();
  server.close(async () => {
    try { aiMembers?.store.close(); } catch { console.error('AI store close failed'); }
    try { await app.close(); clearTimeout(timeout); process.exit(0); }
    catch { process.exit(1); }
  });
};
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
server.listen(listenPort, '127.0.0.1', () => console.log('OA proxy-aware server ready'));
