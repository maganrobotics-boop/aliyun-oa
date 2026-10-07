import { constants } from "node:fs";
import { access, mkdir, open, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";

type StoredMetadata = {
  httpMetadata?: Record<string, string>;
  customMetadata?: Record<string, string>;
  sha256?: string;
};

function safeObjectPath(root: string, key: string): string {
  if (!key || key.includes("\\") || key.startsWith("/") || key.split("/").some((part) => !part || part === "." || part === "..")) {
    throw new Error("Invalid object storage key");
  }
  const base = path.resolve(root);
  const candidate = path.resolve(base, ...key.split("/"));
  if (candidate === base || !candidate.startsWith(`${base}${path.sep}`)) throw new Error("Object storage key escapes its root");
  return candidate;
}

async function exists(file: string): Promise<boolean> {
  try { await access(file, constants.F_OK); return true; } catch { return false; }
}

export class FileSystemR2Bucket {
  private readonly root: string;

  constructor(root: string) { this.root = root; }

  async put(key: string, value: ArrayBuffer | ArrayBufferView, options: {
    onlyIf?: { etagDoesNotMatch?: string };
    httpMetadata?: Record<string, string>;
    customMetadata?: Record<string, string>;
    sha256?: string;
  } = {}) {
    const file = safeObjectPath(this.root, key);
    const metadataFile = `${file}.metadata.json`;
    if (options.onlyIf?.etagDoesNotMatch === "*" && await exists(file)) return null;
    await mkdir(path.dirname(file), { recursive: true });
    const lockFile = `${file}.upload.lock`;
    let lock;
    try {
      lock = await open(lockFile, "wx", 0o600);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "EEXIST") return null;
      throw error;
    }
    const nonce = `${process.pid}-${crypto.randomUUID()}`;
    const temporaryFile = `${file}.${nonce}.tmp`;
    const temporaryMetadata = `${metadataFile}.${nonce}.tmp`;
    try {
      if (options.onlyIf?.etagDoesNotMatch === "*" && await exists(file)) return null;
      const bytes = value instanceof ArrayBuffer
        ? new Uint8Array(value)
        : new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
      const metadata: StoredMetadata = {
        httpMetadata: options.httpMetadata,
        customMetadata: options.customMetadata,
        sha256: options.sha256,
      };
      await writeFile(temporaryFile, bytes, { mode: 0o600 });
      await writeFile(temporaryMetadata, JSON.stringify(metadata), { encoding: "utf8", mode: 0o600 });
      await rename(temporaryFile, file);
      await rename(temporaryMetadata, metadataFile);
      return {
        key,
        size: bytes.byteLength,
        etag: options.sha256 || "",
        uploaded: new Date(),
        httpMetadata: options.httpMetadata,
        customMetadata: options.customMetadata,
      };
    } finally {
      await lock.close();
      await rm(lockFile, { force: true });
      await rm(temporaryFile, { force: true });
      await rm(temporaryMetadata, { force: true });
    }
  }

  async delete(keys: string | string[]): Promise<void> {
    const files = (Array.isArray(keys) ? keys : [keys]).map(key => safeObjectPath(this.root, key));
    for (const file of files) {
      await rm(file, { force: true });
      await rm(file + '.metadata.json', { force: true });
    }
  }

  async get(key: string) {
    const file = safeObjectPath(this.root, key);
    try {
      const [bytes, fileStat, metadataText] = await Promise.all([
        readFile(file),
        stat(file),
        readFile(`${file}.metadata.json`, "utf8").catch(() => "{}"),
      ]);
      const metadata = JSON.parse(metadataText) as StoredMetadata;
      const arrayBuffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
      return {
        key,
        size: fileStat.size,
        etag: metadata.sha256 || "",
        uploaded: fileStat.mtime,
        httpMetadata: metadata.httpMetadata,
        customMetadata: metadata.customMetadata,
        body: new Blob([bytes]).stream(),
        arrayBuffer: async () => arrayBuffer,
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw error;
    }
  }
}

const buckets = new Map<string, FileSystemR2Bucket>();

export function fileSystemBucket(root: string): R2Bucket {
  const resolved = path.resolve(root);
  let bucket = buckets.get(resolved);
  if (!bucket) {
    bucket = new FileSystemR2Bucket(resolved);
    buckets.set(resolved, bucket);
  }
  return bucket as unknown as R2Bucket;
}
