/**
 * Cloudflare Durable Objects integration for AgentFS.
 *
 * Provides AgentFS - a FileSystem implementation that uses
 * Cloudflare Durable Objects SQLite storage as its backend.
 *
 * @example
 * ```typescript
 * import { AgentFS } from "agentfs-sdk/cloudflare";
 *
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
 *
 * @see https://developers.cloudflare.com/durable-objects/
 */
export { AgentFS, type CloudflareAgentFSTransaction, type CloudflareStorage, } from "./agentfs.js";
export { CloudflareKvStore, type CloudflareKvEntry, type CloudflareKvTransaction, } from "./kvstore.js";
export { CloudflareOverlayMetadata, type CloudflareOverlayTransaction, } from "./overlay.js";
export { CloudflareToolCalls, type CloudflareToolCall, type CloudflareToolCallInput, type CloudflareToolCallOutcome, type CloudflareToolCallsTransaction, type CloudflareToolCallStats, } from "./toolcalls.js";
export type { FileSystem, Stats, DirEntry, FilesystemStats, FileHandle, } from "../../filesystem/interface.js";
