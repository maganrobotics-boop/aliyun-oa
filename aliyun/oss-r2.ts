import OSS from "ali-oss";

type R2PutOptions = {
  onlyIf?: { etagDoesNotMatch?: string };
  httpMetadata?: { contentType?: string };
  customMetadata?: Record<string, string>;
  sha256?: string;
};

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required when OA_OSS_BUCKET is configured`);
  return value;
}

function safeBucket(value: string): string {
  if (!/^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/u.test(value)) throw new Error("OA_OSS_BUCKET is invalid");
  return value;
}

function safeRegion(value: string): string {
  if (!/^oss-[a-z0-9-]+$/u.test(value)) throw new Error("OA_OSS_REGION is invalid");
  return value;
}

function safeEndpoint(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const normalized = value.replace(/^https?:\/\//iu, "").replace(/\/$/u, "");
  if (!/^oss-[a-z0-9-]+(?:-internal)?\.aliyuncs\.com$/u.test(normalized)) throw new Error("OA_OSS_ENDPOINT is invalid");
  return normalized;
}

function errorStatus(error: unknown): number | undefined {
  if (!error || typeof error !== "object") return undefined;
  const candidate = error as { status?: number; statusCode?: number; res?: { status?: number } };
  return candidate.status ?? candidate.statusCode ?? candidate.res?.status;
}

function errorCode(error: unknown): string {
  if (!error || typeof error !== "object") return "";
  const candidate = error as { code?: string; name?: string };
  return candidate.code || candidate.name || "";
}

export class AliyunOssR2Bucket {
  private readonly client: OSS;

  constructor() {
    const region = safeRegion(required("OA_OSS_REGION"));
    this.client = new OSS({
      region,
      endpoint: safeEndpoint(process.env.OA_OSS_ENDPOINT?.trim()),
      bucket: safeBucket(required("OA_OSS_BUCKET")),
      accessKeyId: required("OSS_ACCESS_KEY_ID"),
      accessKeySecret: required("OSS_ACCESS_KEY_SECRET"),
      stsToken: process.env.OSS_STS_TOKEN?.trim() || undefined,
      authorizationV4: true,
      secure: true,
      timeout: 30_000,
    });
  }

  async put(key: string, value: ArrayBuffer | ArrayBufferView, options: R2PutOptions = {}) {
    const bytes = value instanceof ArrayBuffer
      ? Buffer.from(value)
      : Buffer.from(value.buffer, value.byteOffset, value.byteLength);
    const headers: Record<string, string | boolean> = {
      "content-type": options.httpMetadata?.contentType || "application/octet-stream",
      "x-oss-object-acl": "private",
      ...(options.onlyIf?.etagDoesNotMatch === "*" ? { "x-oss-forbid-overwrite": true } : {}),
      ...(options.sha256 ? { "x-oss-meta-sha256": options.sha256 } : {}),
      ...Object.fromEntries(Object.entries(options.customMetadata || {}).map(([name, data]) => [`x-oss-meta-${name.toLowerCase()}`, data])),
    };
    try {
      const result = await this.client.put(key, bytes, { headers });
      return {
        key,
        size: bytes.byteLength,
        etag: String((result.res?.headers as Record<string, unknown> | undefined)?.etag || "").replaceAll('"', ""),
        uploaded: new Date(),
        httpMetadata: options.httpMetadata,
        customMetadata: options.customMetadata,
      };
    } catch (error) {
      if (errorStatus(error) === 409 || errorCode(error) === "FileAlreadyExists") return null;
      throw error;
    }
  }

  async delete(keys: string | string[]): Promise<void> {
    for (const key of Array.isArray(keys) ? keys : [keys]) await this.client.delete(key);
  }

  async get(key: string) {
    try {
      const result = await this.client.get(key);
      const bytes = Buffer.isBuffer(result.content) ? result.content : Buffer.from(result.content);
      const headers = (result.res?.headers || {}) as Record<string, unknown>;
      const contentType = String(headers["content-type"] || "application/octet-stream");
      const uploadToken = String(headers["x-oss-meta-uploadtoken"] || headers["x-oss-meta-upload-token"] || "");
      const sha256 = String(headers["x-oss-meta-sha256"] || "");
      const arrayBuffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
      return {
        key,
        size: bytes.byteLength,
        etag: String(headers.etag || "").replaceAll('"', ""),
        uploaded: headers["last-modified"] ? new Date(String(headers["last-modified"])) : new Date(),
        httpMetadata: { contentType },
        customMetadata: { uploadToken },
        body: new Blob([bytes]).stream(),
        arrayBuffer: async () => arrayBuffer,
        sha256,
      };
    } catch (error) {
      if (errorStatus(error) === 404 || errorCode(error) === "NoSuchKey") return null;
      throw error;
    }
  }
}

let bucket: R2Bucket | undefined;

export function aliyunOssBucket(): R2Bucket {
  bucket ??= new AliyunOssR2Bucket() as unknown as R2Bucket;
  return bucket;
}
