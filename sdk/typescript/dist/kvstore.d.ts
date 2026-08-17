import type { DatabasePromise } from '@tursodatabase/database-common';
export declare class KvStore {
    private db;
    private constructor();
    /**
     * Create a KvStore from an existing database connection
     */
    static fromDatabase(db: DatabasePromise): Promise<KvStore>;
    private initialize;
    set(key: string, value: any): Promise<void>;
    get<T = any>(key: string): Promise<T | undefined>;
    list(prefix: string): Promise<{
        key: string;
        value: any;
    }[]>;
    delete(key: string): Promise<void>;
}
