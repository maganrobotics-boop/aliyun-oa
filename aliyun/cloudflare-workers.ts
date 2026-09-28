import path from "node:path";
import { localDocumentAi } from "./local-document-ai.mjs";

import { d1Database } from "./d1-adapter";
import { fileSystemBucket } from "./fs-r2";
import { aliyunOssBucket } from "./oss-r2";

function runtimePath(variable: string, fallback: string): string {
  return path.resolve(process.env[variable]?.trim() || path.join(process.cwd(), ".aliyun-data", fallback));
}

function serviceBinding(origin: string) {
  const targetOrigin = new URL(origin);
  return {
    async fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
      const source = new URL(typeof input === "string" || input instanceof URL ? input : input.url);
      const target = new URL(`${source.pathname}${source.search}`, targetOrigin);
      return fetch(target, init);
    },
  };
}

const values = new Map<PropertyKey, unknown>();

function binding(property: PropertyKey): unknown {
  if (values.has(property)) return values.get(property);
  let value: unknown;
  if (property === "AI") value = localDocumentAi;
  else if (property === "DB") value = d1Database(runtimePath("OA_SQLITE_PATH", "oa.sqlite"));
  else if (property === "WEBSITE_DB") {
    const configured = process.env.OA_WEBSITE_SQLITE_PATH?.trim();
    value = configured ? d1Database(path.resolve(configured)) : undefined;
  } else if (property === "KNOWLEDGE_ASSETS") {
    value = process.env.OA_OSS_BUCKET?.trim()
      ? aliyunOssBucket()
      : fileSystemBucket(runtimePath("OA_ASSETS_PATH", "assets"));
  }
  else if (property === "CHAT_SERVICE") {
    const origin = process.env.OA_CHAT_SERVICE_ORIGIN?.trim();
    value = origin ? serviceBinding(origin) : undefined;
  } else if (typeof property === "string") value = process.env[property];
  values.set(property, value);
  return value;
}

export const env = new Proxy({} as Cloudflare.Env, {
  get(_target, property) { return binding(property); },
  has(_target, property) { return binding(property) !== undefined; },
});
