import { OA_CHAT_PATH, signOaChatRequest } from "../chat-cloudflare/src/oa-chat-bridge.mjs";

const origin = process.env.OA_CHAT_SERVICE_ORIGIN;
const secret = process.env.PUBLIC_LAB_AI_SERVICE_TOKEN;
if (!origin || !secret) throw new Error("OA Chat bridge configuration is incomplete");
const body = JSON.stringify({ operation: "status" });
const response = await fetch(new URL(OA_CHAT_PATH, origin), {
  method: "POST",
  headers: await signOaChatRequest(body, secret),
  body,
  redirect: "manual",
  signal: AbortSignal.timeout(12_000),
});
if (!response.ok) throw new Error(`OA Chat bridge returned HTTP ${response.status}`);
const value = await response.json();
if (value?.received !== true) throw new Error("OA Chat bridge returned an invalid response");
console.log(JSON.stringify({
  bridgeReady: value.bridgeReady === true,
  modelReady: value.modelReady === true,
  budgetReady: value.budgetReady === true,
}));

