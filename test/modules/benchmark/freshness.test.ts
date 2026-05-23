import { describe, expect, it, jest, beforeEach } from '@jest/globals';

// Mocks must be registered before any dynamic import of dist/ modules.

jest.unstable_mockModule('../../../dist/utils/logger.js', () => ({
  logger: {
    error: jest.fn(),
    warn: jest.fn(),
    info: jest.fn(),
    debug: jest.fn(),
  },
}));

const getModelMock = jest.fn();

jest.unstable_mockModule('../../../dist/modules/core/model/index.js', () => ({
  getModelRegistry: () => ({ getModel: getModelMock }),
  ModelRegistry: jest.fn(),
}));

const benchmarkModelMock = jest.fn();

jest.unstable_mockModule('../../../dist/modules/benchmark/core/model-benchmarker.js', () => ({
  benchmarkModel: benchmarkModelMock,
}));

const { benchmarkFreshnessService } = await import(
  '../../../dist/modules/benchmark/core/freshness.js'
);

const ONE_HOUR_MS = 3_600_000;
const TTL_24H = 24 * ONE_HOUR_MS;

describe('benchmarkFreshnessService.check', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    benchmarkFreshnessService.clearBackoff('test-model');
  });

  it('returns missing when model is not in registry', () => {
    getModelMock.mockReturnValue(undefined);

    const result = benchmarkFreshnessService.check('test-model', TTL_24H);

    expect(result.status).toBe('missing');
    expect(result.reason).toBe('benchmark_missing');
    expect(result.lastRunAt).toBeUndefined();
  });

  it('returns missing when model has no benchmarkSummary', () => {
    getModelMock.mockReturnValue({ id: 'test-model', benchmarkSummary: undefined });

    const result = benchmarkFreshnessService.check('test-model', TTL_24H);

    expect(result.status).toBe('missing');
    expect(result.reason).toBe('benchmark_missing');
  });

  it('returns fresh when benchmark ran within the TTL window', () => {
    const recentRunAt = Date.now() - ONE_HOUR_MS; // 1 hour ago, within 24h TTL
    getModelMock.mockReturnValue({
      id: 'test-model',
      benchmarkSummary: { lastRunAt: recentRunAt, taskCategories: ['code'], scores: {} },
    });

    const result = benchmarkFreshnessService.check('test-model', TTL_24H);

    expect(result.status).toBe('fresh');
    expect(result.reason).toBe('benchmark_fresh');
    expect(result.lastRunAt).toBe(recentRunAt);
  });

  it('returns stale when benchmark ran before the TTL window', () => {
    const staleRunAt = Date.now() - 25 * ONE_HOUR_MS; // 25 hours ago, beyond 24h TTL
    getModelMock.mockReturnValue({
      id: 'test-model',
      benchmarkSummary: { lastRunAt: staleRunAt, taskCategories: ['code'], scores: {} },
    });

    const result = benchmarkFreshnessService.check('test-model', TTL_24H);

    expect(result.status).toBe('stale');
    expect(result.reason).toBe('benchmark_stale');
    expect(result.lastRunAt).toBe(staleRunAt);
  });

  it('uses the TTL value passed in — shorter TTL makes recent data stale', () => {
    const runAt = Date.now() - 2 * ONE_HOUR_MS; // 2 hours ago
    getModelMock.mockReturnValue({
      id: 'test-model',
      benchmarkSummary: { lastRunAt: runAt, taskCategories: ['code'], scores: {} },
    });

    // With a 1-hour TTL the 2-hour-old data is stale
    const result = benchmarkFreshnessService.check('test-model', ONE_HOUR_MS);

    expect(result.status).toBe('stale');
  });
});

describe('benchmarkFreshnessService backoff', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    benchmarkFreshnessService.clearBackoff('test-model');
  });

  it('is not in backoff initially', () => {
    expect(benchmarkFreshnessService.isInBackoff('test-model')).toBe(false);
  });

  it('enters backoff after recordFailure', () => {
    benchmarkFreshnessService.recordFailure('test-model', 60_000);

    expect(benchmarkFreshnessService.isInBackoff('test-model')).toBe(true);
  });

  it('leaves backoff after clearBackoff', () => {
    benchmarkFreshnessService.recordFailure('test-model', 60_000);
    benchmarkFreshnessService.clearBackoff('test-model');

    expect(benchmarkFreshnessService.isInBackoff('test-model')).toBe(false);
  });

  it('is not in backoff when the backoff window has already expired', () => {
    // Negative backoff duration means the expiry is in the past
    benchmarkFreshnessService.recordFailure('test-model', -1);

    expect(benchmarkFreshnessService.isInBackoff('test-model')).toBe(false);
  });
});

