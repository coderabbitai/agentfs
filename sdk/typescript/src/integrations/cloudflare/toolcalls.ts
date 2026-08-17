import type { CloudflareStorage } from './agentfs.js';
import { parseStoredJson, serializeJson } from './json.js';
import {
  assertTransactionViewCapability,
  type CloudflareTransactionViewCapability,
} from './transaction.js';

export type CloudflareToolCallOutcome =
  | { readonly kind: 'success'; readonly result: unknown }
  | { readonly kind: 'error'; readonly error: string };

export interface CloudflareToolCallInput {
  readonly name: string;
  readonly parameters?: unknown;
  readonly outcome: CloudflareToolCallOutcome;
  readonly startedAt: number;
  readonly completedAt: number;
}

export interface CloudflareToolCall extends CloudflareToolCallInput {
  readonly id: number;
  readonly durationMs: number;
}

export interface CloudflareToolCallStats {
  readonly name: string;
  readonly totalCalls: number;
  readonly successful: number;
  readonly failed: number;
  readonly averageDurationMs: number;
}

export interface CloudflareToolCallsTransaction {
  record(call: CloudflareToolCallInput): number;
}

export type CloudflareToolCallSanitizer = (
  field: 'parameters' | 'result',
  value: unknown,
) => unknown;

export interface CloudflareToolCallsOptions {
  /**
   * Runs immediately before parameters or successful results are serialized.
   * Applications that can receive secrets must supply their policy redactor.
   */
  readonly sanitize?: CloudflareToolCallSanitizer;
}

interface ToolCallRow {
  id: number;
  name: string;
  parameters: string | null;
  result: string | null;
  error: string | null;
  started_at: number;
  completed_at: number;
  duration_ms: number;
}

function validateLimit(limit: number): void {
  if (!Number.isSafeInteger(limit) || limit <= 0 || limit > 10_000) {
    throw new RangeError('tool-call query limit must be an integer from 1 through 10000');
  }
}

/** Insert-only AgentFS tool-call storage over Durable Objects SQLite. */
export class CloudflareToolCalls implements CloudflareToolCallsTransaction {
  private readonly storage: CloudflareStorage;
  private readonly sanitize: CloudflareToolCallSanitizer;

  constructor(storage: CloudflareStorage, options: CloudflareToolCallsOptions = {}) {
    this.storage = storage;
    this.sanitize = options.sanitize ?? ((_field, value) => value);
    this.initialize();
  }

  private initialize(): void {
    this.storage.sql.exec(`
      CREATE TABLE IF NOT EXISTS tool_calls (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        parameters TEXT,
        result TEXT,
        error TEXT,
        started_at INTEGER NOT NULL,
        completed_at INTEGER NOT NULL,
        duration_ms INTEGER NOT NULL,
        CHECK ((result IS NULL) <> (error IS NULL)),
        CHECK (completed_at >= started_at),
        CHECK (duration_ms = (completed_at - started_at) * 1000)
      );
      CREATE INDEX IF NOT EXISTS idx_tool_calls_name
        ON tool_calls(name);
      CREATE INDEX IF NOT EXISTS idx_tool_calls_started_at
        ON tool_calls(started_at);
      CREATE TABLE IF NOT EXISTS agentfs_tool_call_maintenance (
        singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
        allow_delete INTEGER NOT NULL DEFAULT 0 CHECK (allow_delete IN (0, 1))
      );
      INSERT OR IGNORE INTO agentfs_tool_call_maintenance(singleton, allow_delete)
        VALUES (1, 0);
      CREATE TRIGGER IF NOT EXISTS agentfs_tool_calls_no_update
        BEFORE UPDATE ON tool_calls
        BEGIN SELECT RAISE(ABORT, 'tool_calls is insert-only'); END;
      DROP TRIGGER IF EXISTS agentfs_tool_calls_no_delete;
      CREATE TRIGGER agentfs_tool_calls_no_delete
        BEFORE DELETE ON tool_calls
        WHEN (SELECT allow_delete FROM agentfs_tool_call_maintenance WHERE singleton = 1) = 0
        BEGIN SELECT RAISE(ABORT, 'tool_calls is insert-only'); END;
    `);
  }

  transactionView(
    capability: CloudflareTransactionViewCapability,
    assertOpen: () => void,
  ): CloudflareToolCallsTransaction {
    assertTransactionViewCapability(capability);
    return {
      record: call => {
        assertOpen();
        return this.recordSync(call);
      },
    };
  }

  record(call: CloudflareToolCallInput): number {
    return this.storage.transactionSync(() => this.recordSync(call));
  }

