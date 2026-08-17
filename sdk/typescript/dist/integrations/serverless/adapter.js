/**
 * Adapter that wraps @tursodatabase/serverless Connection to match
 * the DatabasePromise interface used by AgentFS internals.
 *
 * The core challenge: DatabasePromise.prepare() is synchronous and returns
 * a Statement immediately, but serverless Connection.prepare() is async
 * (it needs to fetch column metadata over HTTP).
 *
 * Solution: return a LazyStatement that defers the actual prepare() call
 * until run()/get()/all() is called — those are already async, so the
 * deferral is invisible to callers.
 *
 * Note on parameter passing: DatabasePromise's Statement uses rest params
 * (run(...args)), while serverless Statement uses a single array param
 * (run(args?)). The adapter collects rest params and forwards them as a
 * single array — this is correct and tested.
 */
/**
 * A statement that defers the async prepare() call until execution.
 *
 * DatabasePromise.prepare() must return synchronously, but the serverless
 * driver's prepare() is async. LazyStatement bridges this by storing the
 * SQL and only calling conn.prepare() when run/get/all is invoked.
 *
 * The statement promise is cached for performance — options (raw, pluck,
 * safeIntegers) are applied at execution time on the resolved statement.
 */
class LazyStatement {
    conn;
    sql;
    stmtPromise = null;
    _raw = false;
    _pluck = false;
    _safeIntegers = false;
    constructor(conn, sql) {
        this.conn = conn;
        this.sql = sql;
    }
    async getStmt() {
        if (!this.stmtPromise) {
            this.stmtPromise = this.conn.prepare(this.sql);
        }
        const stmt = await this.stmtPromise;
        // Apply options at execution time so they reflect the current state
        stmt.raw(this._raw);
        stmt.pluck(this._pluck);
        stmt.safeIntegers(this._safeIntegers);
        return stmt;
    }
    raw(raw) {
        this._raw = raw !== false;
        return this;
    }
    pluck(pluck) {
        this._pluck = pluck !== false;
        return this;
    }
    safeIntegers(toggle) {
        this._safeIntegers = toggle !== false;
        return this;
    }
    columns() {
        throw new Error("columns() requires an async prepare — not supported synchronously in serverless mode");
    }
    get source() {
        return undefined;
    }
    get reader() {
        return undefined;
    }
    get database() {
        return undefined;
    }
    // Note: DatabasePromise Statement uses rest params (...args),
    // but serverless Statement uses a single array param (args?).
    // We collect rest params and forward as a single array.
    async run(...args) {
        const stmt = await this.getStmt();
        return stmt.run(args);
    }
    async get(...args) {
        const stmt = await this.getStmt();
        return stmt.get(args);
    }
    async all(...args) {
        const stmt = await this.getStmt();
        return stmt.all(args);
    }
    async *iterate(...args) {
        const stmt = await this.getStmt();
        yield* stmt.iterate(args);
    }
    bind(..._args) {
        throw new Error("bind() is not supported in serverless mode — pass parameters to run/get/all instead");
    }
    interrupt() { }
    close() { }
}
function notSupported(name) {
    return () => {
        throw new Error(`${name}() is not supported in serverless mode`);
    };
}
/**
 * Wraps a @tursodatabase/serverless Connection to match
 * the DatabasePromise interface expected by AgentFS.openWith().
 *
 * @example
 * ```typescript
 * import { connect } from "@tursodatabase/serverless";
 * import { AgentFS } from "agentfs-sdk";
 * import { createServerlessAdapter } from "agentfs-sdk/serverless";
 *
 * const conn = connect({
 *   url: "http://localhost:8080",
 * });
 *
 * const db = createServerlessAdapter(conn);
 * const agent = await AgentFS.openWith(db);
 * ```
 */
export function createServerlessAdapter(conn) {
    return {
        name: "serverless",
        readonly: false,
        open: true,
        memory: false,
        inTransaction: false,
        async connect() {
            // Validate the connection by running a simple query
            await conn.execute("SELECT 1");
        },
        prepare(sql) {
            return new LazyStatement(conn, sql);
        },
        // DatabasePromise.transaction() returns a wrapper function that
        // executes fn inside a transaction when called. The serverless
        // driver's transaction() has the same shape.
        transaction(fn) {
            return (...bindParameters) => {
                return conn.transaction(async () => {
                    return fn(...bindParameters);
                });
            };
        },
        async exec(sql) {
            await conn.exec(sql);
        },
        pragma() {
            throw new Error("pragma() is not supported in serverless mode — pragmas are not available over HTTP");
        },
        backup: notSupported("backup"),
        serialize: notSupported("serialize"),
        function: notSupported("function"),
        aggregate: notSupported("aggregate"),
        table: notSupported("table"),
        loadExtension: notSupported("loadExtension"),
        maxWriteReplicationIndex: notSupported("maxWriteReplicationIndex"),
        interrupt: notSupported("interrupt"),
        defaultSafeIntegers(_toggle) { },
        async close() {
            await conn.close();
        },
    };
}
