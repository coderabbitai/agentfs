function validatePath(path) {
    if (!path.startsWith('/') ||
        path === '/' ||
        path.length > 4096 ||
        path.includes('\0') ||
        path.endsWith('/') ||
        path.split('/').some((component, index) => index > 0 && (component.length === 0 || component === '.' || component === '..'))) {
        throw new TypeError('overlay path must be a normalized absolute non-root path');
    }
    return path;
}
function validateDirectoryPath(path) {
    if (path === '/')
        return path;
    return validatePath(path);
}
function parentPath(path) {
    const separator = path.lastIndexOf('/');
    return separator === 0 ? '/' : path.slice(0, separator);
}
function validateInode(label, ino) {
    if (!Number.isSafeInteger(ino) || ino <= 0) {
        throw new RangeError(`${label} must be a positive safe integer`);
    }
}
/** AgentFS overlay whiteout and copy-up origin metadata over Durable Objects SQLite. */
export class CloudflareOverlayMetadata {
    storage;
    constructor(storage) {
        this.storage = storage;
        this.initialize();
    }
    initialize() {
        this.storage.sql.exec(`
      CREATE TABLE IF NOT EXISTS fs_whiteout (
        path TEXT PRIMARY KEY,
        parent_path TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_fs_whiteout_parent
        ON fs_whiteout(parent_path);
      CREATE TABLE IF NOT EXISTS fs_origin (
        delta_ino INTEGER PRIMARY KEY,
        base_ino INTEGER NOT NULL
      );
    `);
    }
    transactionView(assertOpen = () => undefined) {
        return {
            createWhiteout: (path, createdAt) => {
                assertOpen();
                this.createWhiteoutSync(path, createdAt);
            },
            removeWhiteout: path => {
                assertOpen();
                this.removeWhiteoutSync(path);
            },
            setOrigin: (deltaIno, baseIno) => {
                assertOpen();
                this.setOriginSync(deltaIno, baseIno);
            },
            removeOrigin: deltaIno => {
                assertOpen();
                this.removeOriginSync(deltaIno);
            },
        };
    }
    createWhiteout(path, createdAt = Math.floor(Date.now() / 1_000)) {
        this.storage.transactionSync(() => this.createWhiteoutSync(path, createdAt));
    }
    createWhiteoutSync(path, createdAt = Math.floor(Date.now() / 1_000)) {
        const normalized = validatePath(path);
        if (!Number.isSafeInteger(createdAt) || createdAt < 0) {
            throw new RangeError('createdAt must be a non-negative Unix timestamp in seconds');
        }
        this.storage.sql.exec(`INSERT INTO fs_whiteout(path, parent_path, created_at)
       VALUES (?, ?, ?)
       ON CONFLICT(path) DO UPDATE SET
         parent_path = excluded.parent_path,
         created_at = excluded.created_at`, normalized, parentPath(normalized), createdAt);
    }
    removeWhiteout(path) {
        this.storage.transactionSync(() => this.removeWhiteoutSync(path));
    }
    removeWhiteoutSync(path) {
        this.storage.sql.exec('DELETE FROM fs_whiteout WHERE path = ?', validatePath(path));
    }
    isWhiteout(path) {
        const ancestors = [];
        for (let current = validatePath(path); current !== '/'; current = parentPath(current)) {
            ancestors.push(current);
        }
        const placeholders = ancestors.map(() => '?').join(', ');
        return this.storage.sql.exec(`SELECT 1 AS present FROM fs_whiteout
       WHERE path IN (${placeholders}) LIMIT 1`, ...ancestors).toArray().length > 0;
    }
    listChildWhiteouts(path) {
        return this.storage.sql.exec('SELECT path FROM fs_whiteout WHERE parent_path = ? ORDER BY path', validateDirectoryPath(path)).toArray().map(row => row.path);
    }
    setOrigin(deltaIno, baseIno) {
        this.storage.transactionSync(() => this.setOriginSync(deltaIno, baseIno));
    }
    setOriginSync(deltaIno, baseIno) {
        validateInode('deltaIno', deltaIno);
        validateInode('baseIno', baseIno);
        this.storage.sql.exec(`INSERT INTO fs_origin(delta_ino, base_ino) VALUES (?, ?)
       ON CONFLICT(delta_ino) DO UPDATE SET base_ino = excluded.base_ino`, deltaIno, baseIno);
    }
    getOrigin(deltaIno) {
        validateInode('deltaIno', deltaIno);
        return this.storage.sql.exec('SELECT base_ino FROM fs_origin WHERE delta_ino = ?', deltaIno).toArray()[0]?.base_ino;
    }
    removeOrigin(deltaIno) {
        this.storage.transactionSync(() => this.removeOriginSync(deltaIno));
    }
    removeOriginSync(deltaIno) {
        validateInode('deltaIno', deltaIno);
        this.storage.sql.exec('DELETE FROM fs_origin WHERE delta_ino = ?', deltaIno);
    }
}
