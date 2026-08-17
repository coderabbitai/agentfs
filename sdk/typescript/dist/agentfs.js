export class AgentFSCore {
    db;
    kv;
    fs;
    tools;
    /**
     * Private constructor - use AgentFS.open() instead
     */
    constructor(db, kv, fs, tools) {
        this.db = db;
        this.kv = kv;
        this.fs = fs;
        this.tools = tools;
    }
    /**
     * Get the underlying Database instance
     */
    getDatabase() {
        return this.db;
    }
    /**
     * Close the database connection
     */
    async close() {
        await this.db.close();
    }
}
