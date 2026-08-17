import type { CloudflareStorage } from './agentfs.js';
import {
  assertTransactionViewCapability,
  type CloudflareTransactionViewCapability,
} from './transaction.js';

const MAX_QUERY_BINDINGS = 100;

export interface CloudflareOverlayTransaction {
  createWhiteout(path: string, createdAt?: number): void;
  removeWhiteout(path: string): void;
  setOrigin(deltaIno: number, baseIno: number): void;
  removeOrigin(deltaIno: number): void;
}

function validatePath(path: string): string {
  if (
    !path.startsWith('/') ||
    path === '/' ||
    path.length > 4096 ||
    path.includes('\0') ||
    path.endsWith('/') ||
    path.split('/').some((component, index) => index > 0 && (
      component.length === 0 || component === '.' || component === '..'
    ))
  ) {
    throw new TypeError('overlay path must be a normalized absolute non-root path');
  }
  return path;
}

function validateDirectoryPath(path: string): string {
  if (path === '/') return path;
  return validatePath(path);
}

function parentPath(path: string): string {
  const separator = path.lastIndexOf('/');
  return separator === 0 ? '/' : path.slice(0, separator);
}

function validateInode(label: string, ino: number): void {
  if (!Number.isSafeInteger(ino) || ino <= 0) {
    throw new RangeError(`${label} must be a positive safe integer`);
  }
}

/** AgentFS overlay whiteout and copy-up origin metadata over Durable Objects SQLite. */
export class CloudflareOverlayMetadata implements CloudflareOverlayTransaction {
  private readonly storage: CloudflareStorage;

  constructor(storage: CloudflareStorage) {
    this.storage = storage;
    this.initialize();
  }

  private initialize(): void {
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

  transactionView(
    capability: CloudflareTransactionViewCapability,
    assertOpen: () => void,
  ): CloudflareOverlayTransaction {
    assertTransactionViewCapability(capability);
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

  createWhiteout(path: string, createdAt = Math.floor(Date.now() / 1_000)): void {
    this.storage.transactionSync(() => this.createWhiteoutSync(path, createdAt));
  }

  private createWhiteoutSync(path: string, createdAt = Math.floor(Date.now() / 1_000)): void {
    const normalized = validatePath(path);
    if (!Number.isSafeInteger(createdAt) || createdAt < 0) {
      throw new RangeError('createdAt must be a non-negative Unix timestamp in seconds');
    }
    this.storage.sql.exec(
      `INSERT INTO fs_whiteout(path, parent_path, created_at)
       VALUES (?, ?, ?)
       ON CONFLICT(path) DO UPDATE SET
         parent_path = excluded.parent_path,
         created_at = excluded.created_at`,
      normalized,
      parentPath(normalized),
      createdAt,
    );
  }

  removeWhiteout(path: string): void {
    this.storage.transactionSync(() => this.removeWhiteoutSync(path));
  }

  private removeWhiteoutSync(path: string): void {
    this.storage.sql.exec('DELETE FROM fs_whiteout WHERE path = ?', validatePath(path));
  }

  isWhiteout(path: string): boolean {
    const ancestors: string[] = [];
    for (
      let current = validatePath(path);
      current !== '/';
      current = parentPath(current)
    ) {
      ancestors.push(current);
    }
    for (let offset = 0; offset < ancestors.length; offset += MAX_QUERY_BINDINGS) {
      const batch = ancestors.slice(offset, offset + MAX_QUERY_BINDINGS);
      const placeholders = batch.map(() => '?').join(', ');
      const present = this.storage.sql.exec<{ present: number }>(
        `SELECT 1 AS present FROM fs_whiteout
         WHERE path IN (${placeholders}) LIMIT 1`,
        ...batch,
      ).toArray().length > 0;
      if (present) return true;
    }
    return false;
  }

  listChildWhiteouts(path: string): string[] {
    return this.storage.sql.exec<{ path: string }>(
      'SELECT path FROM fs_whiteout WHERE parent_path = ? ORDER BY path',
      validateDirectoryPath(path),
    ).toArray().map(row => row.path);
  }

  setOrigin(deltaIno: number, baseIno: number): void {
    this.storage.transactionSync(() => this.setOriginSync(deltaIno, baseIno));
  }

  private setOriginSync(deltaIno: number, baseIno: number): void {
    validateInode('deltaIno', deltaIno);
    validateInode('baseIno', baseIno);
    this.storage.sql.exec(
      `INSERT INTO fs_origin(delta_ino, base_ino) VALUES (?, ?)
       ON CONFLICT(delta_ino) DO UPDATE SET base_ino = excluded.base_ino`,
      deltaIno,
      baseIno,
    );
  }

  getOrigin(deltaIno: number): number | undefined {
    validateInode('deltaIno', deltaIno);
    return this.storage.sql.exec<{ base_ino: number }>(
      'SELECT base_ino FROM fs_origin WHERE delta_ino = ?',
      deltaIno,
    ).toArray()[0]?.base_ino;
  }

  removeOrigin(deltaIno: number): void {
    this.storage.transactionSync(() => this.removeOriginSync(deltaIno));
  }

  private removeOriginSync(deltaIno: number): void {
    validateInode('deltaIno', deltaIno);
    this.storage.sql.exec('DELETE FROM fs_origin WHERE delta_ino = ?', deltaIno);
  }
}
