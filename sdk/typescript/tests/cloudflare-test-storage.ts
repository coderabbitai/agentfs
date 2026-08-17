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
  private position = 0;

  constructor(
    private readonly rows: T[],
    readonly columnNames: string[],
    readonly rowsWritten = 0,
  ) {}

  get rowsRead(): number {
    return this.position;
  }

  toArray(): T[] {
    const remaining = this.rows.slice(this.position);
    this.position = this.rows.length;
    return remaining;
  }

  one(): T {
    const remaining = this.rows.length - this.position;
    if (remaining !== 1) {
      throw new Error(`expected one row, received ${remaining}`);
    }
    return this.rows[this.position++];
  }

  *raw(): IterableIterator<unknown[]> {
    while (this.position < this.rows.length) {
      const row = this.rows[this.position++];
      yield this.columnNames.map(column => Reflect.get(Object(row), column));
    }
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
  readonly columnNames: string[];
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
  const rows = statement.all(...bindings);
  return {
    rows,
    columnNames: statement.columns().map(column => column.name),
    rowsWritten: isWriteStatement(query) ? readChanges(database) : 0,
  };
}

function readChanges(database: DatabaseSync): number {
  const row = database.prepare('SELECT changes() AS count').get();
  const count = row === undefined ? undefined : Reflect.get(row, 'count');
  if (typeof count !== 'number' && typeof count !== 'bigint') {
    throw new TypeError('SQLite changes() did not return a numeric count');
  }
  return Number(count);
}

interface SqlToken {
  readonly depth: number;
  readonly word: string;
}

interface SqlScanResult {
  readonly statements: string[];
  readonly tokens: SqlToken[];
}

function scanSql(query: string): SqlScanResult {
  const statements: string[] = [];
  const tokens: SqlToken[] = [];
  let statementStart = 0;
  let hasToken = false;
  let quote: "'" | '"' | '`' | ']' | undefined;
  let lineComment = false;
  let blockComment = false;
  let depth = 0;
  let triggerBody = false;
  let triggerEnd = false;
  let statementWords: string[] = [];

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
      if (triggerBody && !triggerEnd) {
        hasToken = true;
        continue;
      }
      if (hasToken) statements.push(query.slice(statementStart, index));
      statementStart = index + 1;
      hasToken = false;
      triggerBody = false;
      triggerEnd = false;
      statementWords = [];
      continue;
    }
    if (character === '(') {
      depth++;
      hasToken = true;
      continue;
    }
    if (character === ')') {
      depth = Math.max(0, depth - 1);
      hasToken = true;
      continue;
    }
    if (/[A-Za-z_]/.test(character)) {
      let end = index + 1;
      while (end < query.length && /[A-Za-z0-9_]/.test(query[end])) end++;
      const word = query.slice(index, end).toUpperCase();
      tokens.push({ depth, word });
      if (depth === 0) {
        statementWords.push(word);
        if (
          word === 'BEGIN' &&
          statementWords[0] === 'CREATE' &&
          statementWords.includes('TRIGGER')
        ) {
          triggerBody = true;
        } else if (triggerBody) {
          triggerEnd = word === 'END';
        }
      }
      hasToken = true;
      index = end - 1;
      continue;
    }
    if (!/\s/.test(character)) hasToken = true;
  }
  if (hasToken) statements.push(query.slice(statementStart));
  return { statements, tokens };
}

function isWriteStatement(query: string): boolean {
  const topLevelWords = scanSql(query).tokens
    .filter(token => token.depth === 0)
    .map(token => token.word);
  const operation = topLevelWords[0] === 'WITH'
    ? topLevelWords.find(word => word === 'INSERT' || word === 'UPDATE' || word === 'DELETE')
    : topLevelWords[0];
  return operation === 'INSERT' || operation === 'UPDATE' || operation === 'DELETE';
}

function isPromiseLike(value: unknown): value is PromiseLike<unknown> {
  if (value === null || (typeof value !== 'object' && typeof value !== 'function')) {
    return false;
  }
  return typeof Reflect.get(Object(value), 'then') === 'function';
}

function runSynchronous<T>(callback: () => T): T {
  const result = callback();
  if (isPromiseLike(result)) {
    throw new TypeError('Cloudflare storage transaction callback must be synchronous');
  }
  return result;
}

export function cloudflareStorage(database: DatabaseSync): CloudflareStorage {
  return {
    sql: {
      exec<T = Record<string, unknown>>(
        query: string,
        ...bindings: unknown[]
      ): TestCursor<T> {
        const statements = scanSql(query).statements;
        const prefix = statements.slice(0, -1);
        for (const statement of prefix) {
          queryRows(database, statement, []);
        }
        const finalStatement = statements.at(-1);
        if (finalStatement === undefined) {
          return new ArrayCursor<T>([], [], 0);
        }
        const result = queryRows<T>(
          database,
          finalStatement,
          bindings.map(toSqlInputValue),
        );
        return new ArrayCursor<T>(
          result.rows,
          result.columnNames,
          result.rowsWritten,
        );
      },
      get databaseSize() {
        return 0;
      },
    },
    transactionSync<T>(callback: () => T): T {
      database.exec('BEGIN IMMEDIATE');
      try {
        const result = runSynchronous(callback);
        database.exec('COMMIT');
        return result;
      } catch (error) {
        database.exec('ROLLBACK');
        throw error;
      }
    },
  };
}
