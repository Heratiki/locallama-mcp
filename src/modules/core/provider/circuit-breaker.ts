/**
 * Circuit breaker for LLM providers (Issue 24).
 *
 * States:
 *   CLOSED   — normal; failures accumulate toward the threshold.
 *   OPEN     — provider is unavailable; calls are skipped.
 *   HALF_OPEN — one test call is allowed after the reset timeout elapses.
 *
 * The breaker transitions are:
 *   CLOSED  → OPEN      after failureThreshold consecutive failures.
 *   OPEN    → HALF_OPEN after resetTimeoutMs has elapsed.
 *   HALF_OPEN → CLOSED  on the next recorded success.
 *   HALF_OPEN → OPEN    on the next recorded failure.
 */

export const CircuitState = {
  CLOSED: 'CLOSED',
  OPEN: 'OPEN',
  HALF_OPEN: 'HALF_OPEN',
} as const;

export type CircuitState = (typeof CircuitState)[keyof typeof CircuitState];

export interface CircuitBreakerOptions {
  /** Number of consecutive failures before the circuit opens. Default: 3. */
  failureThreshold?: number;
  /** Milliseconds before an OPEN circuit transitions to HALF_OPEN. Default: 60 000. */
  resetTimeoutMs?: number;
}

interface BreakerEntry {
  state: CircuitState;
  failures: number;
  openedAt: number | undefined;
}

export class CircuitBreaker {
  private readonly failureThreshold: number;
  private readonly resetTimeoutMs: number;
  private readonly circuits = new Map<string, BreakerEntry>();

  constructor(options: CircuitBreakerOptions = {}) {
    this.failureThreshold = options.failureThreshold ?? 3;
    this.resetTimeoutMs = options.resetTimeoutMs ?? 60_000;
  }

  /** Returns the current logical state, checking for OPEN → HALF_OPEN transition. */
  getState(providerId: string): CircuitState {
    const entry = this.circuits.get(providerId);
    if (!entry) return CircuitState.CLOSED;

    if (entry.state === CircuitState.OPEN && entry.openedAt !== undefined) {
      if (Date.now() - entry.openedAt >= this.resetTimeoutMs) {
        entry.state = CircuitState.HALF_OPEN;
        this.circuits.set(providerId, entry);
        return CircuitState.HALF_OPEN;
      }
    }

    return entry.state;
  }

  /**
   * Returns true when a call to this provider should be allowed.
   * CLOSED and HALF_OPEN are both "available" (HALF_OPEN permits one probe).
   */
  isAvailable(providerId: string): boolean {
    return this.getState(providerId) !== CircuitState.OPEN;
  }

  /** Call this when a provider call (or health probe) succeeds. */
  recordSuccess(providerId: string): void {
    const current = this.getState(providerId);
    if (current === CircuitState.HALF_OPEN || current === CircuitState.OPEN) {
      // Transition back to healthy
      this.circuits.set(providerId, { state: CircuitState.CLOSED, failures: 0, openedAt: undefined });
    } else {
      // Reset failure counter in CLOSED
      const entry = this.circuits.get(providerId);
      if (entry) {
        entry.failures = 0;
        this.circuits.set(providerId, entry);
      }
    }
  }

  /** Call this when a provider call (or health probe) fails. */
  recordFailure(providerId: string): void {
    const current = this.getState(providerId);

    if (current === CircuitState.HALF_OPEN) {
      // Failure during a test call: re-open immediately
      const entry = this.circuits.get(providerId) ?? { state: CircuitState.CLOSED, failures: 0, openedAt: undefined };
      this.circuits.set(providerId, {
        state: CircuitState.OPEN,
        failures: entry.failures + 1,
        openedAt: Date.now(),
      });
      return;
    }

    const entry = this.circuits.get(providerId) ?? { state: CircuitState.CLOSED, failures: 0, openedAt: undefined };
    entry.failures += 1;

    if (entry.failures >= this.failureThreshold) {
      this.circuits.set(providerId, {
        state: CircuitState.OPEN,
        failures: entry.failures,
        openedAt: Date.now(),
      });
    } else {
      this.circuits.set(providerId, entry);
    }
  }

  /** Snapshot of all circuit entries — intended for diagnostics/tests. */
  snapshot(): ReadonlyMap<string, { state: CircuitState; failures: number; openedAt: number | undefined }> {
    return this.circuits;
  }
}
