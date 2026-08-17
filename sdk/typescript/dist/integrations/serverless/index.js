/**
 * Serverless integration for AgentFS.
 *
 * Provides an adapter that wraps `@tursodatabase/serverless` Connection
 * to be compatible with AgentFS's DatabasePromise interface, enabling
 * AgentFS to work with remote Turso databases over HTTP.
 *
 * @example
 * ```typescript
 * import { connect } from "@tursodatabase/serverless";
 * import { AgentFS } from "agentfs-sdk";
 * import { createServerlessAdapter } from "agentfs-sdk/serverless";
 *
 * const conn = connect({
 *   url: process.env.TURSO_DATABASE_URL!,
 *   authToken: process.env.TURSO_AUTH_TOKEN,
 * });
 *
 * const db = createServerlessAdapter(conn);
 * const agent = await AgentFS.openWith(db);
 *
 * await agent.fs.writeFile("/hello.txt", "Hello from Turso Cloud!");
 * const content = await agent.fs.readFile("/hello.txt", "utf8");
 * console.log(content);
 *
 * await agent.close();
 * ```
 *
 * @see https://github.com/tursodatabase/agentfs/issues/156
 */
export { createServerlessAdapter } from "./adapter.js";