describe('benchmarkFreshnessService.scheduleIfNeeded', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    benchmarkFreshnessService.clearBackoff('test-model');
  });

  it('returns false when benchmark is already fresh', () => {
    const recentRunAt = Date.now() - ONE_HOUR_MS;
    getModelMock.mockReturnValue({
      id: 'test-model',
      benchmarkSummary: { lastRunAt: recentRunAt, taskCategories: [], scores: {} },
    });

    const scheduled = benchmarkFreshnessService.scheduleIfNeeded('test-model', {
      ttlMs: TTL_24H,
    });

    expect(scheduled).toBe(false);
    expect(benchmarkModelMock).not.toHaveBeenCalled();
  });

  it('returns false and skips scheduling when model is in backoff', () => {
    benchmarkFreshnessService.recordFailure('test-model', 60_000);
    getModelMock.mockReturnValue(undefined);

    const scheduled = benchmarkFreshnessService.scheduleIfNeeded('test-model', {
      ttlMs: TTL_24H,
    });

    expect(scheduled).toBe(false);
  });

  it('returns true and triggers benchmark when benchmark is missing', async () => {
    getModelMock.mockReturnValue(undefined);
    benchmarkModelMock.mockResolvedValue({});

    const scheduled = benchmarkFreshnessService.scheduleIfNeeded('test-model', {
      ttlMs: TTL_24H,
    });

    expect(scheduled).toBe(true);

    // Drain microtasks so the fire-and-forget async call completes
    await new Promise<void>((resolve) => setTimeout(resolve, 0));

    expect(benchmarkModelMock).toHaveBeenCalledWith(
      expect.objectContaining({ modelId: 'test-model' }),
    );
  });

  it('returns true and triggers benchmark when benchmark is stale', async () => {
    const staleRunAt = Date.now() - 25 * ONE_HOUR_MS;
    getModelMock.mockReturnValue({
      id: 'test-model',
      benchmarkSummary: { lastRunAt: staleRunAt, taskCategories: [], scores: {} },
    });
    benchmarkModelMock.mockResolvedValue({});

    const scheduled = benchmarkFreshnessService.scheduleIfNeeded('test-model', {
      ttlMs: TTL_24H,
    });

    expect(scheduled).toBe(true);

    await new Promise<void>((resolve) => setTimeout(resolve, 0));

    expect(benchmarkModelMock).toHaveBeenCalled();
  });

  it('passes providerId and taskCategories to benchmarkModel', async () => {
    getModelMock.mockReturnValue(undefined);
    benchmarkModelMock.mockResolvedValue({});

    benchmarkFreshnessService.scheduleIfNeeded('test-model', {
      ttlMs: TTL_24H,
      providerId: 'ollama',
      taskCategories: ['code'],
    });

    await new Promise<void>((resolve) => setTimeout(resolve, 0));

    expect(benchmarkModelMock).toHaveBeenCalledWith(
      expect.objectContaining({
        modelId: 'test-model',
        providerId: 'ollama',
        taskCategories: ['code'],
      }),
    );
  });

  it('enters backoff when benchmark throws and subsequent calls are skipped', async () => {
    getModelMock.mockReturnValue(undefined);
    benchmarkModelMock.mockRejectedValue(new Error('provider unavailable'));

    benchmarkFreshnessService.scheduleIfNeeded('test-model', { ttlMs: TTL_24H });

    // Wait for the async fire-and-forget to finish (including rejection handler)
    await new Promise<void>((resolve) => setTimeout(resolve, 50));

    expect(benchmarkFreshnessService.isInBackoff('test-model')).toBe(true);

    // Now a subsequent call should be skipped
    const secondScheduled = benchmarkFreshnessService.scheduleIfNeeded('test-model', {
      ttlMs: TTL_24H,
    });
    expect(secondScheduled).toBe(false);
  });

  it('clears backoff after successful benchmark', async () => {
    // Put model in backoff first
    benchmarkFreshnessService.recordFailure('test-model', 60_000);
    expect(benchmarkFreshnessService.isInBackoff('test-model')).toBe(true);

    // Simulate successful benchmark by clearing backoff directly
    benchmarkFreshnessService.clearBackoff('test-model');

    expect(benchmarkFreshnessService.isInBackoff('test-model')).toBe(false);
  });
});
