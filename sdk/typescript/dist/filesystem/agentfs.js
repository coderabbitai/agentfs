import { createFsError } from '../errors.js';
import { assertInodeIsDirectory, assertNotRoot, assertNotSymlinkMode, assertReadableExistingInode, assertReaddirTargetInode, assertUnlinkTargetInode, assertWritableExistingInode, getInodeModeOrThrow, normalizeRmOptions, throwENOENTUnlessForce, } from '../guards.js';
import { S_IFMT, S_IFDIR, S_IFLNK, DEFAULT_FILE_MODE, DEFAULT_DIR_MODE, createStats, } from './interface.js';
const DEFAULT_CHUNK_SIZE = 4096;
/**
 * An open file handle for AgentFS.
 */
class AgentFSFile {
    db;
    bufferCtor;
    ino;
    chunkSize;
    constructor(db, bufferCtor, ino, chunkSize) {
        this.db = db;
        this.bufferCtor = bufferCtor;
        this.ino = ino;
        this.chunkSize = chunkSize;
    }
    async pread(offset, size) {
        const startChunk = Math.floor(offset / this.chunkSize);
        const endChunk = Math.floor((offset + size - 1) / this.chunkSize);
        const stmt = this.db.prepare(`
      SELECT chunk_index, data FROM fs_data
      WHERE ino = ? AND chunk_index >= ? AND chunk_index <= ?
      ORDER BY chunk_index ASC
    `);
        const rows = await stmt.all(this.ino, startChunk, endChunk);
        const buffers = [];
        let bytesCollected = 0;
        const startOffsetInChunk = offset % this.chunkSize;
        for (const row of rows) {
            const skip = buffers.length === 0 ? startOffsetInChunk : 0;
            if (skip >= row.data.length) {
                continue;
            }
            const remaining = size - bytesCollected;
            const take = Math.min(row.data.length - skip, remaining);
            buffers.push(row.data.subarray(skip, skip + take));
            bytesCollected += take;
        }
        if (buffers.length === 0) {
            return this.bufferCtor.alloc(0);
        }
        return this.bufferCtor.concat(buffers);
    }
    async pwrite(offset, data) {
        if (data.length === 0) {
            return;
        }
        const sizeStmt = this.db.prepare('SELECT size FROM fs_inode WHERE ino = ?');
        const sizeRow = await sizeStmt.get(this.ino);
        const currentSize = sizeRow?.size ?? 0;
        if (offset > currentSize) {
            const zeros = this.bufferCtor.alloc(offset - currentSize);
            await this.writeDataAtOffset(currentSize, zeros);
        }
        await this.writeDataAtOffset(offset, data);
        const newSize = Math.max(currentSize, offset + data.length);
        const now = Math.floor(Date.now() / 1000);
        const updateStmt = this.db.prepare('UPDATE fs_inode SET size = ?, mtime = ? WHERE ino = ?');
        await updateStmt.run(newSize, now, this.ino);
    }
    async writeDataAtOffset(offset, data) {
        const startChunk = Math.floor(offset / this.chunkSize);
        const endChunk = Math.floor((offset + data.length - 1) / this.chunkSize);
        for (let chunkIdx = startChunk; chunkIdx <= endChunk; chunkIdx++) {
            const chunkStart = chunkIdx * this.chunkSize;
            const chunkEnd = chunkStart + this.chunkSize;
            const dataStart = Math.max(0, chunkStart - offset);
            const dataEnd = Math.min(data.length, chunkEnd - offset);
            const writeOffset = Math.max(0, offset - chunkStart);
            const selectStmt = this.db.prepare('SELECT data FROM fs_data WHERE ino = ? AND chunk_index = ?');
            const existingRow = await selectStmt.get(this.ino, chunkIdx);
            let chunkData;
            if (existingRow) {
                chunkData = this.bufferCtor.from(existingRow.data);
                if (writeOffset + (dataEnd - dataStart) > chunkData.length) {
                    const newChunk = this.bufferCtor.alloc(writeOffset + (dataEnd - dataStart));
                    chunkData.copy(newChunk);
                    chunkData = newChunk;
                }
            }
            else {
                chunkData = this.bufferCtor.alloc(writeOffset + (dataEnd - dataStart));
            }
            data.copy(chunkData, writeOffset, dataStart, dataEnd);
            const upsertStmt = this.db.prepare(`
        INSERT INTO fs_data (ino, chunk_index, data) VALUES (?, ?, ?)
        ON CONFLICT(ino, chunk_index) DO UPDATE SET data = excluded.data
      `);
            await upsertStmt.run(this.ino, chunkIdx, chunkData);
        }
    }
    async truncate(newSize) {
        const sizeStmt = this.db.prepare('SELECT size FROM fs_inode WHERE ino = ?');
        const sizeRow = await sizeStmt.get(this.ino);
        const currentSize = sizeRow?.size ?? 0;
        await this.db.exec('BEGIN');
        try {
            if (newSize === 0) {
                const deleteStmt = this.db.prepare('DELETE FROM fs_data WHERE ino = ?');
                await deleteStmt.run(this.ino);
            }
            else if (newSize < currentSize) {
                const lastChunkIdx = Math.floor((newSize - 1) / this.chunkSize);
                const deleteStmt = this.db.prepare('DELETE FROM fs_data WHERE ino = ? AND chunk_index > ?');
                await deleteStmt.run(this.ino, lastChunkIdx);
                const offsetInChunk = newSize % this.chunkSize;
                if (offsetInChunk > 0) {
                    const selectStmt = this.db.prepare('SELECT data FROM fs_data WHERE ino = ? AND chunk_index = ?');
                    const row = await selectStmt.get(this.ino, lastChunkIdx);
                    if (row && row.data.length > offsetInChunk) {
                        const truncatedChunk = row.data.subarray(0, offsetInChunk);
                        const updateStmt = this.db.prepare('UPDATE fs_data SET data = ? WHERE ino = ? AND chunk_index = ?');
                        await updateStmt.run(truncatedChunk, this.ino, lastChunkIdx);
                    }
                }
            }
            const now = Math.floor(Date.now() / 1000);
            const updateStmt = this.db.prepare('UPDATE fs_inode SET size = ?, mtime = ? WHERE ino = ?');
            await updateStmt.run(newSize, now, this.ino);
            await this.db.exec('COMMIT');
        }
        catch (e) {
            await this.db.exec('ROLLBACK');
            throw e;
        }
    }
    async fsync() {
        await this.db.exec('PRAGMA synchronous = FULL');
        await this.db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
    }
    async fstat() {
        const stmt = this.db.prepare(`
      SELECT ino, mode, nlink, uid, gid, size, atime, mtime, ctime
      FROM fs_inode WHERE ino = ?
    `);
        const row = await stmt.get(this.ino);
        if (!row) {
            throw new Error('File handle refers to deleted inode');
        }
        return createStats(row);
    }
}
/**
 * A filesystem backed by SQLite, implementing the FileSystem interface.
 */