  private recordSync(call: CloudflareToolCallInput): number {
    if (call.name.trim().length === 0) throw new TypeError('tool-call name must not be empty');
    if (!Number.isSafeInteger(call.startedAt) || call.startedAt < 0) {
      throw new RangeError('startedAt must be a non-negative Unix timestamp in seconds');
    }
    if (!Number.isSafeInteger(call.completedAt) || call.completedAt < call.startedAt) {
      throw new RangeError('completedAt must be an integer at or after startedAt');
    }
    if (call.outcome.kind === 'error' && call.outcome.error.length === 0) {
      throw new TypeError('tool-call error must not be empty');
    }
    const parameters = call.parameters === undefined
      ? null
      : serializeJson(
          'tool-call parameters',
          this.sanitize('parameters', call.parameters),
        );
    const result = call.outcome.kind === 'success'
      ? serializeJson(
          'tool-call result',
          this.sanitize('result', call.outcome.result),
        )
      : null;
    const error = call.outcome.kind === 'error' ? call.outcome.error : null;
    const row = this.storage.sql.exec<{ id: number }>(
      `INSERT INTO tool_calls(
         name, parameters, result, error, started_at, completed_at, duration_ms
       ) VALUES (?, ?, ?, ?, ?, ?, ?)
       RETURNING id`,
      call.name,
      parameters,
      result,
      error,
      call.startedAt,
      call.completedAt,
      (call.completedAt - call.startedAt) * 1_000,
    ).one();
    return row.id;
  }

  get(id: number): CloudflareToolCall | undefined {
    const rows = this.storage.sql.exec<ToolCallRow>(
      `SELECT id, name, parameters, result, error, started_at, completed_at, duration_ms
       FROM tool_calls WHERE id = ?`,
      id,
    ).toArray();
    return rows.length === 0 ? undefined : this.fromRow(rows[0]);
  }

  getByName(name: string, limit = 100): CloudflareToolCall[] {
    validateLimit(limit);
    return this.storage.sql.exec<ToolCallRow>(
      `SELECT id, name, parameters, result, error, started_at, completed_at, duration_ms
       FROM tool_calls WHERE name = ?
       ORDER BY started_at DESC, id DESC LIMIT ?`,
      name,
      limit,
    ).toArray().map(row => this.fromRow(row));
  }

  getRecent(since: number, limit = 100): CloudflareToolCall[] {
    validateLimit(limit);
    if (!Number.isSafeInteger(since) || since < 0) {
      throw new RangeError('since must be a non-negative Unix timestamp in seconds');
    }
    return this.storage.sql.exec<ToolCallRow>(
      `SELECT id, name, parameters, result, error, started_at, completed_at, duration_ms
       FROM tool_calls WHERE started_at > ?
       ORDER BY started_at DESC, id DESC LIMIT ?`,
      since,
      limit,
    ).toArray().map(row => this.fromRow(row));
  }

  getStats(): CloudflareToolCallStats[] {
    return this.storage.sql.exec<{
      name: string;
      total_calls: number;
      successful: number;
      failed: number;
      average_duration_ms: number;
    }>(
      `SELECT name,
              COUNT(*) AS total_calls,
              SUM(CASE WHEN error IS NULL THEN 1 ELSE 0 END) AS successful,
              SUM(CASE WHEN error IS NOT NULL THEN 1 ELSE 0 END) AS failed,
              AVG(duration_ms) AS average_duration_ms
       FROM tool_calls GROUP BY name
       ORDER BY total_calls DESC, name`,
    ).toArray().map(row => ({
      name: row.name,
      totalCalls: row.total_calls,
      successful: row.successful,
      failed: row.failed,
      averageDurationMs: row.average_duration_ms,
    }));
  }

  /**
   * Explicit retention/erasure path. Ordinary transaction views remain
   * insert-only; this method opens one transaction and enables deletion only
   * for its bounded maintenance statement.
   */
  purgeBefore(startedBefore: number): number {
    if (!Number.isSafeInteger(startedBefore) || startedBefore < 0) {
      throw new RangeError('startedBefore must be a non-negative Unix timestamp in seconds');
    }
    return this.storage.transactionSync(() => {
      this.storage.sql.exec(
        `UPDATE agentfs_tool_call_maintenance
         SET allow_delete = 1 WHERE singleton = 1`,
      );
      try {
        this.storage.sql.exec(
          'DELETE FROM tool_calls WHERE started_at < ?',
          startedBefore,
        );
        return this.storage.sql.exec<{ count: number }>(
          'SELECT changes() AS count',
        ).one().count;
      } finally {
        this.storage.sql.exec(
          `UPDATE agentfs_tool_call_maintenance
           SET allow_delete = 0 WHERE singleton = 1`,
        );
      }
    });
  }

  private fromRow(row: ToolCallRow): CloudflareToolCall {
    const outcome = this.outcomeFromRow(row);
    return {
      id: row.id,
      name: row.name,
      ...(row.parameters === null
        ? {}
        : {
            parameters: parseStoredJson(
              `tool call ${row.id} parameters`,
              row.parameters,
            ),
          }),
      outcome,
      startedAt: row.started_at,
      completedAt: row.completed_at,
      durationMs: row.duration_ms,
    };
  }

  private outcomeFromRow(row: ToolCallRow): CloudflareToolCallOutcome {
    if (row.error !== null) {
      if (row.result !== null) {
        throw new Error(`tool call ${row.id} violates the AgentFS outcome invariant`);
      }
      return { kind: 'error', error: row.error };
    }
    if (row.result === null) {
      throw new Error(`tool call ${row.id} violates the AgentFS outcome invariant`);
    }
    return {
      kind: 'success',
      result: parseStoredJson(`tool call ${row.id} result`, row.result),
    };
  }
}
