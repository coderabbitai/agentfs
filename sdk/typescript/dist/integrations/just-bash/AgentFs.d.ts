/**
 * AgentFs - Read-write filesystem backed by any AgentFS FileSystem implementation
 *
 * Full read-write filesystem that persists to a SQLite database.
 * Designed for AI agents needing persistent, auditable file storage.
 *
 * Supports any FileSystem implementation:
 * - AgentFS (Turso/libsql) for Node.js and browser
 * - Cloudflare AgentFS (Durable Objects) for Cloudflare Workers
 *
 * @see https://docs.turso.tech/agentfs/sdk/typescript
 */
import type { FileSystem } from "../../filesystem/interface.js";
import { type AgentFSOptions } from "../../index_node.js";
import type { BufferEncoding, CpOptions, FsStat, IFileSystem, MkdirOptions, RmOptions } from "just-bash";
/** Options for reading files */
interface ReadFileOptions {
    encoding?: BufferEncoding | null;
}
/** Options for writing files */
interface WriteFileOptions {
    encoding?: BufferEncoding;
}
type FileContent = string | Uint8Array;
/**
 * Handle to any FileSystem implementation.
 * Can be from AgentFS.open() (Turso) or AgentFS.create() (Cloudflare).
 */
export interface AgentFsHandle {
    fs: FileSystem;
}
export interface AgentFsOptions {
    /**
     * The AgentFS handle containing a FileSystem implementation.
     */
    fs: AgentFsHandle;
    /**
     * The virtual mount point for the filesystem.
     * Defaults to "/".
     */
    mountPoint?: string;
}
export declare class AgentFsWrapper implements IFileSystem {
    private readonly agentFs;
    private readonly mountPoint;
    constructor(options: AgentFsOptions);
    /**
     * Get the mount point for this filesystem
     */
    getMountPoint(): string;
    /**
     * Normalize a virtual path (resolve . and .., ensure starts with /)
     */
    private normalizePath;
    /**
     * Convert virtual path to AgentFS path (strip mount point prefix)
     */
    private toAgentPath;
    private dirname;
    readFile(path: string, options?: ReadFileOptions | BufferEncoding): Promise<string>;
    readFileBuffer(path: string): Promise<Uint8Array>;
    writeFile(path: string, content: FileContent, options?: WriteFileOptions | BufferEncoding): Promise<void>;
    appendFile(path: string, content: FileContent, options?: WriteFileOptions | BufferEncoding): Promise<void>;
    exists(path: string): Promise<boolean>;
    stat(path: string): Promise<FsStat>;
    lstat(path: string): Promise<FsStat>;
    mkdir(path: string, options?: MkdirOptions): Promise<void>;
    readdir(path: string): Promise<string[]>;
    rm(path: string, options?: RmOptions): Promise<void>;
    cp(src: string, dest: string, options?: CpOptions): Promise<void>;
    mv(src: string, dest: string): Promise<void>;
    resolvePath(base: string, path: string): string;
    getAllPaths(): string[];
    chmod(path: string, mode: number): Promise<void>;
    symlink(target: string, linkPath: string): Promise<void>;
    link(existingPath: string, newPath: string): Promise<void>;
    readlink(path: string): Promise<string>;
}
/**
 * Create a just-bash compatible filesystem backed by any AgentFS FileSystem.
 *
 * @example Node.js with Turso:
 * ```ts
 * import { agentfs } from "agentfs-sdk/just-bash";
 *
 * const fs = await agentfs({ path: "agent.db" });
 * const bashTool = createBashTool({ fs });
 * ```
 *
 * @example Cloudflare Workers:
 * ```ts
 * import { agentfs } from "agentfs-sdk/just-bash";
 * import { AgentFS } from "agentfs-sdk/cloudflare";
 *
 * // In a Durable Object:
 * const agentFs = AgentFS.create(ctx.storage);
 * const fs = agentfs({ fs: agentFs });
 * const bashTool = createBashTool({ fs });
 * ```
 */
export declare function agentfs(handleOrOptions: AgentFsHandle | FileSystem | AgentFSOptions, mountPoint?: string): Promise<IFileSystem>;
export {};
