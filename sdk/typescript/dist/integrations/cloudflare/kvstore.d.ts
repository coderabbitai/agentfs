import type { CloudflareStorage } from './agentfs.js';
import { type CloudflareTransactionViewCapability } from './transaction.js';
export interface CloudflareKvEntry<T = unknown> {
    key: string;
    value: T;
}
export interface CloudflareKvTransaction {
    set(key: string, value: unknown): void;
    get(key: string): unknown | undefined;
    list(prefix: string): CloudflareKvEntry[];
    delete(key: string): void;
}
/** AgentFS KV storage over the caller's Durable Objects SQLite database. */
export declare class CloudflareKvStore implements CloudflareKvTransaction {
    private readonly storage;
    constructor(storage: CloudflareStorage);
    private initialize;
    transactionView(capability: CloudflareTransactionViewCapability, assertOpen: () => void): CloudflareKvTransaction;
    set(key: string, value: unknown): void;
    private setSync;
    get(key: string): unknown | undefined;
    list(prefix: string): CloudflareKvEntry[];
    delete(key: string): void;
    private deleteSync;
}
