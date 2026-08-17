import { DatabaseSync, type SQLInputValue } from 'node:sqlite';

import type { CloudflareStorage } from '../src/integrations/cloudflare/index.js';

interface TestCursor<T> extends Iterable<T> {
  toArray(): T[];
  one(): T;
  raw(): IterableIterator<unknown[]>;
  readonly columnNames: string[];
  readonly rowsRead: number;
  readonly rowsWritten: number;
  next(): { done: boolean; value?: T };
  [Symbol.iterator](): IterableIterator<T>;
}

class ArrayCursor<T> implements TestCursor<T> {
  readonly columnNames: string[] = [];
  readonly rowsWritten = 0;
  private position = 0;

  constructor(private readonly rows: T[]) {}

  get rowsRead(): number {
    return this.rows.length;
  }

  toArray(): T[] {
    return [...this.rows];
  }

  one(): T {
    if (this.rows.length !== 1) {
      throw new Error(`expected one row, received ${this.rows.length}`);
    }
    return this.rows[0];
  }

  *raw(): IterableIterator<unknown[]> {
    for (const row of this.rows) yield Object.values(Object(row));
  }

  next(): { done: boolean; value?: T } {
    if (this.position >= this.rows.length) return { done: true };
    return { done: false, value: this.rows[this.position++] };
  }

  [Symbol.iterator](): IterableIterator<T> {
    return this.rows[Symbol.iterator]();
  }
}

function toSqlInputValue(value: unknown): SQLInputValue {
  if (
    value === null ||
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'bigint' ||
    isSqlArrayBufferView(value)
  ) {
    return value;
  }
  throw new TypeError('unsupported SQLite binding in Cloudflare storage test adapter');
}

function isSqlArrayBufferView(value: unknown): value is NodeJS.ArrayBufferView {
  return ArrayBuffer.isView(value);
}

function queryRows<T>(
  database: DatabaseSync,
  query: string,
  bindings: SQLInputValue[],
): T[];
function queryRows(
  database: DatabaseSync,
  query: string,
  bindings: SQLInputValue[],
): unknown[] {
  return database.prepare(query).all(...bindings);
}

export function cloudflareStorage(database: DatabaseSync): CloudflareStorage {
  return {
    sql: {
      exec<T = Record<string, unknown>>(
        query: string,
        ...bindings: unknown[]
      ): TestCursor<T> {
        if (bindings.length === 0 && query.includes(';')) {
          database.exec(query);
          return new ArrayCursor<T>([]);
        }
        return new ArrayCursor<T>(queryRows<T>(database, query, bindings.map(toSqlInputValue)));
      },
      get databaseSize() {
        return 0;
      },
    },
    transactionSync<T>(callback: () => T): T {
      database.exec('BEGIN IMMEDIATE');
      try {
        const result = callback();
        database.exec('COMMIT');
        return result;
      } catch (error) {
        database.exec('ROLLBACK');
        throw error;
      }
    },
  };
}
