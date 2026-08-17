import { AgentFSCore } from "./agentfs.js";
import { DatabasePromise } from "@tursodatabase/database-common";
export declare class AgentFS extends AgentFSCore {
    static openWith(db: DatabasePromise): Promise<AgentFSCore>;
}
export { AgentFSOptions } from './agentfs.js';
export { KvStore } from './kvstore.js';
export { AgentFS as Filesystem } from './filesystem/index.js';
export type { Stats, DirEntry, FilesystemStats, FileHandle, FileSystem } from './filesystem/index.js';
export { ToolCalls } from './toolcalls.js';
export type { ToolCall, ToolCallStats } from './toolcalls.js';
