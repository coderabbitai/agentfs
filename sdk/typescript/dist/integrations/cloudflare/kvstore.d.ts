import type { CloudflareStorage } from './agentfs.js';
export interface CloudflareKvEntry<T = unknown> {
    key: string;
    value: T;
}
export interface CloudflareKvTransaction {
    set(key: string, value: unknown): void;
    get<T = unknown>(key: string): T | undefined;
    list<T = unknown>(prefix: string): CloudflareKvEntry<T>[];
    delete(key: string): void;
}
/** AgentFS KV storage over the caller's Durable Objects SQLite database. */
export declare class CloudflareKvStore implements CloudflareKvTransaction {
    private readonly storage;
    constructor(storage: CloudflareStorage);
    private initialize;
    transactionView(): CloudflareKvTransaction;
    set(key: string, value: unknown): void;
    private setSync;
    get<T = unknown>(key: string): T | undefined;
    list<T = unknown>(prefix: string): CloudflareKvEntry<T>[];
    delete(key: string): void;
    private deleteSync;
}
