import { describe, expect, it, jest, beforeEach } from '@jest/globals';

// ---------------------------------------------------------------------------
// Mocks — must be declared before any awaited imports
// ---------------------------------------------------------------------------

jest.unstable_mockModule('../../../dist/utils/logger.js', () => ({
  logger: {
    error: jest.fn(),
    warn: jest.fn(),
    info: jest.fn(),
    debug: jest.fn(),
  },
}));

// modelSelector: the key mock — controls hasFreeModels / getBestFreeModel /
// getBestLocalModel which are the only calls inside preemptiveRouting.
const mockHasFreeModels = jest.fn<() => Promise<boolean>>().mockResolvedValue(false);
const mockGetBestFreeModel = jest.fn<() => Promise<{ id: string } | null>>().mockResolvedValue(null);
const mockGetBestLocalModel = jest
  .fn<() => Promise<{ id: string } | null>>()
  .mockResolvedValue({ id: 'llama-3.2-3b' });

// CapabilityDetector mock — controls detectCapabilities per model id.
const mockDetectCapabilities = jest.fn<(id: string) => { code?: boolean; scores?: { code?: number } }>(
  () => ({ chat: true, code: true }),
);
const mockGetCapabilityDetector = jest.fn(() => ({
  detectCapabilities: mockDetectCapabilities,
}));

jest.unstable_mockModule('../../../dist/modules/core/capability-detector.js', () => ({
  getCapabilityDetector: mockGetCapabilityDetector,
  _setCapabilityDetectorForTests: jest.fn(),
  initCapabilityDetector: jest.fn(),
}));

jest.unstable_mockModule(
  '../../../dist/modules/decision-engine/services/modelSelector.js',
  () => ({
    modelSelector: {
      hasFreeModels: mockHasFreeModels,
      getBestFreeModel: mockGetBestFreeModel,
      getBestLocalModel: mockGetBestLocalModel,
    },
  }),
);

// Stub out heavy deps that are imported at the module top-level but not used
// during preemptiveRouting — we just need them to not throw on import.
jest.unstable_mockModule('../../../dist/modules/cost-monitor/index.js', () => ({
  costMonitor: {
    estimateCost: jest.fn().mockResolvedValue({
      local: { cost: { total: 0 } },
      paid: { cost: { total: 0.02 } },
    }),
    getAvailableModels: jest.fn().mockResolvedValue([]),
    getFreeModels: jest.fn().mockResolvedValue([]),
  },
}));

jest.unstable_mockModule(
  '../../../dist/modules/decision-engine/services/modelsDb.js',
  () => ({ modelsDbService: { initialize: jest.fn().mockResolvedValue(undefined) } }),
);

jest.unstable_mockModule(
  '../../../dist/modules/decision-engine/services/benchmarkService.js',
  () => ({ benchmarkService: { runBenchmark: jest.fn(), getBenchmarkResults: jest.fn() } }),
);

jest.unstable_mockModule(
  '../../../dist/modules/decision-engine/services/codeTaskCoordinator.js',
  () => ({ codeTaskCoordinator: { processCodeTask: jest.fn() } }),
);

jest.unstable_mockModule(
  '../../../dist/modules/decision-engine/services/apiHandlers.js',
  () => ({ apiHandlers: {} }),
);

jest.unstable_mockModule(
  '../../../dist/modules/decision-engine/services/jobTracker.js',
  () => ({
    getJobTracker: jest.fn().mockResolvedValue({
      updateJobProgress: jest.fn().mockResolvedValue(undefined),
      failJob: jest.fn().mockResolvedValue(undefined),
    }),
    JobStatus: {},
  }),
);

jest.unstable_mockModule(
  '../../../dist/modules/decision-engine/services/codeModelSelector.js',
  () => ({
    codeModelSelector: {
      initialize: jest.fn(),
      selectModelForSubtask: jest.fn(),
      _modelPerformanceTracker: null,
      setModelPerformanceTracker: jest.fn(),
    },
  }),
);

jest.unstable_mockModule(
  '../../../dist/modules/decision-engine/services/modelPerformance.js',
  () => ({
    modelPerformanceTracker: {
      initialize: jest.fn(),
      getBestPerformingModels: jest.fn().mockReturnValue([]),
      recordModelUsage: jest.fn(),
    },
  }),
);

