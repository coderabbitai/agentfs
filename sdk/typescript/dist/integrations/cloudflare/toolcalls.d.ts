import type { CloudflareStorage } from './agentfs.js';
import { type CloudflareTransactionViewCapability } from './transaction.js';
export type CloudflareToolCallOutcome = {
    readonly kind: 'success';
    readonly result: unknown;
} | {
    readonly kind: 'error';
    readonly error: string;
};
export interface CloudflareToolCallInput {
    readonly name: string;
    readonly parameters?: unknown;
    readonly outcome: CloudflareToolCallOutcome;
    readonly startedAt: number;
    readonly completedAt: number;
}
export interface CloudflareToolCall extends CloudflareToolCallInput {
    readonly id: number;
    readonly durationMs: number;
}
export interface CloudflareToolCallStats {
    readonly name: string;
    readonly totalCalls: number;
    readonly successful: number;
    readonly failed: number;
    readonly averageDurationMs: number;
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
    readonly sanitize?: CloudflareToolCallSanitizer;
}
/** Insert-only AgentFS tool-call storage over Durable Objects SQLite. */
export declare class CloudflareToolCalls implements CloudflareToolCallsTransaction {
    private readonly storage;
    private readonly sanitize;
    constructor(storage: CloudflareStorage, options?: CloudflareToolCallsOptions);
    private initialize;
    transactionView(capability: CloudflareTransactionViewCapability, assertOpen: () => void): CloudflareToolCallsTransaction;
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
