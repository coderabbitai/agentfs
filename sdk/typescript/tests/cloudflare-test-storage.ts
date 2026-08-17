import { DatabaseSync, type SQLInputValue } from 'node:sqlite';

import type { CloudflareStorage } from '../src/integrations/cloudflare/index.js';

interface TestCursorNextResult<T> {
  readonly done: boolean;
  readonly value?: T;
}

interface TestCursor<T> extends Iterable<T> {
  toArray(): T[];
  one(): T;
  raw(): IterableIterator<unknown[]>;
  readonly columnNames: string[];
  readonly rowsRead: number;
  readonly rowsWritten: number;
  next(): TestCursorNextResult<T>;
  [Symbol.iterator](): IterableIterator<T>;
}

class ArrayCursor<T> implements TestCursor<T> {
  readonly columnNames: string[] = [];
  private position = 0;

  constructor(
    private readonly rows: T[],
    readonly rowsWritten = 0,
  ) {}

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

  next(): TestCursorNextResult<T> {
    if (this.position >= this.rows.length) return { done: true };
    return { done: false, value: this.rows[this.position++] };
  }

  *[Symbol.iterator](): IterableIterator<T> {
    while (this.position < this.rows.length) {
      yield this.rows[this.position++];
    }
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

interface QueryResult<T> {
  readonly rows: T[];
  readonly rowsWritten: number;
}

function queryRows<T>(
  database: DatabaseSync,
  query: string,
  bindings: SQLInputValue[],
): QueryResult<T>;
function queryRows(
  database: DatabaseSync,
  query: string,
  bindings: SQLInputValue[],
): QueryResult<unknown> {
  const statement = database.prepare(query);
  const writesRows = /^\s*(INSERT|UPDATE|DELETE)\b/i.test(query);
  const returnsRows = /\bRETURNING\b/i.test(query);
  if (writesRows && !returnsRows) {
    const result = statement.run(...bindings);
    return { rows: [], rowsWritten: Number(result.changes) };
  }
  return { rows: statement.all(...bindings), rowsWritten: 0 };
}

function hasMultipleSqlStatements(query: string): boolean {
  let statements = 0;
  let hasToken = false;
  let quote: "'" | '"' | '`' | ']' | undefined;
  let lineComment = false;
  let blockComment = false;

  for (let index = 0; index < query.length; index++) {
    const character = query[index];
    const next = query[index + 1];
    if (lineComment) {
      if (character === '\n') lineComment = false;
      continue;
    }
    if (blockComment) {
      if (character === '*' && next === '/') {
        blockComment = false;
        index++;
      }
      continue;
    }
    if (quote !== undefined) {
      const closes = character === quote || (quote === ']' && character === ']');
      if (closes) {
        if (next === character && quote !== ']') index++;
        else quote = undefined;
      }
      continue;
    }
    if (character === '-' && next === '-') {
      lineComment = true;
      index++;
      continue;
    }
    if (character === '/' && next === '*') {
      blockComment = true;
      index++;
      continue;
    }
    if (character === "'" || character === '"' || character === '`' || character === '[') {
      quote = character === '[' ? ']' : character;
      hasToken = true;
      continue;
    }
    if (character === ';') {
      if (hasToken) statements++;
      hasToken = false;
      continue;
    }
    if (!/\s/.test(character)) hasToken = true;
  }
  if (hasToken) statements++;
  return statements > 1;
}

export function cloudflareStorage(database: DatabaseSync): CloudflareStorage {
  return {
    sql: {
      exec<T = Record<string, unknown>>(
        query: string,
        ...bindings: unknown[]
      ): TestCursor<T> {
        if (bindings.length === 0 && hasMultipleSqlStatements(query)) {
          database.exec(query);
          const changes = queryRows<{ readonly count: number }>(
            database,
            'SELECT changes() AS count',
            [],
          ).rows[0]?.count ?? 0;
          return new ArrayCursor<T>([], changes);
        }
        const result = queryRows<T>(database, query, bindings.map(toSqlInputValue));
        return new ArrayCursor<T>(result.rows, result.rowsWritten);
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
