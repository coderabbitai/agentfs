import { AgentFSCore, AgentFSOptions } from "./agentfs.js";
import { DatabasePromise } from "@tursodatabase/database-common";
export declare class AgentFS extends AgentFSCore {
    /**
   * Open an agent filesystem
   * @param options Configuration options (id and/or path required)
   * @returns Fully initialized AgentFS instance
   * @example
   * ```typescript
   * // Using id (creates .agentfs/my-agent.db)
   * const agent = await AgentFS.open({ id: 'my-agent' });
   *
   * // Using id with custom path
   * const agent = await AgentFS.open({ id: 'my-agent', path: './data/mydb.db' });
   *
   * // Using path only
   * const agent = await AgentFS.open({ path: './data/mydb.db' });
   * ```
   */
    static open(options: AgentFSOptions): Promise<AgentFS>;
    static openWith(db: DatabasePromise): Promise<AgentFSCore>;
}
export { AgentFSOptions } from './agentfs.js';
export { KvStore } from './kvstore.js';
export { AgentFS as Filesystem } from './filesystem/index.js';
export type { Stats, DirEntry, FilesystemStats, FileHandle, FileSystem } from './filesystem/index.js';
export { ToolCalls } from './toolcalls.js';
export type { ToolCall, ToolCallStats } from './toolcalls.js';