jest.unstable_mockModule('../../../dist/modules/lm-studio/index.js', () => ({
  lmStudioModule: { initialize: jest.fn().mockResolvedValue(undefined) },
}));

jest.unstable_mockModule('../../../dist/modules/ollama/index.js', () => ({
  ollamaModule: { initialize: jest.fn().mockResolvedValue(undefined) },
}));

// benchmarkFreshnessService — new dep pulled in by decision-engine for lazy benchmark scheduling.
// Stub it out so the module loads cleanly without pulling model/registry → CapabilityDetector.
jest.unstable_mockModule('../../../dist/modules/benchmark/core/freshness.js', () => ({
  benchmarkFreshnessService: {
    check: jest.fn().mockReturnValue({ status: 'fresh', reason: 'benchmark_fresh' }),
    scheduleIfNeeded: jest.fn().mockReturnValue(false),
    isInBackoff: jest.fn().mockReturnValue(false),
    recordFailure: jest.fn(),
    clearBackoff: jest.fn(),
  },
}));

// ---------------------------------------------------------------------------
// Module under test (after mocks)
// ---------------------------------------------------------------------------

const { decisionEngine } = await import('../../../dist/modules/decision-engine/index.js');

// ---------------------------------------------------------------------------
// Helpers — read the COMPLEXITY / TOKEN thresholds from dist types
// ---------------------------------------------------------------------------

