import type { CloudflareStorage } from './agentfs.js';
export type CloudflareToolCallOutcome = {
    kind: 'success';
    result: unknown;
} | {
    kind: 'error';
    error: string;
};
export interface CloudflareToolCallInput {
    name: string;
    parameters?: unknown;
    outcome: CloudflareToolCallOutcome;
    startedAt: number;
    completedAt: number;
}
export interface CloudflareToolCall extends CloudflareToolCallInput {
    id: number;
    durationMs: number;
}
export interface CloudflareToolCallStats {
    name: string;
    totalCalls: number;
    successful: number;
    failed: number;
    averageDurationMs: number;
}
export interface CloudflareToolCallsTransaction {
    record(call: CloudflareToolCallInput): number;
}
export type CloudflareToolCallSanitizer = (field: 'parameters' | 'result', value: unknown) => unknown;
export interface CloudflareToolCallsOptions {
    /**
     * Runs immediately before parameters or successful results are serialized.
     * Applications that can receive secrets must supply their policy redactor.
     */
    sanitize?: CloudflareToolCallSanitizer;
}
/** Insert-only AgentFS tool-call storage over Durable Objects SQLite. */
export declare class CloudflareToolCalls implements CloudflareToolCallsTransaction {
    private readonly storage;
    private readonly sanitize;
    constructor(storage: CloudflareStorage, options?: CloudflareToolCallsOptions);
    private initialize;
    transactionView(assertOpen?: () => void): CloudflareToolCallsTransaction;
    record(call: CloudflareToolCallInput): number;
    private recordSync;
    get(id: number): CloudflareToolCall | undefined;
    getByName(name: string, limit?: number): CloudflareToolCall[];
    getRecent(since: number, limit?: number): CloudflareToolCall[];
    getStats(): CloudflareToolCallStats[];
    /**
     * Explicit retention/erasure path. Ordinary transaction views remain
     * insert-only; this method opens one transaction and enables deletion only
     * for its bounded maintenance statement.
     */
    purgeBefore(startedBefore: number): number;
    private fromRow;
    private outcomeFromRow;
}