export class AgentFS {
    db;
    bufferCtor;
    rootIno = 1;
    chunkSize = DEFAULT_CHUNK_SIZE;
    constructor(db, b) {
        this.db = db;
        this.bufferCtor = b;
    }
    static async fromDatabase(db, b) {
        const fs = new AgentFS(db, b ?? Buffer);
        await fs.initialize();
        return fs;
    }
    getChunkSize() {
        return this.chunkSize;
    }
    async initialize() {
        await this.db.exec(`
      CREATE TABLE IF NOT EXISTS fs_config (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      )
    `);
        await this.db.exec(`
      CREATE TABLE IF NOT EXISTS fs_inode (
        ino INTEGER PRIMARY KEY AUTOINCREMENT,
        mode INTEGER NOT NULL,
        nlink INTEGER NOT NULL DEFAULT 0,
        uid INTEGER NOT NULL DEFAULT 0,
        gid INTEGER NOT NULL DEFAULT 0,
        size INTEGER NOT NULL DEFAULT 0,
        atime INTEGER NOT NULL,
        mtime INTEGER NOT NULL,
        ctime INTEGER NOT NULL,
        rdev INTEGER NOT NULL DEFAULT 0,
        atime_nsec INTEGER NOT NULL DEFAULT 0,
        mtime_nsec INTEGER NOT NULL DEFAULT 0,
        ctime_nsec INTEGER NOT NULL DEFAULT 0
      )
    `);
        await this.db.exec(`
      CREATE TABLE IF NOT EXISTS fs_dentry (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        parent_ino INTEGER NOT NULL,
        ino INTEGER NOT NULL,
        UNIQUE(parent_ino, name)
      )
    `);
        await this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_fs_dentry_parent
      ON fs_dentry(parent_ino, name)
    `);
        await this.db.exec(`
      CREATE TABLE IF NOT EXISTS fs_data (
        ino INTEGER NOT NULL,
        chunk_index INTEGER NOT NULL,
        data BLOB NOT NULL,
        PRIMARY KEY (ino, chunk_index)
      )
    `);
        await this.db.exec(`
      CREATE TABLE IF NOT EXISTS fs_symlink (
        ino INTEGER PRIMARY KEY,
        target TEXT NOT NULL
      )
    `);
        this.chunkSize = await this.ensureRoot();
    }
    async ensureRoot() {
        const configStmt = this.db.prepare("SELECT value FROM fs_config WHERE key = 'chunk_size'");
        const config = await configStmt.get();
        let chunkSize;
        if (!config) {
            const insertConfigStmt = this.db.prepare(`
        INSERT INTO fs_config (key, value) VALUES ('chunk_size', ?)
      `);
            await insertConfigStmt.run(DEFAULT_CHUNK_SIZE.toString());
            chunkSize = DEFAULT_CHUNK_SIZE;
        }
        else {
            chunkSize = parseInt(config.value, 10) || DEFAULT_CHUNK_SIZE;
        }
        // Set schema version (keep in sync with AGENTFS_SCHEMA_VERSION in sdk/rust/src/schema.rs)
        const schemaVersionStmt = this.db.prepare(`
      INSERT OR REPLACE INTO fs_config (key, value) VALUES ('schema_version', '0.4')
    `);
        await schemaVersionStmt.run();
        const stmt = this.db.prepare('SELECT ino FROM fs_inode WHERE ino = ?');
        const root = await stmt.get(this.rootIno);
        if (!root) {
            const now = Math.floor(Date.now() / 1000);
            const insertStmt = this.db.prepare(`
        INSERT INTO fs_inode (ino, mode, nlink, uid, gid, size, atime, mtime, ctime)
        VALUES (?, ?, 1, 0, 0, 0, ?, ?, ?)
      `);
            await insertStmt.run(this.rootIno, DEFAULT_DIR_MODE, now, now, now);
        }
        return chunkSize;
    }
    normalizePath(path) {
        const normalized = path.replace(/\/+$/, '') || '/';
        return normalized.startsWith('/') ? normalized : '/' + normalized;
    }
    splitPath(path) {
        const normalized = this.normalizePath(path);
        if (normalized === '/')
            return [];
        return normalized.split('/').filter(p => p);
    }
    async resolvePathOrThrow(path, syscall) {
        const normalizedPath = this.normalizePath(path);
        const ino = await this.resolvePath(normalizedPath);
        if (ino === null) {
            throw createFsError({
                code: 'ENOENT',
                syscall,
                path: normalizedPath,
                message: 'no such file or directory',
            });
        }
        return { normalizedPath, ino };
    }
    async resolvePath(path) {
        const normalized = this.normalizePath(path);
        if (normalized === '/') {
            return this.rootIno;
        }
        const parts = this.splitPath(normalized);
        let currentIno = this.rootIno;
        for (const name of parts) {
            const stmt = this.db.prepare(`
        SELECT ino FROM fs_dentry
        WHERE parent_ino = ? AND name = ?
      `);
            const result = await stmt.get(currentIno, name);
            if (!result) {
                return null;
            }
            currentIno = result.ino;
        }
        return currentIno;
    }
    async resolveParent(path) {
        const normalized = this.normalizePath(path);
        if (normalized === '/') {
            return null;
        }
        const parts = this.splitPath(normalized);
        const name = parts[parts.length - 1];
        const parentPath = parts.length === 1 ? '/' : '/' + parts.slice(0, -1).join('/');
        const parentIno = await this.resolvePath(parentPath);
        if (parentIno === null) {
            return null;
        }
        return { parentIno, name };
    }
    async createInode(mode, uid = 0, gid = 0) {
        const now = Math.floor(Date.now() / 1000);
        const stmt = this.db.prepare(`
      INSERT INTO fs_inode (mode, uid, gid, size, atime, mtime, ctime)
      VALUES (?, ?, ?, 0, ?, ?, ?)
      RETURNING ino
    `);
        const { ino } = await stmt.get(mode, uid, gid, now, now, now);
        return Number(ino);
    }
    async createDentry(parentIno, name, ino) {
        const stmt = this.db.prepare(`
      INSERT INTO fs_dentry (name, parent_ino, ino)
      VALUES (?, ?, ?)
    `);
        await stmt.run(name, parentIno, ino);
        const updateStmt = this.db.prepare('UPDATE fs_inode SET nlink = nlink + 1 WHERE ino = ?');
        await updateStmt.run(ino);
    }
    async ensureParentDirs(path) {
        const parts = this.splitPath(path);
        parts.pop();
        let currentIno = this.rootIno;
        for (const name of parts) {
            const stmt = this.db.prepare(`
        SELECT ino FROM fs_dentry
        WHERE parent_ino = ? AND name = ?
      `);
            const result = await stmt.get(currentIno, name);
            if (!result) {
                const dirIno = await this.createInode(DEFAULT_DIR_MODE);
                await this.createDentry(currentIno, name, dirIno);
                currentIno = dirIno;
            }
            else {
                await assertInodeIsDirectory(this.db, result.ino, 'open', this.normalizePath(path));
                currentIno = result.ino;
            }
        }
    }
    async getLinkCount(ino) {
        const stmt = this.db.prepare('SELECT nlink FROM fs_inode WHERE ino = ?');
        const result = await stmt.get(ino);
        return result?.nlink ?? 0;
    }
    async getInodeMode(ino) {
        const stmt = this.db.prepare('SELECT mode FROM fs_inode WHERE ino = ?');
        const row = await stmt.get(ino);
        return row?.mode ?? null;
    }
    // ==================== FileSystem Interface Implementation ====================
    async writeFile(path, content, options) {
        await this.ensureParentDirs(path);
        const ino = await this.resolvePath(path);
        const encoding = typeof options === 'string'
            ? options
            : options?.encoding;
        const normalizedPath = this.normalizePath(path);
        if (ino !== null) {
            await assertWritableExistingInode(this.db, ino, 'open', normalizedPath);
            await this.updateFileContent(ino, content, encoding);
        }
        else {
            const parent = await this.resolveParent(path);
            if (!parent) {
                throw createFsError({
                    code: 'ENOENT',
                    syscall: 'open',
                    path: normalizedPath,
                    message: 'no such file or directory',
                });
            }
            await assertInodeIsDirectory(this.db, parent.parentIno, 'open', normalizedPath);
            const fileIno = await this.createInode(DEFAULT_FILE_MODE);
            await this.createDentry(parent.parentIno, parent.name, fileIno);
            await this.updateFileContent(fileIno, content, encoding);
        }
    }
    async updateFileContent(ino, content, encoding) {
        const buffer = typeof content === 'string'
            ? this.bufferCtor.from(content, encoding ?? 'utf8')
            : content;
        const now = Math.floor(Date.now() / 1000);
        const deleteStmt = this.db.prepare('DELETE FROM fs_data WHERE ino = ?');
        await deleteStmt.run(ino);
        if (buffer.length > 0) {
            const stmt = this.db.prepare(`
        INSERT INTO fs_data (ino, chunk_index, data)
        VALUES (?, ?, ?)
      `);
            let chunkIndex = 0;
            for (let offset = 0; offset < buffer.length; offset += this.chunkSize) {
                const chunk = buffer.subarray(offset, Math.min(offset + this.chunkSize, buffer.length));
                await stmt.run(ino, chunkIndex, chunk);
                chunkIndex++;
            }
        }
        const updateStmt = this.db.prepare(`
      UPDATE fs_inode
      SET size = ?, mtime = ?
      WHERE ino = ?
    `);
        await updateStmt.run(buffer.length, now, ino);
    }
    async readFile(path, options) {
        const encoding = typeof options === 'string'
            ? options
            : options?.encoding;
        const { normalizedPath, ino } = await this.resolvePathOrThrow(path, 'open');
        await assertReadableExistingInode(this.db, ino, 'open', normalizedPath);
        const stmt = this.db.prepare(`
      SELECT data FROM fs_data
      WHERE ino = ?
      ORDER BY chunk_index ASC
    `);
        const rows = await stmt.all(ino);
        let combined;
        if (rows.length === 0) {
            combined = this.bufferCtor.alloc(0);
        }
        else {
            const buffers = rows.map(row => row.data);
            combined = this.bufferCtor.concat(buffers);
        }
        const now = Math.floor(Date.now() / 1000);
        const updateStmt = this.db.prepare('UPDATE fs_inode SET atime = ? WHERE ino = ?');
        await updateStmt.run(now, ino);
        if (encoding) {
            return combined.toString(encoding);
        }
        return combined;
    }
    async readdir(path) {
        const { normalizedPath, ino } = await this.resolvePathOrThrow(path, 'scandir');
        await assertReaddirTargetInode(this.db, ino, normalizedPath);
        const stmt = this.db.prepare(`
      SELECT name FROM fs_dentry
      WHERE parent_ino = ?
      ORDER BY name ASC
    `);
        const rows = await stmt.all(ino);
        return rows.map(row => row.name);
    }
    async readdirPlus(path) {
        const { normalizedPath, ino } = await this.resolvePathOrThrow(path, 'scandir');
        await assertReaddirTargetInode(this.db, ino, normalizedPath);
        const stmt = this.db.prepare(`
      SELECT d.name, i.ino, i.mode, i.nlink, i.uid, i.gid, i.size, i.atime, i.mtime, i.ctime
      FROM fs_dentry d
      JOIN fs_inode i ON d.ino = i.ino
      WHERE d.parent_ino = ?
      ORDER BY d.name ASC
    `);
        const rows = await stmt.all(ino);
        return rows.map(row => ({
            name: row.name,
            stats: createStats({
                ino: row.ino,
                mode: row.mode,
                nlink: row.nlink,
                uid: row.uid,
                gid: row.gid,
                size: row.size,
                atime: row.atime,
                mtime: row.mtime,
                ctime: row.ctime,
            }),
        }));
    }
    async stat(path) {
        const { normalizedPath, ino } = await this.resolvePathOrThrow(path, 'stat');
        const stmt = this.db.prepare(`
      SELECT ino, mode, nlink, uid, gid, size, atime, mtime, ctime
      FROM fs_inode
      WHERE ino = ?
    `);
        const row = await stmt.get(ino);
        if (!row) {
            throw createFsError({
                code: 'ENOENT',
                syscall: 'stat',
                path: normalizedPath,
                message: 'no such file or directory',
            });
        }
        return createStats(row);
    }
    async lstat(path) {
        // For now, lstat is the same as stat since we don't follow symlinks in stat yet
        return this.stat(path);
    }
    async mkdir(path) {
        const normalizedPath = this.normalizePath(path);
        const existing = await this.resolvePath(normalizedPath);
        if (existing !== null) {
            throw createFsError({
                code: 'EEXIST',
                syscall: 'mkdir',
                path: normalizedPath,
                message: 'file already exists',
            });
        }
        const parent = await this.resolveParent(normalizedPath);
        if (!parent) {
            throw createFsError({
                code: 'ENOENT',
                syscall: 'mkdir',
                path: normalizedPath,
                message: 'no such file or directory',
            });
        }
        await assertInodeIsDirectory(this.db, parent.parentIno, 'mkdir', normalizedPath);
        const dirIno = await this.createInode(DEFAULT_DIR_MODE);
        try {
            await this.createDentry(parent.parentIno, parent.name, dirIno);
        }
        catch {
            throw createFsError({
                code: 'EEXIST',
                syscall: 'mkdir',
                path: normalizedPath,
                message: 'file already exists',
            });
        }
    }
    async rmdir(path) {
        const normalizedPath = this.normalizePath(path);
        assertNotRoot(normalizedPath, 'rmdir');
        const { ino } = await this.resolvePathOrThrow(normalizedPath, 'rmdir');
        const mode = await getInodeModeOrThrow(this.db, ino, 'rmdir', normalizedPath);
        assertNotSymlinkMode(mode, 'rmdir', normalizedPath);
        if ((mode & S_IFMT) !== S_IFDIR) {
            throw createFsError({
                code: 'ENOTDIR',
                syscall: 'rmdir',
                path: normalizedPath,
                message: 'not a directory',
            });
        }
        const stmt = this.db.prepare(`
      SELECT 1 as one FROM fs_dentry
      WHERE parent_ino = ?
      LIMIT 1
    `);
        const child = await stmt.get(ino);
        if (child) {
            throw createFsError({
                code: 'ENOTEMPTY',
                syscall: 'rmdir',
                path: normalizedPath,
                message: 'directory not empty',
            });
        }
        const parent = await this.resolveParent(normalizedPath);
        if (!parent) {
            throw createFsError({
                code: 'EPERM',
                syscall: 'rmdir',
                path: normalizedPath,
                message: 'operation not permitted',
            });
        }
        await this.removeDentryAndMaybeInode(parent.parentIno, parent.name, ino);
    }
    async unlink(path) {
        const normalizedPath = this.normalizePath(path);
        assertNotRoot(normalizedPath, 'unlink');
        const { ino } = await this.resolvePathOrThrow(normalizedPath, 'unlink');
        await assertUnlinkTargetInode(this.db, ino, normalizedPath);
        const parent = (await this.resolveParent(normalizedPath));
        const stmt = this.db.prepare(`
      DELETE FROM fs_dentry
      WHERE parent_ino = ? AND name = ?
    `);
        await stmt.run(parent.parentIno, parent.name);
        const decrementStmt = this.db.prepare('UPDATE fs_inode SET nlink = nlink - 1 WHERE ino = ?');
        await decrementStmt.run(ino);
        const linkCount = await this.getLinkCount(ino);
        if (linkCount === 0) {
            const deleteInodeStmt = this.db.prepare('DELETE FROM fs_inode WHERE ino = ?');
            await deleteInodeStmt.run(ino);
            const deleteDataStmt = this.db.prepare('DELETE FROM fs_data WHERE ino = ?');
            await deleteDataStmt.run(ino);
        }
    }
    async rm(path, options) {
        const normalizedPath = this.normalizePath(path);
        const { force, recursive } = normalizeRmOptions(options);
        assertNotRoot(normalizedPath, 'rm');
        const ino = await this.resolvePath(normalizedPath);
        if (ino === null) {
            throwENOENTUnlessForce(normalizedPath, 'rm', force);
            return;
        }
        const mode = await getInodeModeOrThrow(this.db, ino, 'rm', normalizedPath);
        assertNotSymlinkMode(mode, 'rm', normalizedPath);
        const parent = await this.resolveParent(normalizedPath);
        if (!parent) {
            throw createFsError({
                code: 'EPERM',
                syscall: 'rm',
                path: normalizedPath,
                message: 'operation not permitted',
            });
        }
        if ((mode & S_IFMT) === S_IFDIR) {
            if (!recursive) {
                throw createFsError({
                    code: 'EISDIR',
                    syscall: 'rm',
                    path: normalizedPath,
                    message: 'illegal operation on a directory',
                });
            }
            await this.rmDirContentsRecursive(ino);
            await this.removeDentryAndMaybeInode(parent.parentIno, parent.name, ino);
            return;
        }
        await this.removeDentryAndMaybeInode(parent.parentIno, parent.name, ino);
    }
    async rmDirContentsRecursive(dirIno) {
        const stmt = this.db.prepare(`
      SELECT name, ino FROM fs_dentry
      WHERE parent_ino = ?
      ORDER BY name ASC
    `);
        const children = await stmt.all(dirIno);
        for (const child of children) {
            const mode = await this.getInodeMode(child.ino);
            if (mode === null) {
                continue;
            }
            if ((mode & S_IFMT) === S_IFDIR) {
                await this.rmDirContentsRecursive(child.ino);
                await this.removeDentryAndMaybeInode(dirIno, child.name, child.ino);
            }
            else {
                assertNotSymlinkMode(mode, 'rm', '<symlink>');
                await this.removeDentryAndMaybeInode(dirIno, child.name, child.ino);
            }
        }
    }
    async removeDentryAndMaybeInode(parentIno, name, ino) {
        const stmt = this.db.prepare(`
      DELETE FROM fs_dentry
      WHERE parent_ino = ? AND name = ?
    `);
        await stmt.run(parentIno, name);
        const decrementStmt = this.db.prepare('UPDATE fs_inode SET nlink = nlink - 1 WHERE ino = ?');
        await decrementStmt.run(ino);
        const linkCount = await this.getLinkCount(ino);
        if (linkCount === 0) {
            const deleteInodeStmt = this.db.prepare('DELETE FROM fs_inode WHERE ino = ?');
            await deleteInodeStmt.run(ino);
            const deleteDataStmt = this.db.prepare('DELETE FROM fs_data WHERE ino = ?');
            await deleteDataStmt.run(ino);
            const deleteSymlinkStmt = this.db.prepare('DELETE FROM fs_symlink WHERE ino = ?');
            await deleteSymlinkStmt.run(ino);
        }
    }
    async rename(oldPath, newPath) {
        const oldNormalized = this.normalizePath(oldPath);
        const newNormalized = this.normalizePath(newPath);
        if (oldNormalized === newNormalized)
            return;
        assertNotRoot(oldNormalized, 'rename');
        assertNotRoot(newNormalized, 'rename');
        const oldParent = await this.resolveParent(oldNormalized);
        if (!oldParent) {
            throw createFsError({
                code: 'EPERM',
                syscall: 'rename',
                path: oldNormalized,
                message: 'operation not permitted',
            });
        }
        const newParent = await this.resolveParent(newNormalized);
        if (!newParent) {
            throw createFsError({
                code: 'ENOENT',
                syscall: 'rename',
                path: newNormalized,
                message: 'no such file or directory',
            });
        }
        await assertInodeIsDirectory(this.db, newParent.parentIno, 'rename', newNormalized);
        await this.db.exec('BEGIN');
        try {
            const oldResolved = await this.resolvePathOrThrow(oldNormalized, 'rename');
            const oldIno = oldResolved.ino;
            const oldMode = await getInodeModeOrThrow(this.db, oldIno, 'rename', oldNormalized);
            assertNotSymlinkMode(oldMode, 'rename', oldNormalized);
            const oldIsDir = (oldMode & S_IFMT) === S_IFDIR;
            if (oldIsDir && newNormalized.startsWith(oldNormalized + '/')) {
                throw createFsError({
                    code: 'EINVAL',
                    syscall: 'rename',
                    path: newNormalized,
                    message: 'invalid argument',
                });
            }
            const newIno = await this.resolvePath(newNormalized);
            if (newIno !== null) {
                const newMode = await getInodeModeOrThrow(this.db, newIno, 'rename', newNormalized);
                assertNotSymlinkMode(newMode, 'rename', newNormalized);
                const newIsDir = (newMode & S_IFMT) === S_IFDIR;
                if (newIsDir && !oldIsDir) {
                    throw createFsError({
                        code: 'EISDIR',
                        syscall: 'rename',
                        path: newNormalized,
                        message: 'illegal operation on a directory',
                    });
                }
                if (!newIsDir && oldIsDir) {
                    throw createFsError({
                        code: 'ENOTDIR',
                        syscall: 'rename',
                        path: newNormalized,
                        message: 'not a directory',
                    });
                }
                if (newIsDir) {
                    const stmt = this.db.prepare(`
            SELECT 1 as one FROM fs_dentry
            WHERE parent_ino = ?
            LIMIT 1
          `);
                    const child = await stmt.get(newIno);
                    if (child) {
                        throw createFsError({
                            code: 'ENOTEMPTY',
                            syscall: 'rename',
                            path: newNormalized,
                            message: 'directory not empty',
                        });
                    }
                }
                await this.removeDentryAndMaybeInode(newParent.parentIno, newParent.name, newIno);
            }
            const stmt = this.db.prepare(`
        UPDATE fs_dentry
        SET parent_ino = ?, name = ?
        WHERE parent_ino = ? AND name = ?
      `);
            await stmt.run(newParent.parentIno, newParent.name, oldParent.parentIno, oldParent.name);
            const now = Math.floor(Date.now() / 1000);
            const updateInodeCtimeStmt = this.db.prepare(`
        UPDATE fs_inode
        SET ctime = ?
        WHERE ino = ?
      `);
            await updateInodeCtimeStmt.run(now, oldIno);
            const updateDirTimesStmt = this.db.prepare(`
        UPDATE fs_inode
        SET mtime = ?, ctime = ?
        WHERE ino = ?
      `);
            await updateDirTimesStmt.run(now, now, oldParent.parentIno);
            if (newParent.parentIno !== oldParent.parentIno) {
                await updateDirTimesStmt.run(now, now, newParent.parentIno);
            }
            await this.db.exec('COMMIT');
        }
        catch (e) {
            await this.db.exec('ROLLBACK');
            throw e;
        }
    }
    async copyFile(src, dest) {
        const srcNormalized = this.normalizePath(src);
        const destNormalized = this.normalizePath(dest);
        if (srcNormalized === destNormalized) {
            throw createFsError({
                code: 'EINVAL',
                syscall: 'copyfile',
                path: destNormalized,
                message: 'invalid argument',
            });
        }
        const { ino: srcIno } = await this.resolvePathOrThrow(srcNormalized, 'copyfile');
        await assertReadableExistingInode(this.db, srcIno, 'copyfile', srcNormalized);
        const stmt = this.db.prepare(`
      SELECT mode, uid, gid, size FROM fs_inode WHERE ino = ?
    `);
        const srcRow = await stmt.get(srcIno);
        if (!srcRow) {
            throw createFsError({
                code: 'ENOENT',
                syscall: 'copyfile',
                path: srcNormalized,
                message: 'no such file or directory',
            });
        }
        const destParent = await this.resolveParent(destNormalized);
        if (!destParent) {
            throw createFsError({
                code: 'ENOENT',
                syscall: 'copyfile',
                path: destNormalized,
                message: 'no such file or directory',
            });
        }
        await assertInodeIsDirectory(this.db, destParent.parentIno, 'copyfile', destNormalized);
        await this.db.exec('BEGIN');
        try {
            const now = Math.floor(Date.now() / 1000);
            const destIno = await this.resolvePath(destNormalized);
            if (destIno !== null) {
                const destMode = await getInodeModeOrThrow(this.db, destIno, 'copyfile', destNormalized);
                assertNotSymlinkMode(destMode, 'copyfile', destNormalized);
                if ((destMode & S_IFMT) === S_IFDIR) {
                    throw createFsError({
                        code: 'EISDIR',
                        syscall: 'copyfile',
                        path: destNormalized,
                        message: 'illegal operation on a directory',
                    });
                }
                const deleteStmt = this.db.prepare('DELETE FROM fs_data WHERE ino = ?');
                await deleteStmt.run(destIno);
                const copyStmt = this.db.prepare(`
          INSERT INTO fs_data (ino, chunk_index, data)
          SELECT ?, chunk_index, data
          FROM fs_data
          WHERE ino = ?
          ORDER BY chunk_index ASC
        `);
                await copyStmt.run(destIno, srcIno);
                const updateStmt = this.db.prepare(`
          UPDATE fs_inode
          SET mode = ?, uid = ?, gid = ?, size = ?, mtime = ?, ctime = ?
          WHERE ino = ?
        `);
                await updateStmt.run(srcRow.mode, srcRow.uid, srcRow.gid, srcRow.size, now, now, destIno);
            }
            else {
                const destInoCreated = await this.createInode(srcRow.mode, srcRow.uid, srcRow.gid);
                await this.createDentry(destParent.parentIno, destParent.name, destInoCreated);
                const copyStmt = this.db.prepare(`
          INSERT INTO fs_data (ino, chunk_index, data)
          SELECT ?, chunk_index, data
          FROM fs_data
          WHERE ino = ?
          ORDER BY chunk_index ASC
        `);
                await copyStmt.run(destInoCreated, srcIno);
                const updateStmt = this.db.prepare(`
          UPDATE fs_inode
          SET size = ?, mtime = ?, ctime = ?
          WHERE ino = ?
        `);
                await updateStmt.run(srcRow.size, now, now, destInoCreated);
            }
            await this.db.exec('COMMIT');
        }
        catch (e) {
            await this.db.exec('ROLLBACK');
            throw e;
        }
    }
    async symlink(target, linkpath) {
        const normalizedLinkpath = this.normalizePath(linkpath);
        const existing = await this.resolvePath(normalizedLinkpath);
        if (existing !== null) {
            throw createFsError({
                code: 'EEXIST',
                syscall: 'open',
                path: normalizedLinkpath,
                message: 'file already exists',
            });
        }
        const parent = await this.resolveParent(normalizedLinkpath);
        if (!parent) {
            throw createFsError({
                code: 'ENOENT',
                syscall: 'open',
                path: normalizedLinkpath,
                message: 'no such file or directory',
            });
        }
        await assertInodeIsDirectory(this.db, parent.parentIno, 'open', normalizedLinkpath);
        const mode = S_IFLNK | 0o777;
        const symlinkIno = await this.createInode(mode);
        await this.createDentry(parent.parentIno, parent.name, symlinkIno);
        const stmt = this.db.prepare('INSERT INTO fs_symlink (ino, target) VALUES (?, ?)');
        await stmt.run(symlinkIno, target);
        const updateStmt = this.db.prepare('UPDATE fs_inode SET size = ? WHERE ino = ?');
        await updateStmt.run(target.length, symlinkIno);
    }
    async readlink(path) {
        const { normalizedPath, ino } = await this.resolvePathOrThrow(path, 'open');
        const mode = await this.getInodeMode(ino);
        if (mode === null || (mode & S_IFMT) !== S_IFLNK) {
            throw createFsError({
                code: 'EINVAL',
                syscall: 'open',
                path: normalizedPath,
                message: 'invalid argument',
            });
        }
        const stmt = this.db.prepare('SELECT target FROM fs_symlink WHERE ino = ?');
        const row = await stmt.get(ino);
        if (!row) {
            throw createFsError({
                code: 'ENOENT',
                syscall: 'open',
                path: normalizedPath,
                message: 'no such file or directory',
            });
        }
        return row.target;
    }
    async access(path) {
        const normalizedPath = this.normalizePath(path);
        const ino = await this.resolvePath(normalizedPath);
        if (ino === null) {
            throw createFsError({
                code: 'ENOENT',
                syscall: 'access',
                path: normalizedPath,
                message: 'no such file or directory',
            });
        }
    }
    async statfs() {
        const inodeStmt = this.db.prepare('SELECT COUNT(*) as count FROM fs_inode');
        const inodeRow = await inodeStmt.get();
        const bytesStmt = this.db.prepare('SELECT COALESCE(SUM(LENGTH(data)), 0) as total FROM fs_data');
        const bytesRow = await bytesStmt.get();
        return {
            inodes: inodeRow.count,
            bytesUsed: bytesRow.total,
        };
    }
    async open(path) {
        const { normalizedPath, ino } = await this.resolvePathOrThrow(path, 'open');
        await assertReadableExistingInode(this.db, ino, 'open', normalizedPath);
        return new AgentFSFile(this.db, this.bufferCtor, ino, this.chunkSize);
    }
    // Legacy alias
    async deleteFile(path) {
        return await this.unlink(path);
    }
}
