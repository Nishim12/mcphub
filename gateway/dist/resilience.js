/**
 * Resilience layer: timeouts, retries, and circuit breaker.
 *
 * Wraps upstream calls to prevent cascading failures and provide
 * predictable behavior when servers are slow or down.
 */
/* ------------------------------------------------------------------ */
/*  Timeout                                                            */
/* ------------------------------------------------------------------ */
/**
 * Wrap a promise with a timeout. Rejects with a clear error on expiry.
 */
export async function withTimeout(fn, timeoutMs, label) {
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
            reject(new Error(`Timeout after ${timeoutMs}ms: ${label}`));
        }, timeoutMs);
        fn()
            .then((result) => {
            clearTimeout(timer);
            resolve(result);
        })
            .catch((err) => {
            clearTimeout(timer);
            reject(err);
        });
    });
}
const DEFAULT_RETRY = {
    maxRetries: 2,
    baseDelayMs: 500,
    exponential: true,
    retryIf: () => true,
};
/**
 * Retry a function with configurable backoff.
 */
export async function withRetry(fn, label, options) {
    const opts = { ...DEFAULT_RETRY, ...options };
    let lastError;
    for (let attempt = 0; attempt <= opts.maxRetries; attempt++) {
        try {
            return await fn();
        }
        catch (err) {
            lastError = err;
            if (attempt >= opts.maxRetries || !opts.retryIf(err)) {
                break;
            }
            const delay = opts.exponential
                ? opts.baseDelayMs * Math.pow(2, attempt)
                : opts.baseDelayMs;
            console.log(`  [resilience] ${label}: attempt ${attempt + 1} failed, retrying in ${delay}ms...`);
            await sleep(delay);
        }
    }
    throw lastError;
}
export class CircuitBreaker {
    state = "closed";
    failureCount = 0;
    lastFailureTime = 0;
    failureThreshold;
    resetTimeoutMs;
    name;
    constructor(name, options) {
        this.name = name;
        this.failureThreshold = options?.failureThreshold ?? 5;
        this.resetTimeoutMs = options?.resetTimeoutMs ?? 30_000;
    }
    /**
     * Execute a function through the circuit breaker.
     * Throws immediately if the circuit is open.
     */
    async execute(fn) {
        if (this.state === "open") {
            // Check if enough time has passed to try again
            if (Date.now() - this.lastFailureTime >= this.resetTimeoutMs) {
                this.state = "half-open";
                console.log(`  [circuit] ${this.name}: half-open, testing...`);
            }
            else {
                const remainingMs = this.resetTimeoutMs - (Date.now() - this.lastFailureTime);
                throw new Error(`Circuit breaker open for "${this.name}". Retry in ${Math.ceil(remainingMs / 1000)}s.`);
            }
        }
        try {
            const result = await fn();
            this.onSuccess();
            return result;
        }
        catch (err) {
            this.onFailure();
            throw err;
        }
    }
    onSuccess() {
        if (this.state === "half-open") {
            console.log(`  [circuit] ${this.name}: closed (recovered)`);
        }
        this.failureCount = 0;
        this.state = "closed";
    }
    onFailure() {
        this.failureCount++;
        this.lastFailureTime = Date.now();
        if (this.failureCount >= this.failureThreshold ||
            this.state === "half-open") {
            this.state = "open";
            console.log(`  [circuit] ${this.name}: OPEN after ${this.failureCount} failures. Will retry in ${this.resetTimeoutMs / 1000}s.`);
        }
    }
    /** Current state of the circuit. */
    getState() {
        // Auto-transition from open to half-open if timeout elapsed
        if (this.state === "open" &&
            Date.now() - this.lastFailureTime >= this.resetTimeoutMs) {
            this.state = "half-open";
        }
        return { state: this.state, failures: this.failureCount };
    }
}
/* ------------------------------------------------------------------ */
/*  Utilities                                                          */
/* ------------------------------------------------------------------ */
function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}
