import type { DatabasePromise } from '@tursodatabase/database-common';
import { type Stats, type DirEntry, type FilesystemStats, type FileHandle, type FileSystem } from './interface.js';
/**
 * A filesystem backed by SQLite, implementing the FileSystem interface.
 */
export declare class AgentFS implements FileSystem {
    private db;
    private bufferCtor;
    private rootIno;
    private chunkSize;
    private constructor();
    static fromDatabase(db: DatabasePromise, b?: BufferConstructor): Promise<AgentFS>;
    getChunkSize(): number;
    private initialize;
    private ensureRoot;
    private normalizePath;
    private splitPath;
    private resolvePathOrThrow;
    private resolvePath;
    private resolveParent;
    private createInode;
    private createDentry;
    private ensureParentDirs;
    private getLinkCount;
    private getInodeMode;
    writeFile(path: string, content: string | Buffer, options?: BufferEncoding | {
        encoding?: BufferEncoding;
    }): Promise<void>;
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
    rm(path: string, options?: {
        force?: boolean;
        recursive?: boolean;
    }): Promise<void>;
    private rmDirContentsRecursive;
    private removeDentryAndMaybeInode;
    rename(oldPath: string, newPath: string): Promise<void>;
    copyFile(src: string, dest: string): Promise<void>;
    symlink(target: string, linkpath: string): Promise<void>;
    readlink(path: string): Promise<string>;
    access(path: string): Promise<void>;
    statfs(): Promise<FilesystemStats>;
    open(path: string): Promise<FileHandle>;
    deleteFile(path: string): Promise<void>;
}
