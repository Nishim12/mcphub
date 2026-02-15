/**
 * In-memory TTL cache for tools/list responses.
 *
 * Caches the merged tool list per-upstream so repeated tools/list calls
 * don't hit upstream servers every time. Dramatically reduces latency
 * for the most common MCP operation.
 */
export declare class Cache<T = unknown> {
    private store;
    private readonly ttlMs;
    /**
     * @param ttlSeconds Time-to-live in seconds. 0 = caching disabled.
     */
    constructor(ttlSeconds?: number);
    /** Get a cached value. Returns undefined on miss or expiry. */
    get(key: string): {
        data: T;
        hit: true;
    } | {
        data: undefined;
        hit: false;
    };
    /** Store a value in the cache. */
    set(key: string, data: T): void;
    /** Invalidate a specific key. */
    invalidate(key: string): void;
    /** Invalidate all entries. */
    clear(): void;
    /** Remove expired entries (housekeeping). */
    prune(): number;
    /** Current number of entries (including expired). */
    get size(): number;
    /** Whether caching is enabled (TTL > 0). */
    get enabled(): boolean;
}
