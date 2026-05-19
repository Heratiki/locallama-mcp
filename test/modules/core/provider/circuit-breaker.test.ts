import { describe, expect, it, jest, beforeEach, afterEach } from '@jest/globals';

jest.unstable_mockModule('../../../../dist/utils/logger.js', () => ({
  logger: {
    error: jest.fn(),
    warn: jest.fn(),
    info: jest.fn(),
    debug: jest.fn(),
  },
}));

// Dynamic import so the logger mock is applied first.
const { CircuitBreaker, CircuitState } = await import(
  '../../../../dist/modules/core/provider/circuit-breaker.js'
);
const { ProviderRegistry } = await import(
  '../../../../dist/modules/core/provider/registry.js'
);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type CostClass = 'local' | 'free' | 'paid';

function makeProvider(id: string, available = true) {
  return {
    id,
    displayName: id,
    costClass: 'local' as CostClass,
    isLocal: true,
    init: jest.fn(() => Promise.resolve()),
    isAvailable: jest.fn(() => Promise.resolve(available)),
    listModels: jest.fn(() => Promise.resolve([])),
    supportsModel: jest.fn(() => false),
    executeTask: jest.fn(() => Promise.resolve({ content: 'ok', model: id })),
    getCost: jest.fn(() => ({ prompt: 0, completion: 0 })),
  };
}

// ---------------------------------------------------------------------------
// CircuitBreaker unit tests
// ---------------------------------------------------------------------------

describe('CircuitBreaker', () => {
  it('starts in CLOSED state for unknown providers', () => {
    const cb = new CircuitBreaker();
    expect(cb.getState('any')).toBe(CircuitState.CLOSED);
    expect(cb.isAvailable('any')).toBe(true);
  });

  it('CLOSED → OPEN after failureThreshold consecutive failures', () => {
    const cb = new CircuitBreaker({ failureThreshold: 3 });
    cb.recordFailure('p');
    expect(cb.getState('p')).toBe(CircuitState.CLOSED);
    cb.recordFailure('p');
    expect(cb.getState('p')).toBe(CircuitState.CLOSED);
    cb.recordFailure('p');
    expect(cb.getState('p')).toBe(CircuitState.OPEN);
    expect(cb.isAvailable('p')).toBe(false);
  });

  it('OPEN → HALF_OPEN after resetTimeoutMs elapses (mock Date.now)', () => {
    const cb = new CircuitBreaker({ failureThreshold: 1, resetTimeoutMs: 5_000 });
    cb.recordFailure('p');
    expect(cb.getState('p')).toBe(CircuitState.OPEN);

    // Advance time past the reset timeout.
    const realNow = Date.now;
    const frozen = realNow() + 6_000;
    Date.now = () => frozen;
    try {
      expect(cb.getState('p')).toBe(CircuitState.HALF_OPEN);
      expect(cb.isAvailable('p')).toBe(true); // HALF_OPEN is allowed
    } finally {
      Date.now = realNow;
    }
  });

  it('HALF_OPEN → CLOSED on success', () => {
    const cb = new CircuitBreaker({ failureThreshold: 1, resetTimeoutMs: 1 });
    cb.recordFailure('p');

    const realNow = Date.now;
    Date.now = () => realNow() + 1_000;
    try {
      expect(cb.getState('p')).toBe(CircuitState.HALF_OPEN);
      cb.recordSuccess('p');
      expect(cb.getState('p')).toBe(CircuitState.CLOSED);
      expect(cb.isAvailable('p')).toBe(true);
    } finally {
      Date.now = realNow;
    }
  });

  it('HALF_OPEN → OPEN on failure', () => {
    const cb = new CircuitBreaker({ failureThreshold: 1, resetTimeoutMs: 1 });
    cb.recordFailure('p');

    const realNow = Date.now;
    Date.now = () => realNow() + 1_000;
    try {
      expect(cb.getState('p')).toBe(CircuitState.HALF_OPEN);
      cb.recordFailure('p');
      // Must be back to OPEN — time still advanced so we need to check without
      // further advancement.
      const stateAfter = cb.getState('p');
      // The openedAt was just refreshed, so within the same frozen instant it
      // is still OPEN (< resetTimeoutMs elapsed since the second opening).
      expect(stateAfter).toBe(CircuitState.OPEN);
      expect(cb.isAvailable('p')).toBe(false);
    } finally {
      Date.now = realNow;
    }
  });

  it('success in CLOSED resets failure counter', () => {
    const cb = new CircuitBreaker({ failureThreshold: 3 });
    cb.recordFailure('p');
    cb.recordFailure('p');
    cb.recordSuccess('p'); // reset
    cb.recordFailure('p'); // starts fresh count
    cb.recordFailure('p');
    expect(cb.getState('p')).toBe(CircuitState.CLOSED); // still only 2 failures
    cb.recordFailure('p');
    expect(cb.getState('p')).toBe(CircuitState.OPEN);
  });

  it('independent providers have independent circuits', () => {
    const cb = new CircuitBreaker({ failureThreshold: 2 });
    cb.recordFailure('a');
    cb.recordFailure('a');
    expect(cb.getState('a')).toBe(CircuitState.OPEN);
    expect(cb.getState('b')).toBe(CircuitState.CLOSED);
  });
});

// ---------------------------------------------------------------------------
// ProviderRegistry circuit breaker integration
// ---------------------------------------------------------------------------

