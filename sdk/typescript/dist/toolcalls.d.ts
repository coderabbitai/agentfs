import type { DatabasePromise } from '@tursodatabase/database-common';
export interface ToolCall {
    id: number;
    name: string;
    parameters?: any;
    result?: any;
    error?: string;
    status: 'pending' | 'success' | 'error';
    started_at: number;
    completed_at?: number;
    duration_ms?: number;
}
export interface ToolCallStats {
    name: string;
    total_calls: number;
    successful: number;
    failed: number;
    avg_duration_ms: number;
}
export declare class ToolCalls {
    private db;
    private constructor();
    /**
     * Create a ToolCalls from an existing database connection
     */
    static fromDatabase(db: DatabasePromise): Promise<ToolCalls>;
    private initialize;
    /**
     * Start a new tool call and mark it as pending
     * Returns the ID of the created tool call record
     */
    start(name: string, parameters?: any): Promise<number>;
    /**
     * Mark a tool call as successful
     */
    success(id: number, result?: any): Promise<void>;
    /**
     * Mark a tool call as failed
     */
    error(id: number, error: string): Promise<void>;
    /**
     * Record a completed tool call
     * Either result or error should be provided, not both
     * Returns the ID of the created tool call record
     */
    record(name: string, started_at: number, completed_at: number, parameters?: any, result?: any, error?: string): Promise<number>;
    /**
     * Get a specific tool call by ID
     */
    get(id: number): Promise<ToolCall | undefined>;
    /**
     * Query tool calls by name
     */
    getByName(name: string, limit?: number): Promise<ToolCall[]>;
    /**
     * Query recent tool calls
     */
    getRecent(since: number, limit?: number): Promise<ToolCall[]>;
    /**
     * Get performance statistics for all tools
     * Only includes completed calls (success or failed), not pending ones
     */
    getStats(): Promise<ToolCallStats[]>;
    /**
     * Helper to convert database row to ToolCall object
     */
    private rowToToolCall;
}
