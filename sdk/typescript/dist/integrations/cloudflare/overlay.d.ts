import type { CloudflareStorage } from './agentfs.js';
export interface CloudflareOverlayTransaction {
    createWhiteout(path: string, createdAt?: number): void;
    removeWhiteout(path: string): void;
    setOrigin(deltaIno: number, baseIno: number): void;
    removeOrigin(deltaIno: number): void;
}
/** AgentFS overlay whiteout and copy-up origin metadata over Durable Objects SQLite. */
export declare class CloudflareOverlayMetadata implements CloudflareOverlayTransaction {
    private readonly storage;
    constructor(storage: CloudflareStorage);
    private initialize;
    transactionView(assertOpen?: () => void): CloudflareOverlayTransaction;
    createWhiteout(path: string, createdAt?: number): void;
    private createWhiteoutSync;
    removeWhiteout(path: string): void;
    private removeWhiteoutSync;
    isWhiteout(path: string): boolean;
    listChildWhiteouts(path: string): string[];
    setOrigin(deltaIno: number, baseIno: number): void;
    private setOriginSync;
    getOrigin(deltaIno: number): number | undefined;
    removeOrigin(deltaIno: number): void;
    private removeOriginSync;
}
