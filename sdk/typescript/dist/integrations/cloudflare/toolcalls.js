function serializeJson(label, value) {
    let serialized;
    try {
        serialized = JSON.stringify(value);
    }
    catch {
        throw new TypeError(`${label} must be JSON-serializable`);
    }
    if (serialized === undefined) {
        throw new TypeError(`${label} must be JSON-serializable`);
    }
    return serialized;
}
function validateLimit(limit) {
    if (!Number.isSafeInteger(limit) || limit <= 0 || limit > 10_000) {
        throw new RangeError('tool-call query limit must be an integer from 1 through 10000');
    }
}
/** Insert-only AgentFS tool-call storage over Durable Objects SQLite. */
export class CloudflareToolCalls {
    storage;
    constructor(storage) {
        this.storage = storage;
        this.initialize();
    }
    initialize() {
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
      CREATE TRIGGER IF NOT EXISTS agentfs_tool_calls_no_update
        BEFORE UPDATE ON tool_calls
        BEGIN SELECT RAISE(ABORT, 'tool_calls is insert-only'); END;
      CREATE TRIGGER IF NOT EXISTS agentfs_tool_calls_no_delete
        BEFORE DELETE ON tool_calls
        BEGIN SELECT RAISE(ABORT, 'tool_calls is insert-only'); END;
    `);
    }
    transactionView() {
        return { record: call => this.recordSync(call) };
    }
    record(call) {
        return this.storage.transactionSync(() => this.recordSync(call));
    }
    recordSync(call) {
        if (call.name.trim().length === 0)
            throw new TypeError('tool-call name must not be empty');
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
            : serializeJson('tool-call parameters', call.parameters);
        const result = call.outcome.kind === 'success'
            ? serializeJson('tool-call result', call.outcome.result)
            : null;
        const error = call.outcome.kind === 'error' ? call.outcome.error : null;
        const row = this.storage.sql.exec(`INSERT INTO tool_calls(
         name, parameters, result, error, started_at, completed_at, duration_ms
       ) VALUES (?, ?, ?, ?, ?, ?, ?)
       RETURNING id`, call.name, parameters, result, error, call.startedAt, call.completedAt, (call.completedAt - call.startedAt) * 1_000).one();
        return row.id;
    }
    get(id) {
        const rows = this.storage.sql.exec(`SELECT id, name, parameters, result, error, started_at, completed_at, duration_ms
       FROM tool_calls WHERE id = ?`, id).toArray();
        return rows.length === 0 ? undefined : this.fromRow(rows[0]);
    }
    getByName(name, limit = 100) {
        validateLimit(limit);
        return this.storage.sql.exec(`SELECT id, name, parameters, result, error, started_at, completed_at, duration_ms
       FROM tool_calls WHERE name = ?
       ORDER BY started_at DESC, id DESC LIMIT ?`, name, limit).toArray().map(row => this.fromRow(row));
    }
    getRecent(since, limit = 100) {
        validateLimit(limit);
        if (!Number.isSafeInteger(since) || since < 0) {
            throw new RangeError('since must be a non-negative Unix timestamp in seconds');
        }
        return this.storage.sql.exec(`SELECT id, name, parameters, result, error, started_at, completed_at, duration_ms
       FROM tool_calls WHERE started_at > ?
       ORDER BY started_at DESC, id DESC LIMIT ?`, since, limit).toArray().map(row => this.fromRow(row));
    }
    getStats() {
        return this.storage.sql.exec(`SELECT name,
              COUNT(*) AS total_calls,
              SUM(CASE WHEN error IS NULL THEN 1 ELSE 0 END) AS successful,
              SUM(CASE WHEN error IS NOT NULL THEN 1 ELSE 0 END) AS failed,
              AVG(duration_ms) AS average_duration_ms
       FROM tool_calls GROUP BY name
       ORDER BY total_calls DESC, name`).toArray().map(row => ({
            name: row.name,
            totalCalls: row.total_calls,
            successful: row.successful,
            failed: row.failed,
            averageDurationMs: row.average_duration_ms,
        }));
    }
    fromRow(row) {
        if ((row.result === null) === (row.error === null)) {
            throw new Error(`tool call ${row.id} violates the AgentFS outcome invariant`);
        }
        return {
            id: row.id,
            name: row.name,
            ...(row.parameters === null ? {} : { parameters: JSON.parse(row.parameters) }),
            outcome: row.error === null
                ? { kind: 'success', result: JSON.parse(row.result) }
                : { kind: 'error', error: row.error },
            startedAt: row.started_at,
            completedAt: row.completed_at,
            durationMs: row.duration_ms,
        };
    }
}
