/**
 * Adapter that wraps @tursodatabase/serverless Connection to match
 * the DatabasePromise interface used by AgentFS internals.
 *
 * The core challenge: DatabasePromise.prepare() is synchronous and returns
 * a Statement immediately, but serverless Connection.prepare() is async
 * (it needs to fetch column metadata over HTTP).
 *
 * Solution: return a LazyStatement that defers the actual prepare() call
 * until run()/get()/all() is called — those are already async, so the
 * deferral is invisible to callers.
 *
 * Note on parameter passing: DatabasePromise's Statement uses rest params
 * (run(...args)), while serverless Statement uses a single array param
 * (run(args?)). The adapter collects rest params and forwards them as a
 * single array — this is correct and tested.
 */
import type { Connection } from "@tursodatabase/serverless";
import type { DatabasePromise } from "@tursodatabase/database-common";
/**
 * Wraps a @tursodatabase/serverless Connection to match
 * the DatabasePromise interface expected by AgentFS.openWith().
 *
 * @example
 * ```typescript
 * import { connect } from "@tursodatabase/serverless";
 * import { AgentFS } from "agentfs-sdk";
 * import { createServerlessAdapter } from "agentfs-sdk/serverless";
 *
 * const conn = connect({
 *   url: "http://localhost:8080",
 * });
 *
 * const db = createServerlessAdapter(conn);
 * const agent = await AgentFS.openWith(db);
 * ```
 */
export declare function createServerlessAdapter(conn: Connection): DatabasePromise;
