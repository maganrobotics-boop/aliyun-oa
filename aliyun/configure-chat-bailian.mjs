import { readFile, rm } from "node:fs/promises";
import { NodeD1Database } from "./chat-d1-adapter.mjs";
import { encryptSecret } from "../chat-cloudflare/src/crypto.mjs";

const keyFile = process.env.BAILIAN_KEY_FILE;
const databasePath = process.env.CHAT_SQLITE_PATH;
const encryptionKey = process.env.APP_ENCRYPTION_KEY;
const baseUrl = process.env.BAILIAN_BASE_URL?.trim() || "https://dashscope.aliyuncs.com/compatible-mode/v1";
const model = "qwen-plus";

if (!keyFile || !databasePath || !encryptionKey || encryptionKey.length < 40) {
  throw new Error("Chat configuration environment is incomplete");
}

let apiKey;
try {
  apiKey = (await readFile(keyFile, "utf8")).trim();
} finally {
  await rm(keyFile, { force: true });
}
if (!/^sk-[A-Za-z0-9._-]{16,}$/u.test(apiKey)) throw new Error("百炼 API Key 格式不正确");

const parsedBaseUrl = new URL(baseUrl);
if (parsedBaseUrl.protocol !== "https:"
  || parsedBaseUrl.username
  || parsedBaseUrl.password
  || parsedBaseUrl.search
  || parsedBaseUrl.hash
  || !parsedBaseUrl.hostname.endsWith(".aliyuncs.com")
  || parsedBaseUrl.pathname.replace(/\/+$/u, "") !== "/compatible-mode/v1") {
  throw new Error("BAILIAN_BASE_URL 格式不正确");
}

const response = await fetch(`${baseUrl}/chat/completions`, {
  method: "POST",
  headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
  body: JSON.stringify({
    model,
    messages: [{ role: "user", content: "请只回复：连接成功" }],
    temperature: 0,
    max_tokens: 20,
    enable_thinking: false,
    stream: false,
  }),
  redirect: "manual",
  signal: AbortSignal.timeout(15_000),
});
if (!response.ok) {
  throw new Error(response.status === 401 ? "百炼 API Key 验证失败" : `百炼连接验证失败（HTTP ${response.status}）`);
}
const body = await response.json();
if (typeof body?.choices?.[0]?.message?.content !== "string" || !body.choices[0].message.content.trim()) {
  throw new Error("百炼没有返回有效响应");
}

const database = new NodeD1Database(databasePath);
try {
  const value = {
    baseUrl,
    model,
    encryptedKey: await encryptSecret(apiKey, encryptionKey),
    verifiedAt: new Date().toISOString(),
  };
  await database.prepare("INSERT INTO settings(id,value) VALUES(?,?) ON CONFLICT(id) DO UPDATE SET value=excluded.value")
    .bind("model", JSON.stringify(value)).run();
  console.log(`百炼 ${model} 已验证并安全写入 Chat 配置。`);
} finally {
  database.close();
}
