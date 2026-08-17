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
/** Insert-only AgentFS tool-call storage over Durable Objects SQLite. */
export declare class CloudflareToolCalls implements CloudflareToolCallsTransaction {
    private readonly storage;
    constructor(storage: CloudflareStorage);
    private initialize;
    transactionView(): CloudflareToolCallsTransaction;
    record(call: CloudflareToolCallInput): number;
    private recordSync;
    get(id: number): CloudflareToolCall | undefined;
    getByName(name: string, limit?: number): CloudflareToolCall[];
    getRecent(since: number, limit?: number): CloudflareToolCall[];
    getStats(): CloudflareToolCallStats[];
    private fromRow;
}
