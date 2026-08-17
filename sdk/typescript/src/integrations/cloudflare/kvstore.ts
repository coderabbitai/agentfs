import type { CloudflareStorage } from './agentfs.js';
import { parseStoredJson, serializeJson } from './json.js';

export interface CloudflareKvEntry<T = unknown> {
  key: string;
  value: T;
}

export interface CloudflareKvTransaction {
  set(key: string, value: unknown): void;
  get(key: string): unknown | undefined;
  list(prefix: string): CloudflareKvEntry[];
  delete(key: string): void;
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

  transactionView(assertOpen: () => void = () => undefined): CloudflareKvTransaction {
    return {
      set: (key, value) => {
        assertOpen();
        this.setSync(key, value);
      },
      get: key => {
        assertOpen();
        return this.get(key);
      },
      list: prefix => {
        assertOpen();
        return this.list(prefix);
      },
      delete: key => {
        assertOpen();
        this.deleteSync(key);
      },
    };
  }

  set(key: string, value: unknown): void {
    this.storage.transactionSync(() => this.setSync(key, value));
  }

  private setSync(key: string, value: unknown): void {
    const serialized = serializeJson('KV values', value);
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

  get(key: string): unknown | undefined {
    const rows = this.storage.sql.exec<{ value: string }>(
      'SELECT value FROM kv_store WHERE key = ?',
      key,
    ).toArray();
    return rows.length === 0
      ? undefined
      : parseStoredJson(`stored KV value for ${key}`, rows[0].value);
  }

  list(prefix: string): CloudflareKvEntry[] {
    return this.storage.sql.exec<{ key: string; value: string }>(
      `SELECT key, value FROM kv_store
       WHERE key LIKE ? ESCAPE '\\'
       ORDER BY key`,
      `${escapeLike(prefix)}%`,
    ).toArray().map(row => ({
      key: row.key,
      value: parseStoredJson(`stored KV value for ${row.key}`, row.value),
    }));
  }

  delete(key: string): void {
    this.storage.transactionSync(() => this.deleteSync(key));
  }

  private deleteSync(key: string): void {
    this.storage.sql.exec('DELETE FROM kv_store WHERE key = ?', key);
  }
}
