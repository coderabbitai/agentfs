export class KvStore {
    db;
    constructor(db) {
        this.db = db;
    }
    /**
     * Create a KvStore from an existing database connection
     */
    static async fromDatabase(db) {
        const kv = new KvStore(db);
        await kv.initialize();
        return kv;
    }
    async initialize() {
        // Create the key-value store table if it doesn't exist
        await this.db.exec(`
      CREATE TABLE IF NOT EXISTS kv_store (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        created_at INTEGER DEFAULT (unixepoch()),
        updated_at INTEGER DEFAULT (unixepoch())
      )
    `);
        // Create index on created_at for potential queries
        await this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_kv_store_created_at
      ON kv_store(created_at)
    `);
    }
    async set(key, value) {
        // Serialize the value to JSON
        const serializedValue = JSON.stringify(value);
        // Use prepared statement to insert or update
        const stmt = this.db.prepare(`
      INSERT INTO kv_store (key, value, updated_at)
      VALUES (?, ?, unixepoch())
      ON CONFLICT(key) DO UPDATE SET
        value = excluded.value,
        updated_at = unixepoch()
    `);
        await stmt.run(key, serializedValue);
    }
    async get(key) {
        const stmt = this.db.prepare(`SELECT value FROM kv_store WHERE key = ?`);
        const row = await stmt.get(key);
        if (!row) {
            return undefined;
        }
        // Deserialize the JSON value
        return JSON.parse(row.value);
    }
    async list(prefix) {
        const stmt = this.db.prepare(`SELECT key, value FROM kv_store WHERE key LIKE ? ESCAPE '\\'`);
        const escaped = prefix.replace('\\', '\\\\').replace('%', '\\%').replace('_', '\\_');
        const rows = await stmt.all(escaped + '%');
        return rows.map(r => ({ key: r.key, value: JSON.parse(r.value) }));
    }
    async delete(key) {
        const stmt = this.db.prepare(`DELETE FROM kv_store WHERE key = ?`);
        await stmt.run(key);
    }
}
