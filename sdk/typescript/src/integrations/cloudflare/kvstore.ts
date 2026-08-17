import type { CloudflareStorage } from './agentfs.js';

export interface CloudflareKvEntry<T = unknown> {
  key: string;
  value: T;
}

export interface CloudflareKvTransaction {
  set(key: string, value: unknown): void;
  get<T = unknown>(key: string): T | undefined;
  list<T = unknown>(prefix: string): CloudflareKvEntry<T>[];
  delete(key: string): void;
}

function serializeJson(value: unknown): string {
  let serialized: string | undefined;
  try {
    serialized = JSON.stringify(value);
  } catch {
    throw new TypeError('KV values must be JSON-serializable');
  }
  if (serialized === undefined) {
    throw new TypeError('KV values must be JSON-serializable');
  }
  return serialized;
}

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, character => `\\${character}`);
}

/** AgentFS KV storage over the caller's Durable Objects SQLite database. */
export class CloudflareKvStore implements CloudflareKvTransaction {
  private readonly storage: CloudflareStorage;

  constructor(storage: CloudflareStorage) {
    this.storage = storage;
    this.initialize();
  }

  private initialize(): void {
    this.storage.sql.exec(`
      CREATE TABLE IF NOT EXISTS kv_store (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        created_at INTEGER DEFAULT (unixepoch()),
        updated_at INTEGER DEFAULT (unixepoch())
      );
      CREATE INDEX IF NOT EXISTS idx_kv_store_created_at
        ON kv_store(created_at);
    `);
  }

  transactionView(): CloudflareKvTransaction {
    return {
      set: (key, value) => this.setSync(key, value),
      get: <T = unknown>(key: string) => this.get<T>(key),
      list: <T = unknown>(prefix: string) => this.list<T>(prefix),
      delete: key => this.deleteSync(key),
    };
  }

  set(key: string, value: unknown): void {
    this.storage.transactionSync(() => this.setSync(key, value));
  }

  private setSync(key: string, value: unknown): void {
    const serialized = serializeJson(value);
    this.storage.sql.exec(
      `INSERT INTO kv_store (key, value, updated_at)
       VALUES (?, ?, unixepoch())
       ON CONFLICT(key) DO UPDATE SET
         value = excluded.value,
         updated_at = unixepoch()`,
      key,
      serialized,
    );
  }

  get<T = unknown>(key: string): T | undefined {
    const rows = this.storage.sql.exec<{ value: string }>(
      'SELECT value FROM kv_store WHERE key = ?',
      key,
    ).toArray();
    return rows.length === 0 ? undefined : JSON.parse(rows[0].value) as T;
  }

  list<T = unknown>(prefix: string): CloudflareKvEntry<T>[] {
    return this.storage.sql.exec<{ key: string; value: string }>(
      `SELECT key, value FROM kv_store
       WHERE key LIKE ? ESCAPE '\\'
       ORDER BY key`,
      `${escapeLike(prefix)}%`,
    ).toArray().map(row => ({ key: row.key, value: JSON.parse(row.value) as T }));
  }

  delete(key: string): void {
    this.storage.transactionSync(() => this.deleteSync(key));
  }

  private deleteSync(key: string): void {
    this.storage.sql.exec('DELETE FROM kv_store WHERE key = ?', key);
  }
}
