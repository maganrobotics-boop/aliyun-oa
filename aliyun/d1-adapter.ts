import { mkdirSync } from "node:fs";
import path from "node:path";
import { DatabaseSync, type StatementSync } from "node:sqlite";

type BoundValue = string | number | bigint | null | ArrayBuffer | ArrayBufferView | boolean;
type D1Meta = {
  changes: number;
  duration: number;
  last_row_id: number;
  rows_read: number;
  rows_written: number;
};

type D1CompatResult<T = Record<string, unknown>> = {
  success: true;
  results: T[];
  meta: D1Meta;
};

function normalizeValue(value: BoundValue): string | number | bigint | null | Uint8Array {
  if (typeof value === "boolean") return value ? 1 : 0;
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  if (ArrayBuffer.isView(value)) return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  return value;
}

function numeric(value: number | bigint | undefined): number {
  if (typeof value === "bigint") {
    if (value > BigInt(Number.MAX_SAFE_INTEGER) || value < BigInt(Number.MIN_SAFE_INTEGER)) {
      throw new RangeError("SQLite integer exceeds JavaScript's safe integer range");
    }
    return Number(value);
  }
  return value ?? 0;
}

function elapsed(start: number): number {
  return Math.max(0, performance.now() - start);
}

function isReadOnlySql(sql: string): boolean {
  const normalized = sql
    .replace(/^\s*(?:(?:--[^\r\n]*(?:\r?\n|$))|(?:\/\*[\s\S]*?\*\/\s*))*/u, "")
    .trimStart();
  if (/^(?:SELECT|PRAGMA|EXPLAIN)\b/iu.test(normalized)) return true;
  // SQLite SELECT queries may begin with a common-table expression. The
  // application only uses read-only CTEs; keep mutation CTEs classified as
  // writes so D1-compatible metadata remains conservative.
  return /^WITH\b/iu.test(normalized) && !/\b(?:INSERT|UPDATE|DELETE|REPLACE)\b/iu.test(normalized);
}

class NodeD1PreparedStatement {
  private readonly owner: NodeD1Database;
  readonly sql: string;
  readonly values: BoundValue[];

  constructor(
    owner: NodeD1Database,
    sql: string,
    values: BoundValue[] = [],
  ) {
    this.owner = owner;
    this.sql = sql;
    this.values = values;
  }

  bind(...values: BoundValue[]): NodeD1PreparedStatement {
    return new NodeD1PreparedStatement(this.owner, this.sql, values);
  }

  private statement(): StatementSync {
    return this.owner.sqlite.prepare(this.sql);
  }

  private parameters(): Array<string | number | bigint | null | Uint8Array> {
    return this.values.map(normalizeValue);
  }

  async first<T = Record<string, unknown>>(column?: string): Promise<T | null> {
    const row = this.statement().get(...this.parameters()) as Record<string, unknown> | undefined;
    if (!row) return null;
    return (column === undefined ? row : row[column]) as T;
  }

  async all<T = Record<string, unknown>>(): Promise<D1CompatResult<T>> {
    return this.execute<T>();
  }

  async run<T = Record<string, unknown>>(): Promise<D1CompatResult<T>> {
    return this.execute<T>();
  }

  async raw<T = unknown[]>(options?: { columnNames?: boolean }): Promise<T[]> {
    const statement = this.statement();
    const rows = statement.all(...this.parameters()) as Record<string, unknown>[];
    const columns = Object.keys(rows[0] || {});
    const values = rows.map((row) => columns.map((column) => row[column])) as T[];
    return options?.columnNames ? ([columns, ...values] as T[]) : values;
  }

  execute<T = Record<string, unknown>>(): D1CompatResult<T> {
    const started = performance.now();
    const statement = this.statement();
    const parameters = this.parameters();
    // StatementSync.columns() was added after Node 22.13. `all()` also executes
    // non-row statements on 22.13 and returns an empty array, so it gives one
    // compatible path for SELECT and DML (including RETURNING).
    const results = statement.all(...parameters) as T[];
    const readOnly = isReadOnlySql(this.sql);
    const mutation = readOnly ? { changes: 0, lastInsertRowid: 0 } : this.owner.mutationState();
    const changes = numeric(mutation.changes);
    return {
      success: true,
      results,
      meta: {
        changes,
        duration: elapsed(started),
        last_row_id: numeric(mutation.lastInsertRowid),
        rows_read: readOnly ? results.length : 0,
        rows_written: changes,
      },
    };
  }
}

export class NodeD1Database {
  readonly sqlite: DatabaseSync;

  constructor(databasePath: string) {
    const resolved = path.resolve(databasePath);
    mkdirSync(path.dirname(resolved), { recursive: true });
    this.sqlite = new DatabaseSync(resolved);
    this.sqlite.exec("PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL; PRAGMA busy_timeout = 5000;");
  }

  prepare(sql: string): NodeD1PreparedStatement {
    return new NodeD1PreparedStatement(this, sql);
  }

  mutationState(): { changes: number | bigint; lastInsertRowid: number | bigint } {
    const row = this.sqlite.prepare("SELECT changes() AS changes, last_insert_rowid() AS lastInsertRowid").get() as {
      changes: number | bigint;
      lastInsertRowid: number | bigint;
    };
    return row;
  }

  async batch<T = Record<string, unknown>>(statements: NodeD1PreparedStatement[]): Promise<D1CompatResult<T>[]> {
    this.sqlite.exec("BEGIN IMMEDIATE");
    try {
      const results = statements.map((statement) => statement.execute<T>());
      this.sqlite.exec("COMMIT");
      return results;
    } catch (error) {
      try { this.sqlite.exec("ROLLBACK"); } catch { /* preserve the original failure */ }
      throw error;
    }
  }

  async exec(sql: string): Promise<{ count: number; duration: number }> {
    const started = performance.now();
    this.sqlite.exec(sql);
    return { count: 1, duration: elapsed(started) };
  }
}

const databases = new Map<string, NodeD1Database>();

export function d1Database(databasePath: string): D1Database {
  const resolved = path.resolve(databasePath);
  let database = databases.get(resolved);
  if (!database) {
    database = new NodeD1Database(resolved);
    databases.set(resolved, database);
  }
  return database as unknown as D1Database;
}