describe('ProviderRegistry — circuit breaker integration', () => {
  let registry: InstanceType<typeof ProviderRegistry>;

  beforeEach(() => {
    registry = new ProviderRegistry();
  });

  afterEach(() => {
    registry.clear();
  });

  it('isAvailable returns true for an unknown provider (no failures)', () => {
    expect(registry.isAvailable('ghost')).toBe(true);
  });

  it('isAvailable returns false after N recorded failures', () => {
    const p = makeProvider('p1');
    registry.register(p);
    registry.recordProviderFailure('p1');
    registry.recordProviderFailure('p1');
    expect(registry.isAvailable('p1')).toBe(true); // 2 failures, threshold=3
    registry.recordProviderFailure('p1');
    expect(registry.isAvailable('p1')).toBe(false); // circuit open
  });

  it('isAvailable returns true again after recordProviderSuccess from HALF_OPEN', () => {
    const p = makeProvider('p2');
    registry.register(p);

    // Open the circuit
    registry.recordProviderFailure('p2');
    registry.recordProviderFailure('p2');
    registry.recordProviderFailure('p2');
    expect(registry.isAvailable('p2')).toBe(false);

    // Simulate time advancing past reset timeout by mocking Date.now
    const realNow = Date.now;
    Date.now = () => realNow() + 70_000; // default resetTimeoutMs is 60 s
    try {
      expect(registry.isAvailable('p2')).toBe(true); // HALF_OPEN
      registry.recordProviderSuccess('p2');
      expect(registry.isAvailable('p2')).toBe(true); // CLOSED
    } finally {
      Date.now = realNow;
    }
  });
});

// ---------------------------------------------------------------------------
// Health probe tests
// ---------------------------------------------------------------------------

describe('ProviderRegistry — health probe (Issue 26)', () => {
  let registry: InstanceType<typeof ProviderRegistry>;

  beforeEach(() => {
    registry = new ProviderRegistry();
    jest.useFakeTimers();
  });

  afterEach(() => {
    registry.stopHealthProbe();
    registry.clear();
    jest.useRealTimers();
  });

  it('calls isAvailable() on each registered provider when probe fires', async () => {
    const p1 = makeProvider('pA', true);
    const p2 = makeProvider('pB', false);
    registry.register(p1);
    registry.register(p2);

    registry.startHealthProbe(500);

    // Fire one interval tick and let the async probe run.
    jest.advanceTimersByTime(500);
    await Promise.resolve(); // flush microtasks
    await Promise.resolve();
    await Promise.resolve();

    expect(p1.isAvailable).toHaveBeenCalledTimes(1);
    expect(p2.isAvailable).toHaveBeenCalledTimes(1);
  });

  it('opens circuit for providers that report unavailable during probe', async () => {
    const p = makeProvider('pC', false);
    registry.register(p);

    // Override the internal circuit-breaker threshold to 1 to make the test
    // deterministic without many probe ticks.
    const cb = new CircuitBreaker({ failureThreshold: 1 });
    // Expose via recordProviderFailure which delegates to the internal cb;
    // instead we drive through the probe which calls recordFailure internally.
    // We run enough probe ticks to exceed the default threshold of 3.
    registry.startHealthProbe(100);

    for (let i = 0; i < 3; i++) {
      jest.advanceTimersByTime(100);
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    }

    expect(registry.isAvailable('pC')).toBe(false);
    void cb; // silence unused-var lint
  });

  it('stopHealthProbe prevents further isAvailable calls', async () => {
    const p = makeProvider('pD', true);
    registry.register(p);

    registry.startHealthProbe(200);
    jest.advanceTimersByTime(200);
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    const callsAfterFirstTick = (p.isAvailable as ReturnType<typeof jest.fn>).mock.calls.length;

    registry.stopHealthProbe();

    jest.advanceTimersByTime(600);
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    expect((p.isAvailable as ReturnType<typeof jest.fn>).mock.calls.length).toBe(callsAfterFirstTick);
  });

  it('calling startHealthProbe twice does not create multiple timers', async () => {
    const p = makeProvider('pE', true);
    registry.register(p);

    registry.startHealthProbe(300);
    registry.startHealthProbe(300); // should be a no-op

    jest.advanceTimersByTime(300);
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    // Only one probe tick should have fired (not two).
    expect((p.isAvailable as ReturnType<typeof jest.fn>).mock.calls.length).toBe(1);
  });

  it('opens the circuit after threshold failures observed by health probe', async () => {
    const p = makeProvider('p-threshold', false);
    registry.register(p);

    registry.startHealthProbe(100);

    // Default threshold is 3 failures.
    for (let i = 0; i < 3; i++) {
      jest.advanceTimersByTime(100);
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    }

    expect(registry.isAvailable('p-threshold')).toBe(false);
  });

  it('resets an open circuit after a successful health probe', async () => {
    const p = makeProvider('p-recover', false);
    registry.register(p);

    registry.startHealthProbe(100);

    // Open circuit first.
    for (let i = 0; i < 3; i++) {
      jest.advanceTimersByTime(100);
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    }
    expect(registry.isAvailable('p-recover')).toBe(false);

    // Health probe starts reporting success.
    p.isAvailable.mockResolvedValue(true);
    jest.advanceTimersByTime(100);
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    expect(registry.isAvailable('p-recover')).toBe(true);
  });
});
