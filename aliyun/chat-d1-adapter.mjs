import { mkdirSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

function normalizeValue(value) {
  if (typeof value === "boolean") return value ? 1 : 0;
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  if (ArrayBuffer.isView(value)) return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  return value;
}

function numeric(value) {
  if (typeof value === "bigint") {
    if (value > BigInt(Number.MAX_SAFE_INTEGER) || value < BigInt(Number.MIN_SAFE_INTEGER)) {
      throw new RangeError("SQLite integer exceeds JavaScript's safe integer range");
    }
    return Number(value);
  }
  return value ?? 0;
}

function isReadOnlySql(sql) {
  const normalized = sql
    .replace(/^\s*(?:(?:--[^\r\n]*(?:\r?\n|$))|(?:\/\*[\s\S]*?\*\/\s*))*/u, "")
    .trimStart();
  if (/^(?:SELECT|PRAGMA|EXPLAIN)\b/iu.test(normalized)) return true;
  return /^WITH\b/iu.test(normalized) && !/\b(?:INSERT|UPDATE|DELETE|REPLACE)\b/iu.test(normalized);
}

class NodeD1PreparedStatement {
  constructor(owner, sql, values = []) {
    this.owner = owner;
    this.sql = sql;
    this.values = values;
  }

  bind(...values) {
    return new NodeD1PreparedStatement(this.owner, this.sql, values);
  }

  statement() {
    return this.owner.sqlite.prepare(this.sql);
  }

  parameters() {
    return this.values.map(normalizeValue);
  }

  async first(column) {
    const row = this.statement().get(...this.parameters());
    if (!row) return null;
    return column === undefined ? row : row[column];
  }

  async all() {
    return this.execute();
  }

  async run() {
    return this.execute();
  }

  async raw(options) {
    const rows = this.statement().all(...this.parameters());
    const columns = Object.keys(rows[0] || {});
    const values = rows.map((row) => columns.map((column) => row[column]));
    return options?.columnNames ? [columns, ...values] : values;
  }

  execute() {
    const started = performance.now();
    const results = this.statement().all(...this.parameters());
    const readOnly = isReadOnlySql(this.sql);
    const mutation = readOnly ? { changes: 0, lastInsertRowid: 0 } : this.owner.mutationState();
    const changes = numeric(mutation.changes);
    return {
      success: true,
      results,
      meta: {
        changes,
        duration: Math.max(0, performance.now() - started),
        last_row_id: numeric(mutation.lastInsertRowid),
        rows_read: readOnly ? results.length : 0,
        rows_written: changes,
      },
    };
  }
}

export class NodeD1Database {
  constructor(databasePath) {
    const resolved = path.resolve(databasePath);
    mkdirSync(path.dirname(resolved), { recursive: true });
    this.sqlite = new DatabaseSync(resolved);
    this.sqlite.exec("PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL; PRAGMA busy_timeout = 5000;");
  }

  prepare(sql) {
    return new NodeD1PreparedStatement(this, sql);
  }

  mutationState() {
    return this.sqlite.prepare("SELECT changes() AS changes, last_insert_rowid() AS lastInsertRowid").get();
  }

  async batch(statements) {
    this.sqlite.exec("BEGIN IMMEDIATE");
    try {
      const results = statements.map((statement) => statement.execute());
      this.sqlite.exec("COMMIT");
      return results;
    } catch (error) {
      try { this.sqlite.exec("ROLLBACK"); } catch { /* preserve the original error */ }
      throw error;
    }
  }

  async exec(sql) {
    const started = performance.now();
    this.sqlite.exec(sql);
    return { count: 1, duration: Math.max(0, performance.now() - started) };
  }

  close() {
    this.sqlite.close();
  }
}

