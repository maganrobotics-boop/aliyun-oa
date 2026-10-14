// Exercise the actual admin component with synthetic API responses only.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, extname } from 'node:path';
import { pathToFileURL } from 'node:url';

const { build } = await import(pathToFileURL(process.env.ESBUILD_MODULE).href);
const { chromium } = await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE).href);
const output = resolve(process.env.BROWSER_REPORT_DIR);
await mkdir(output, { recursive: true });
await build({
  stdin: { contents: "import React from 'react';import {createRoot} from 'react-dom/client';import Admin from './app/admin/page.tsx';createRoot(document.getElementById('root')).render(React.createElement(Admin));", resolveDir: process.cwd(), loader: 'jsx' },
  bundle: true, outfile: resolve(output, 'bundle.js'), jsx: 'automatic', nodePaths: [process.env.UI_NODE_MODULES],
  define: { 'process.env.NODE_ENV': '"production"' },
  plugins: [{ name: 'isolated-next-link', setup(builder) {
    builder.onResolve({ filter: /^next\/link$/ }, () => ({ path: 'link', namespace: 'test-link' }));
    builder.onLoad({ filter: /.*/, namespace: 'test-link' }, () => ({ contents: "import React from 'react';export default function Link(props){return React.createElement('a',props)}", loader: 'js', resolveDir: process.cwd() }));
  } }],
});
await writeFile(resolve(output, 'index.html'), '<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/bundle.css"><style>*{box-sizing:border-box}body{margin:0;font-family:Arial,sans-serif}</style><div id="root"></div><script src="/bundle.js"></script></html>');
const server = createServer(async (request, response) => {
  const name = new URL(request.url, 'http://localhost').pathname;
  if (!['/', '/bundle.js', '/bundle.css'].includes(name)) { response.writeHead(404); response.end(); return; }
  response.setHeader('content-type', name === '/' ? 'text/html' : extname(name) === '.css' ? 'text/css' : 'text/javascript');
  response.end(await readFile(resolve(output, name === '/' ? 'index.html' : name.slice(1))));
});
await new Promise(done => server.listen(0, '127.0.0.1', done));
const origin = `http://127.0.0.1:${server.address().port}`;
const portable = process.env.CHROMIUM_MODULE ? (await import(pathToFileURL(process.env.CHROMIUM_MODULE).href)).default : null;
const browserOptions = { headless: true, ...(portable ? { executablePath: process.env.CHROMIUM_EXECUTABLE || await portable.executablePath(), args: portable.args } : {}) };
let browser;
const results = [];
try {
  for (const width of [1280, 390]) {
    browser = await chromium.launch(browserOptions);
    const context = await browser.newContext({ viewport: { width, height: 900 }, serviceWorkers: 'block' });
    const page = await context.newPage();
    const sent = [], errors = [];
    let fail = false;
    const speech = { baseUrl: 'https://maas.qianwenaiapi.com/compatible-mode/v1', model: 'qwen3.8-livetranslate-flash-realtime', keyConfigured: false, verifiedAt: null, testAvailable: true };
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/*', async route => {
      const url = new URL(route.request().url());
      if (url.origin !== origin) return route.abort();
      if (url.pathname !== '/api/admin/control') return route.continue();
      if (route.request().method() === 'GET') return route.fulfill({ json: { initialized: true, signedIn: true, baseUrl: 'https://token-plan.example/compatible-mode/v1', model: 'qwen3.8-max', keyConfigured: true, encryptionReady: true, activeProvider: 'bailian', subtitleProvider: speech } });
      const data = route.request().postDataJSON(); sent.push(data);
      if (fail) return route.fulfill({ status: 503, json: { error: '语音认证失败，原配置已保留。' } });
      if (data.action === 'saveSubtitleConfig') {
        speech.keyConfigured = true; speech.verifiedAt = '2026-10-14T05:00:00Z';
        return route.fulfill({ json: { saved: true, subtitleProvider: speech } });
      }
      if (data.action === 'testSubtitleConfig') return route.fulfill({ json: { connected: true, subtitleProvider: speech } });
      throw new Error('Unexpected request outside the subtitle form');
    });
    await page.goto(origin);
    const card = page.locator('.admin-subtitle-card');
    await card.waitFor();
    assert.equal(await card.getByLabel('语音 API Base URL').inputValue(), speech.baseUrl);
    assert.equal(await card.getByLabel('语音 API Key').getAttribute('type'), 'password');
    assert.equal(await card.getByRole('button', { name: '检测语音连接' }).isDisabled(), true);
    await card.getByLabel('语音 API Key').fill('sk-ws-H.synthetic-browser');
    await card.getByRole('button', { name: '验证并保存语音配置' }).click();
    await page.getByRole('status').filter({ hasText: '实时字幕连接已验证并加密保存' }).waitFor();
    assert.equal(sent.at(-1).action, 'saveSubtitleConfig');
    assert.equal(sent.at(-1).apiKey, 'sk-ws-H.synthetic-browser');
    assert.equal(await card.getByLabel('语音 API Key').inputValue(), '');
    assert.equal(await page.locator('.admin-model-card').getByLabel('模型名称').inputValue(), 'qwen3.8-max');
    await card.getByRole('button', { name: '验证并保存语音配置' }).click();
    await page.getByRole('status').filter({ hasText: '实时字幕连接已验证并加密保存' }).waitFor();
    assert.equal(Object.hasOwn(sent.at(-1), 'apiKey'), false);
    await card.getByRole('button', { name: '检测语音连接' }).click();
    await page.getByRole('status').filter({ hasText: '已保存的语音连接验证通过' }).waitFor();
    assert.equal(sent.at(-1).action, 'testSubtitleConfig');
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    await card.scrollIntoViewIfNeeded();
    await page.screenshot({ path: resolve(output, `admin-${width}.png`), fullPage: true });
    fail = true;
    await card.getByLabel('语音 API Key').fill('sk-ws-H.failed-browser');
    await card.getByRole('button', { name: '验证并保存语音配置' }).click();
    await page.getByRole('alert').filter({ hasText: '原配置已保留' }).waitFor();
    assert.equal(await card.getByLabel('语音 API Key').inputValue(), 'sk-ws-H.failed-browser');
    assert.deepEqual(errors, []);
    results.push({ width, passed: true, apiCalls: sent.length });
    await context.close();
    await browser.close();
  }
} finally { await browser?.close(); await new Promise(done => server.close(done)); }
console.log(JSON.stringify({ syntheticOnly: true, results }));
