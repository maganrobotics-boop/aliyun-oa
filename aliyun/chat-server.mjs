import { createReadStream } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { NodeD1Database } from "./chat-d1-adapter.mjs";
import worker from "../chat-cloudflare/src/index.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const publicRoot = path.join(root, "chat-cloudflare", "public");
const listenHost = process.env.CHAT_HOST || "127.0.0.1";
const listenPort = Number(process.env.CHAT_PORT || 3001);
const appOrigin = new URL(process.env.APP_ORIGIN || "http://127.0.0.1:3001").origin;
const database = new NodeD1Database(process.env.CHAT_SQLITE_PATH || "/var/lib/originmind-chat/chat.sqlite");
const maximumRequestBytes = 11 * 1024 * 1024;

const contentTypes = new Map([
  [".txt", "text/plain; charset=utf-8"],
  [".css", "text/css; charset=utf-8"],
  [".html", "text/html; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".md", "text/markdown; charset=utf-8"],
  [".mjs", "text/javascript; charset=utf-8"],
  [".png", "image/png"],
  [".svg", "image/svg+xml"],
  [".webmanifest", "application/manifest+json"],
  [".webp", "image/webp"],
]);

function safeAssetPath(url) {
  let pathname;
  try { pathname = decodeURIComponent(new URL(url).pathname); } catch { return null; }
  if (pathname.includes("\0") || pathname.split("/").includes("..")) return null;
  const candidate = path.resolve(publicRoot, `.${pathname}`);
  return candidate.startsWith(`${publicRoot}${path.sep}`) ? candidate : null;
}

const assets = {
  async fetch(request) {
    if (!['GET', 'HEAD'].includes(request.method)) return new Response("Method Not Allowed", { status: 405 });
    const filename = safeAssetPath(request.url);
    if (!filename) return new Response("Not Found", { status: 404 });
    try {
      const info = await stat(filename);
      if (!info.isFile()) return new Response("Not Found", { status: 404 });
      const etag = `W/\"${info.size.toString(16)}-${Math.trunc(info.mtimeMs).toString(16)}\"`;
      const headers = {
        "Content-Type": contentTypes.get(path.extname(filename).toLowerCase()) || "application/octet-stream",
        "Content-Length": String(info.size),
        "Last-Modified": info.mtime.toUTCString(),
        ETag: etag,
      };
      if (request.headers.get("if-none-match") === etag) return new Response(null, { status: 304, headers });
      if (request.method === "HEAD") return new Response(null, { status: 200, headers });
      return new Response(await readFile(filename), { status: 200, headers });
    } catch (error) {
      if (error?.code === "ENOENT" || error?.code === "ENOTDIR") return new Response("Not Found", { status: 404 });
      throw error;
    }
  },
};

const oaService = {
  async fetch(request) {
    const target = new URL(request.url);
    target.protocol = "https:";
    target.hostname = "oa.omindos.cn";
    target.port = "";
    const headers = new Headers(request.headers);
    headers.set("host", "oa.omindos.cn");
    headers.set("x-forwarded-host", "oa.omindos.cn");
    headers.set("x-forwarded-proto", "https");
    return fetch(new Request(target, {
      method: request.method,
      headers,
      body: ['GET', 'HEAD'].includes(request.method) ? undefined : request.body,
      duplex: ['GET', 'HEAD'].includes(request.method) ? undefined : "half",
      redirect: "manual",
    }));
  },
};

const env = new Proxy({
  ...process.env,
  APP_ORIGIN: appOrigin,
  DB: database,
  ASSETS: assets,
  OA_SERVICE: oaService,
}, {
  get(target, property) { return target[property]; },
});

async function requestBody(incoming) {
  if (['GET', 'HEAD'].includes(incoming.method || 'GET')) return undefined;
  const pieces = [];
  let total = 0;
  for await (const piece of incoming) {
    total += piece.length;
    if (total > maximumRequestBytes) {
      const error = new Error("Request body too large");
      error.statusCode = 413;
      throw error;
    }
    pieces.push(piece);
  }
  return Buffer.concat(pieces, total);
}

async function webRequest(incoming) {
  const headers = new Headers();
  for (const [name, value] of Object.entries(incoming.headers)) {
    if (Array.isArray(value)) value.forEach((item) => headers.append(name, item));
    else if (value !== undefined) headers.set(name, value);
  }
  if (!headers.has("cf-connecting-ip")) {
    const forwarded = String(headers.get("x-forwarded-for") || "").split(",", 1)[0].trim();
    headers.set("cf-connecting-ip", forwarded || incoming.socket.remoteAddress || "");
  }
  const body = await requestBody(incoming);
  return new Request(new URL(incoming.url || "/", appOrigin), {
    method: incoming.method,
    headers,
    body,
  });
}

async function sendResponse(outgoing, response) {
  const headers = {};
  response.headers.forEach((value, name) => { headers[name] = value; });
  const setCookies = response.headers.getSetCookie?.() || [];
  if (setCookies.length) headers["set-cookie"] = setCookies;
  outgoing.writeHead(response.status, headers);
  if (!response.body) return outgoing.end();
  const reader = response.body.getReader();
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!outgoing.write(Buffer.from(value))) await new Promise((resolve) => outgoing.once("drain", resolve));
    }
    outgoing.end();
  } catch (error) {
    outgoing.destroy(error);
  }
}

const server = http.createServer(async (incoming, outgoing) => {
  const background = [];
  try {
    const request = await webRequest(incoming);
    const response = await worker.fetch(request, env, {
      waitUntil(promise) { background.push(Promise.resolve(promise)); },
      passThroughOnException() {},
    });
    await sendResponse(outgoing, response);
    if (background.length) void Promise.allSettled(background);
  } catch (error) {
    const status = Number(error?.statusCode) || 500;
    console.error("Chat request failed", { status, type: error?.name || "Error" });
    if (!outgoing.headersSent) {
      outgoing.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
      outgoing.end(JSON.stringify({ error: status === 413 ? "请求内容过长" : "服务暂时不可用" }));
    } else {
      outgoing.destroy();
    }
  }
});

server.listen(listenPort, listenHost, () => {
  console.log(`OriginMind Chat listening on http://${listenHost}:${listenPort}`);
});

function shutdown() {
  server.close(() => {
    database.close();
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 10_000).unref();
}
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);

