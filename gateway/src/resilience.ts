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
export async function withTimeout<T>(
  fn: () => Promise<T>,
  timeoutMs: number,
  label: string
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
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

/* ------------------------------------------------------------------ */
/*  Retry                                                              */
/* ------------------------------------------------------------------ */

type RetryOptions = {
  /** Max number of retry attempts (0 = no retries). Default: 2 */
  maxRetries?: number;
  /** Base delay between retries in ms. Default: 500 */
  baseDelayMs?: number;
  /** Whether to use exponential backoff. Default: true */
  exponential?: boolean;
  /** Only retry if this predicate returns true for the error. Default: always retry */
  retryIf?: (err: unknown) => boolean;
};

const DEFAULT_RETRY: Required<RetryOptions> = {
  maxRetries: 2,
  baseDelayMs: 500,
  exponential: true,
  retryIf: () => true,
};

/**
 * Retry a function with configurable backoff.
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  label: string,
  options?: RetryOptions
): Promise<T> {
  const opts = { ...DEFAULT_RETRY, ...options };
  let lastError: unknown;

  for (let attempt = 0; attempt <= opts.maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;

      if (attempt >= opts.maxRetries || !opts.retryIf(err)) {
        break;
      }

      const delay = opts.exponential
        ? opts.baseDelayMs * Math.pow(2, attempt)
        : opts.baseDelayMs;

      console.log(
        `  [resilience] ${label}: attempt ${attempt + 1} failed, retrying in ${delay}ms...`
      );
      await sleep(delay);
    }
  }

  throw lastError;
}

/* ------------------------------------------------------------------ */
/*  Circuit Breaker                                                    */
/* ------------------------------------------------------------------ */

type CircuitBreakerOptions = {
  /** Number of consecutive failures to trip the breaker. Default: 5 */
  failureThreshold?: number;
  /** Time in ms to keep the circuit open before trying again. Default: 30000 (30s) */
  resetTimeoutMs?: number;
};

type CircuitState = "closed" | "open" | "half-open";

export class CircuitBreaker {
  private state: CircuitState = "closed";
  private failureCount = 0;
  private lastFailureTime = 0;
  private readonly failureThreshold: number;
  private readonly resetTimeoutMs: number;
  public readonly name: string;

  constructor(name: string, options?: CircuitBreakerOptions) {
    this.name = name;
    this.failureThreshold = options?.failureThreshold ?? 5;
    this.resetTimeoutMs = options?.resetTimeoutMs ?? 30_000;
  }

  /**
   * Execute a function through the circuit breaker.
   * Throws immediately if the circuit is open.
   */
  async execute<T>(fn: () => Promise<T>): Promise<T> {
    if (this.state === "open") {
      // Check if enough time has passed to try again
      if (Date.now() - this.lastFailureTime >= this.resetTimeoutMs) {
        this.state = "half-open";
        console.log(`  [circuit] ${this.name}: half-open, testing...`);
      } else {
        const remainingMs =
          this.resetTimeoutMs - (Date.now() - this.lastFailureTime);
        throw new Error(
          `Circuit breaker open for "${this.name}". Retry in ${Math.ceil(remainingMs / 1000)}s.`
        );
      }
    }

    try {
      const result = await fn();
      this.onSuccess();
      return result;
    } catch (err) {
      this.onFailure();
      throw err;
    }
  }

  private onSuccess(): void {
    if (this.state === "half-open") {
      console.log(`  [circuit] ${this.name}: closed (recovered)`);
    }
    this.failureCount = 0;
    this.state = "closed";
  }

  private onFailure(): void {
    this.failureCount++;
    this.lastFailureTime = Date.now();

    if (
      this.failureCount >= this.failureThreshold ||
      this.state === "half-open"
    ) {
      this.state = "open";
      console.log(
        `  [circuit] ${this.name}: OPEN after ${this.failureCount} failures. Will retry in ${this.resetTimeoutMs / 1000}s.`
      );
    }
  }

  /** Current state of the circuit. */
  getState(): { state: CircuitState; failures: number } {
    // Auto-transition from open to half-open if timeout elapsed
    if (
      this.state === "open" &&
      Date.now() - this.lastFailureTime >= this.resetTimeoutMs
    ) {
      this.state = "half-open";
    }
    return { state: this.state, failures: this.failureCount };
  }

}

/* ------------------------------------------------------------------ */
/*  Utilities                                                          */
/* ------------------------------------------------------------------ */

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
