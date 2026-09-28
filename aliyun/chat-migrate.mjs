import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { NodeD1Database } from "./chat-d1-adapter.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const migrationRoot = path.join(root, "chat-cloudflare", "migrations");
const databasePath = process.env.CHAT_SQLITE_PATH || "/var/lib/originmind-chat/chat.sqlite";
const database = new NodeD1Database(databasePath);

database.sqlite.exec(`
  CREATE TABLE IF NOT EXISTS chat_migrations (
    name TEXT PRIMARY KEY NOT NULL,
    sha256 TEXT NOT NULL,
    applied_at TEXT NOT NULL
  )
`);

try {
  const files = (await readdir(migrationRoot)).filter((name) => name.endsWith(".sql")).sort();
  for (const name of files) {
    const sql = await readFile(path.join(migrationRoot, name), "utf8");
    const sha256 = createHash("sha256").update(sql).digest("hex");
    const applied = database.sqlite.prepare("SELECT sha256 FROM chat_migrations WHERE name=?").get(name);
    if (applied) {
      if (applied.sha256 !== sha256) throw new Error(`Applied Chat migration changed: ${name}`);
      continue;
    }
    database.sqlite.exec("BEGIN IMMEDIATE");
    try {
      database.sqlite.exec(sql);
      database.sqlite.prepare("INSERT INTO chat_migrations(name,sha256,applied_at) VALUES(?,?,?)")
        .run(name, sha256, new Date().toISOString());
      database.sqlite.exec("COMMIT");
      console.log(`Applied Chat migration ${name}`);
    } catch (error) {
      try { database.sqlite.exec("ROLLBACK"); } catch { /* preserve the original error */ }
      throw error;
    }
  }
  const integrity = database.sqlite.prepare("PRAGMA integrity_check").get();
  if (integrity.integrity_check !== "ok") throw new Error("Chat SQLite integrity check failed");
  console.log(`Chat database is ready (${files.length} migrations)`);
} finally {
  database.close();
}

