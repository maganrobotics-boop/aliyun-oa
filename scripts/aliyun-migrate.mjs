import { createHash } from "node:crypto";
import { mkdir, readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";

const projectRoot = fileURLToPath(new URL("..", import.meta.url));
const migrationsDirectory = path.join(projectRoot, "drizzle");
const databasePath = path.resolve(process.env.OA_SQLITE_PATH?.trim() || path.join(projectRoot, ".aliyun-data", "oa.sqlite"));

await mkdir(path.dirname(databasePath), { recursive: true });
const database = new DatabaseSync(databasePath);
database.exec(`
  PRAGMA foreign_keys = ON;
  PRAGMA journal_mode = WAL;
  PRAGMA synchronous = FULL;
  PRAGMA busy_timeout = 5000;
  CREATE TABLE IF NOT EXISTS d1_migrations (
    id INTEGER PRIMARY KEY NOT NULL,
    name TEXT NOT NULL UNIQUE
  );
  CREATE TABLE IF NOT EXISTS aliyun_migration_hashes (
    name TEXT PRIMARY KEY NOT NULL,
    sha256 TEXT NOT NULL,
    applied_at TEXT NOT NULL
  );
`);

const migrationNames = (await readdir(migrationsDirectory))
  .filter((name) => /^\d{4}_[A-Za-z0-9_]+\.sql$/u.test(name))
  .sort();
const ledger = new Map(database.prepare("SELECT id, name FROM d1_migrations ORDER BY id").all().map((row) => [String(row.name), Number(row.id)]));
const hashes = new Map(database.prepare("SELECT name, sha256 FROM aliyun_migration_hashes").all().map((row) => [String(row.name), String(row.sha256)]));

for (const name of migrationNames) {
  const expectedId = Number(name.slice(0, 4)) + 1;
  const sql = await readFile(path.join(migrationsDirectory, name), "utf8");
  const digest = createHash("sha256").update(sql).digest("hex");
  if (ledger.has(name)) {
    if (ledger.get(name) !== expectedId) throw new Error(`Migration ledger ID mismatch for ${name}`);
    const recordedHash = hashes.get(name);
    if (recordedHash && recordedHash !== digest) throw new Error(`Applied migration changed: ${name}`);
    if (!recordedHash) database.prepare("INSERT INTO aliyun_migration_hashes(name, sha256, applied_at) VALUES (?, ?, ?)").run(name, digest, new Date().toISOString());
    continue;
  }
  const occupied = database.prepare("SELECT name FROM d1_migrations WHERE id = ?").get(expectedId);
  if (occupied) throw new Error(`Migration ledger ID ${expectedId} is already occupied by ${occupied.name}`);
  const statements = sql
    .split(/^\s*-->\s*statement-breakpoint\s*$/gmu)
    .map((statement) => statement.trim())
    .filter(Boolean);
  database.exec("BEGIN IMMEDIATE");
  try {
    for (const statement of statements) database.exec(statement);
    database.prepare("INSERT INTO d1_migrations(id, name) VALUES (?, ?)").run(expectedId, name);
    database.prepare("INSERT INTO aliyun_migration_hashes(name, sha256, applied_at) VALUES (?, ?, ?)").run(name, digest, new Date().toISOString());
    database.exec("COMMIT");
    process.stdout.write(`Applied ${name}\n`);
  } catch (error) {
    try { database.exec("ROLLBACK"); } catch { /* preserve the migration error */ }
    throw error;
  }
}

// The deployed personnel ledger is an optional extension, outside Drizzle's historical chain.
// Upgrade it only where its existing base tables are present; never rewrite that chain.
if (database.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='personnel_weekly_entries'").get()) {
  const name = "personnel-auto-weekly-20261010.sql";
  for (const table of ["expense_events", "expense_ledger_meta", "ai_workbench_tasks", "knowledge_items", "knowledge_revisions", "migration_control"]) {
    if (!database.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(table)) throw new Error(`Personnel weekly prerequisite missing: ${table}`);
  }
  const sql = await readFile(path.join(projectRoot, "migrations", name), "utf8");
  const digest = createHash("sha256").update(sql).digest("hex");
  const old = hashes.get(name);
  if (old && old !== digest) throw new Error(`Applied migration changed: ${name}`);
  if (!old) {
    database.exec("BEGIN IMMEDIATE");
    try {
      database.exec(sql);
      database.prepare("INSERT INTO aliyun_migration_hashes(name,sha256,applied_at) VALUES(?,?,?)").run(name,digest,new Date().toISOString());
      database.exec("COMMIT");
      process.stdout.write(`Applied ${name}\n`);
    } catch(error) { database.exec("ROLLBACK"); throw error; }
  }
}

database.exec("PRAGMA optimize");
database.close();
process.stdout.write(`Aliyun SQLite is current at ${migrationNames.at(-1)}\n`);
