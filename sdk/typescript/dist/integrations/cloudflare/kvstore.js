function serializeJson(value) {
    let serialized;
    try {
        serialized = JSON.stringify(value);
    }
    catch {
        throw new TypeError('KV values must be JSON-serializable');
    }
    if (serialized === undefined) {
        throw new TypeError('KV values must be JSON-serializable');
    }
    return serialized;
}
function escapeLike(value) {
    return value.replace(/[\\%_]/g, character => `\\${character}`);
}
/** AgentFS KV storage over the caller's Durable Objects SQLite database. */
export class CloudflareKvStore {
    storage;
    constructor(storage) {
        this.storage = storage;
        this.initialize();
    }
    initialize() {
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
    transactionView() {
        return {
            set: (key, value) => this.setSync(key, value),
            get: (key) => this.get(key),
            list: (prefix) => this.list(prefix),
            delete: key => this.deleteSync(key),
        };
    }
    set(key, value) {
        this.storage.transactionSync(() => this.setSync(key, value));
    }
    setSync(key, value) {
        const serialized = serializeJson(value);
        this.storage.sql.exec(`INSERT INTO kv_store (key, value, updated_at)
       VALUES (?, ?, unixepoch())
       ON CONFLICT(key) DO UPDATE SET
         value = excluded.value,
         updated_at = unixepoch()`, key, serialized);
    }
    get(key) {
        const rows = this.storage.sql.exec('SELECT value FROM kv_store WHERE key = ?', key).toArray();
        return rows.length === 0 ? undefined : JSON.parse(rows[0].value);
    }
    list(prefix) {
        return this.storage.sql.exec(`SELECT key, value FROM kv_store
       WHERE key LIKE ? ESCAPE '\\'
       ORDER BY key`, `${escapeLike(prefix)}%`).toArray().map(row => ({ key: row.key, value: JSON.parse(row.value) }));
    }
    delete(key) {
        this.storage.transactionSync(() => this.deleteSync(key));
    }
    deleteSync(key) {
        this.storage.sql.exec('DELETE FROM kv_store WHERE key = ?', key);
    }
}
