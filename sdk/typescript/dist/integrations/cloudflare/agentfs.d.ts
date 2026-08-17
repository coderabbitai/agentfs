/**
 * AgentFS - FileSystem implementation using Cloudflare Durable Objects SQLite
 *
 * This implementation uses Cloudflare's Durable Objects SQLite storage API,
 * allowing AgentFS to run on Cloudflare's edge platform.
 *
 * @see https://developers.cloudflare.com/durable-objects/api/sqlite-storage-api/
 */
import { type Stats, type DirEntry, type FilesystemStats, type FileHandle, type FileSystem } from '../../filesystem/interface.js';
/**
 * Cloudflare Durable Objects SqlStorage cursor interface
 */
interface SqlStorageCursor<T = Record<string, unknown>> {
    toArray(): T[];
    one(): T;
    raw(): IterableIterator<unknown[]>;
    readonly columnNames: string[];
    readonly rowsRead: number;
    readonly rowsWritten: number;
    next(): {
        done: boolean;
        value?: T;
    };
    [Symbol.iterator](): IterableIterator<T>;
}
/**
 * Cloudflare Durable Objects SqlStorage interface
 */
interface SqlStorage {
    exec<T = Record<string, unknown>>(query: string, ...bindings: unknown[]): SqlStorageCursor<T>;
    readonly databaseSize: number;
}
/**
 * Cloudflare Durable Objects Storage interface (subset we need)
 */
export interface CloudflareStorage {
    readonly sql: SqlStorage;
    transactionSync<T>(callback: () => T): T;
}
/**
 * Synchronous mutation surface used inside one caller-owned SQLite
 * transaction. Methods on this object never open a nested transaction.
 */
export interface CloudflareAgentFSTransaction {
    writeFile(path: string, content: string | Buffer, options?: BufferEncoding | {
        encoding?: BufferEncoding;
    }): void;
    unlink(path: string): void;
    rm(path: string, options?: {
        force?: boolean;
        recursive?: boolean;
    }): void;
    rename(oldPath: string, newPath: string): void;
    truncate(path: string, newSize: number): void;
}
/**
 * A filesystem backed by Cloudflare Durable Objects SQLite storage.
 *
 * AgentFS implements the FileSystem interface using Cloudflare's
 * Durable Objects SQLite storage as the backing store.
 *
 * @example
 * ```typescript
 * // In a Durable Object class
 * export class MyDurableObject extends DurableObject {
 *   private fs: AgentFS;
 *
 *   constructor(ctx: DurableObjectState, env: Env) {
 *     super(ctx, env);
 *     this.fs = AgentFS.create(ctx.storage);
 *   }
 *
 *   async fetch(request: Request) {
 *     await this.fs.writeFile('/hello.txt', 'Hello, World!');
 *     const content = await this.fs.readFile('/hello.txt', 'utf8');
 *     return new Response(content);
 *   }
 * }
 * ```
 */
export declare class AgentFS implements FileSystem {
    private storage;
    private rootIno;
    private chunkSize;
    private constructor();
    /**
     * Create a AgentFS from a Durable Object storage context.
     *
     * @param storage - The ctx.storage from a Durable Object
     */
    static create(storage: CloudflareStorage): AgentFS;
    getChunkSize(): number;
    /**
     * Runs AgentFS mutations in one caller-owned storage transaction.
     *
     * The transaction object is synchronous by construction so a mutation
     * failure is thrown before the storage callback returns and can roll back
     * application tables changed in the same callback.
     */
    transactionSync<T>(callback: (transaction: CloudflareAgentFSTransaction) => T): T;
    private initialize;
    private ensureRoot;
    private normalizePath;
    private splitPath;
    private resolvePath;
    private resolvePathOrThrow;
    private resolveParent;
    private createInode;
    private createDentry;
    private ensureParentDirs;
    private getLinkCount;
    private getInodeMode;
    writeFile(path: string, content: string | Buffer, options?: BufferEncoding | {
        encoding?: BufferEncoding;
    }): Promise<void>;
    private writeFileSync;
    private updateFileContent;
    readFile(path: string): Promise<Buffer>;
    readFile(path: string, encoding: BufferEncoding): Promise<string>;
    readFile(path: string, options: {
        encoding: BufferEncoding;
    }): Promise<string>;
    readdir(path: string): Promise<string[]>;
    readdirPlus(path: string): Promise<DirEntry[]>;
    stat(path: string): Promise<Stats>;
    lstat(path: string): Promise<Stats>;
    mkdir(path: string): Promise<void>;
    rmdir(path: string): Promise<void>;
    unlink(path: string): Promise<void>;
    private unlinkSync;
    rm(path: string, options?: {
        force?: boolean;
        recursive?: boolean;
    }): Promise<void>;
    private rmSync;
    private rmDirContentsRecursive;
    private removeDentryAndMaybeInode;
    rename(oldPath: string, newPath: string): Promise<void>;
    private renameSync;
    private truncateSync;
    copyFile(src: string, dest: string): Promise<void>;
    symlink(target: string, linkpath: string): Promise<void>;
    readlink(path: string): Promise<string>;
    access(path: string): Promise<void>;
    statfs(): Promise<FilesystemStats>;
    open(path: string): Promise<FileHandle>;
    deleteFile(path: string): Promise<void>;
}
export {};