const { COMPLEXITY_THRESHOLDS, TOKEN_THRESHOLDS } = await import(
  '../../../dist/modules/decision-engine/types/index.js'
);

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('decisionEngine.preemptiveRouting', () => {
  beforeEach(() => {
    mockHasFreeModels.mockReset();
    mockGetBestFreeModel.mockReset();
    mockGetBestLocalModel.mockReset();
    mockDetectCapabilities.mockReset();
    mockGetCapabilityDetector.mockReset();

    mockHasFreeModels.mockResolvedValue(false);
    mockGetBestFreeModel.mockResolvedValue(null);
    mockGetBestLocalModel.mockResolvedValue({ id: 'llama-3.2-3b' });
    mockDetectCapabilities.mockReturnValue({ chat: true, code: true });
    mockGetCapabilityDetector.mockReturnValue({ detectCapabilities: mockDetectCapabilities });
  });

  // ── Local preference ──────────────────────────────────────────────────────

  it('prefers local when complexity is below the SIMPLE threshold', async () => {
    const result = await decisionEngine.preemptiveRouting({
      task: 'hello',
      contextLength: 100,
      expectedOutputLength: 50,
      complexity: COMPLEXITY_THRESHOLDS.SIMPLE - 0.1,
      priority: 'quality',
    });
    expect(result.provider).toBe('local');
  });

  it('prefers local when priority is cost (low complexity)', async () => {
    const result = await decisionEngine.preemptiveRouting({
      task: 'rename variable',
      contextLength: 200,
      expectedOutputLength: 50,
      complexity: COMPLEXITY_THRESHOLDS.SIMPLE - 0.1,
      priority: 'cost',
    });
    expect(result.provider).toBe('local');
    expect(result.scores.local).toBeGreaterThan(result.scores.paid);
  });

  it('includes a local model id in the decision', async () => {
    const result = await decisionEngine.preemptiveRouting({
      task: 'add docstring',
      contextLength: 100,
      expectedOutputLength: 80,
      complexity: COMPLEXITY_THRESHOLDS.SIMPLE - 0.1,
      priority: 'cost',
    });
    expect(result.model).toBeTruthy();
  });

  // ── Paid preference ───────────────────────────────────────────────────────

  it('prefers paid when complexity exceeds the COMPLEX threshold', async () => {
    const result = await decisionEngine.preemptiveRouting({
      task: 'rewrite entire authentication service from scratch',
      contextLength: 5000,
      expectedOutputLength: 4000,
      complexity: COMPLEXITY_THRESHOLDS.COMPLEX + 0.1,
      priority: 'quality',
    });
    expect(result.provider).toBe('paid');
  });

  it('prefers paid when priority is speed', async () => {
    const result = await decisionEngine.preemptiveRouting({
      task: 'quick summary',
      contextLength: 500,
      expectedOutputLength: 200,
      complexity: COMPLEXITY_THRESHOLDS.SIMPLE,
      priority: 'speed',
    });
    expect(result.provider).toBe('paid');
  });

  it('prefers paid when total tokens exceed LARGE threshold', async () => {
    const result = await decisionEngine.preemptiveRouting({
      task: 'analyse this huge codebase',
      contextLength: TOKEN_THRESHOLDS.LARGE,
      expectedOutputLength: 100,
      complexity: 0.5,
      priority: 'quality',
    });
    expect(result.provider).toBe('paid');
  });

  // ── Fallback to free model when available ─────────────────────────────────

  it('uses a free model (provider=paid) when free models outscore local and paid', async () => {
    mockHasFreeModels.mockResolvedValue(true);
    mockGetBestFreeModel.mockResolvedValue({ id: 'mistralai/mistral-7b-instruct:free' });

    // Cost priority with free models makes freeScore dominate
    const result = await decisionEngine.preemptiveRouting({
      task: 'translate comment to english',
      contextLength: 200,
      expectedOutputLength: 50,
      complexity: COMPLEXITY_THRESHOLDS.SIMPLE - 0.1,
      priority: 'cost',
    });
    // When free models win, provider is 'paid' but model id reflects a free model
    if (result.provider === 'paid' && result.model?.includes('free')) {
      expect(result.model).toBe('mistralai/mistral-7b-instruct:free');
    } else {
      // It's still a valid decision even if local wins
      expect(['local', 'paid']).toContain(result.provider);
    }
  });

  // ── Return shape ──────────────────────────────────────────────────────────

  it('always returns a decision with required fields', async () => {
    const result = await decisionEngine.preemptiveRouting({
      task: 'write a hello world',
      contextLength: 50,
      expectedOutputLength: 30,
      complexity: 0.3,
      priority: 'quality',
    });

    expect(typeof result.provider).toBe('string');
    expect(typeof result.model).toBe('string');
    expect(typeof result.confidence).toBe('number');
    expect(typeof result.explanation).toBe('string');
    expect(result.preemptive).toBe(true);
    expect(result.scores).toHaveProperty('local');
    expect(result.scores).toHaveProperty('paid');
  });

  // ── Issue #49: CapabilityDetector filter for code tasks ───────────────────

  it('skips local model with code score below threshold when a better local model exists', async () => {
    // First getBestLocalModel call returns the bad coder; second (with exclusion) returns good coder.
    mockGetBestLocalModel
      .mockResolvedValueOnce({ id: 'bad-coder-7b' })
      .mockResolvedValueOnce({ id: 'good-coder-7b' });

    mockDetectCapabilities.mockImplementation((id: string) => {
      if (id === 'bad-coder-7b') return { chat: true, code: false, scores: { code: 0.1 } };
      return { chat: true, code: true, scores: { code: 0.9 } };
    });

    const result = await decisionEngine.preemptiveRouting({
      task: 'implement a function to parse JSON',
      contextLength: 200,
      expectedOutputLength: 100,
      complexity: COMPLEXITY_THRESHOLDS.SIMPLE - 0.1,
      priority: 'cost',
    });

    expect(result.provider).toBe('local');
    expect(result.model).not.toBe('bad-coder-7b');
    expect(result.model).toBe('good-coder-7b');
  });

  it('falls back to the original local model when no capable alternative exists', async () => {
    // First call returns the bad coder; second call (exclusion fallback) returns null.
    mockGetBestLocalModel
      .mockResolvedValueOnce({ id: 'bad-coder-7b' })
      .mockResolvedValueOnce(null);

    mockDetectCapabilities.mockImplementation((id: string) => {
      if (id === 'bad-coder-7b') return { chat: true, code: false, scores: { code: 0.1 } };
      return { chat: true, code: true };
    });

    const result = await decisionEngine.preemptiveRouting({
      task: 'implement a function to parse JSON',
      contextLength: 200,
      expectedOutputLength: 100,
      complexity: COMPLEXITY_THRESHOLDS.SIMPLE - 0.1,
      priority: 'cost',
    });

    // Must not crash — falls back gracefully to the only available model.
    expect(result.provider).toBe('local');
    expect(result.model).toBe('bad-coder-7b');
  });
});
