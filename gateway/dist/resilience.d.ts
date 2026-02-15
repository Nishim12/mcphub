/**
 * Resilience layer: timeouts, retries, and circuit breaker.
 *
 * Wraps upstream calls to prevent cascading failures and provide
 * predictable behavior when servers are slow or down.
 */
/**
 * Wrap a promise with a timeout. Rejects with a clear error on expiry.
 */
export declare function withTimeout<T>(fn: () => Promise<T>, timeoutMs: number, label: string): Promise<T>;
export type RetryOptions = {
    /** Max number of retry attempts (0 = no retries). Default: 2 */
    maxRetries?: number;
    /** Base delay between retries in ms. Default: 500 */
    baseDelayMs?: number;
    /** Whether to use exponential backoff. Default: true */
    exponential?: boolean;
    /** Only retry if this predicate returns true for the error. Default: always retry */
    retryIf?: (err: unknown) => boolean;
};
/**
 * Retry a function with configurable backoff.
 */
export declare function withRetry<T>(fn: () => Promise<T>, label: string, options?: RetryOptions): Promise<T>;
export type CircuitBreakerOptions = {
    /** Number of consecutive failures to trip the breaker. Default: 5 */
    failureThreshold?: number;
    /** Time in ms to keep the circuit open before trying again. Default: 30000 (30s) */
    resetTimeoutMs?: number;
};
type CircuitState = "closed" | "open" | "half-open";
export declare class CircuitBreaker {
    private state;
    private failureCount;
    private lastFailureTime;
    private readonly failureThreshold;
    private readonly resetTimeoutMs;
    readonly name: string;
    constructor(name: string, options?: CircuitBreakerOptions);
    /**
     * Execute a function through the circuit breaker.
     * Throws immediately if the circuit is open.
     */
    execute<T>(fn: () => Promise<T>): Promise<T>;
    private onSuccess;
    private onFailure;
    /** Current state of the circuit. */
    getState(): {
        state: CircuitState;
        failures: number;
    };
    /** Manually reset the circuit breaker. */
    reset(): void;
}
export {};
