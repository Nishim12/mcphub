/**
 * In-memory TTL cache for tools/list responses.
 *
 * Caches the merged tool list per-upstream so repeated tools/list calls
 * don't hit upstream servers every time. Dramatically reduces latency
 * for the most common MCP operation.
 */
/* ------------------------------------------------------------------ */
/*  Cache                                                              */
/* ------------------------------------------------------------------ */
export class Cache {
    store = new Map();
    ttlMs;
    /**
     * @param ttlSeconds Time-to-live in seconds. 0 = caching disabled.
     */
    constructor(ttlSeconds = 60) {
        this.ttlMs = ttlSeconds * 1000;
    }
    /** Get a cached value. Returns undefined on miss or expiry. */
    get(key) {
        if (this.ttlMs <= 0)
            return { data: undefined, hit: false };
        const entry = this.store.get(key);
        if (!entry)
            return { data: undefined, hit: false };
        if (Date.now() > entry.expiresAt) {
            this.store.delete(key);
            return { data: undefined, hit: false };
        }
        return { data: entry.data, hit: true };
    }
    /** Store a value in the cache. */
    set(key, data) {
        if (this.ttlMs <= 0)
            return;
        this.store.set(key, {
            data,
            expiresAt: Date.now() + this.ttlMs,
            createdAt: Date.now(),
        });
    }
}
