/**
 * Tests for issue #28 — capability score filter wired into codeModelSelector.
 * Tests assert external behaviour: which model gets selected / excluded when
 * CapabilityDetector returns scores and largeContext flags.
 */
import { describe, expect, it, jest, beforeEach, afterEach } from '@jest/globals';

// ---------------------------------------------------------------------------
// Infrastructure mocks
// ---------------------------------------------------------------------------

jest.unstable_mockModule('../../../dist/utils/logger.js', () => ({
  logger: { error: jest.fn(), warn: jest.fn(), info: jest.fn(), debug: jest.fn() },
}));

jest.unstable_mockModule('../../../dist/modules/cost-monitor/index.js', () => ({
  costMonitor: {
    getAvailableModels: jest.fn().mockResolvedValue([]),
    getFreeModels: jest.fn().mockResolvedValue([]),
    search: jest.fn().mockResolvedValue([]),
  },
  CodeSearchEngine: jest.fn(),
}));

jest.unstable_mockModule('../../../dist/modules/openrouter/index.js', () => ({
  openRouterModule: {
    getFreeModels: jest.fn().mockResolvedValue([]),
    evaluateQuality: jest.fn().mockReturnValue(0.7),
  },
}));

jest.unstable_mockModule('../../../dist/modules/core/provider/index.js', () => ({
  isProviderId: jest.fn().mockReturnValue(false),
  isProviderLocal: jest.fn().mockReturnValue(true),
  getProviderRegistry: jest.fn().mockReturnValue({ list: () => [], get: () => null }),
}));

jest.unstable_mockModule('../../../dist/modules/core/model/index.js', () => ({
  getModelRegistry: jest.fn().mockReturnValue({ getModel: () => null }),
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeModel(id: string, contextWindow = 8192, provider = 'ollama') {
  return {
    id,
    provider,
    contextWindow,
    costPerToken: { prompt: 0, completion: 0 },
    capabilities: { chat: true, completion: true },
    name: id,
  };
}

function makeSubtask(estimatedTokens: number, codeType = 'function' as const) {
  return {
    id: 'sub-1',
    description: 'write a function',
    estimatedTokens,
    complexity: 0.3,
    codeType,
    dependencies: [],
    priority: 1,
  };
}

function fakeCapabilities(overrides: Record<string, unknown> = {}) {
  return {
    chat: true, code: true, vision: false, toolUse: false,
    largeContext: false, maxContextTokens: 8192,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// codeModelSelector — score-threshold filter
// ---------------------------------------------------------------------------

describe('codeModelSelector capability-score filter (issue #28)', () => {
  let capDetectorModule: { _setCapabilityDetectorForTests: (d: unknown) => void };
  let costMonitorMock: { getAvailableModels: ReturnType<typeof jest.fn> };

  beforeEach(async () => {
    capDetectorModule = await import('../../../dist/modules/core/capability-detector.js') as typeof capDetectorModule;
    const costMod = await import('../../../dist/modules/cost-monitor/index.js') as { costMonitor: { getAvailableModels: ReturnType<typeof jest.fn> } };
    costMonitorMock = costMod.costMonitor;
  });

  afterEach(() => {
    capDetectorModule._setCapabilityDetectorForTests(undefined);
    jest.clearAllMocks();
  });

  it('excludes model with empirical code score below threshold (0.1 < 0.3)', async () => {
    const poorCoder = makeModel('poor-coder');
    const goodCoder = makeModel('good-coder');

    costMonitorMock.getAvailableModels.mockResolvedValue([poorCoder, goodCoder]);

    const detector = {
      detectCapabilities: (id: string) => {
        if (id === 'poor-coder') return fakeCapabilities({ scores: { code: 0.1 } });
        if (id === 'good-coder') return fakeCapabilities({ scores: { code: 0.9 } });
        return fakeCapabilities();
      },
    };
    capDetectorModule._setCapabilityDetectorForTests(detector);

    const configMod = await import('../../../dist/config/index.js') as { config: Record<string, unknown> };
    configMod.config.codeScoreThreshold = 0.3;

    const { codeModelSelector } = await import('../../../dist/modules/decision-engine/services/codeModelSelector.js') as {
      codeModelSelector: {
        findBestModelForSubtask: (subtask: unknown, task?: string) => Promise<{ id: string } | null>;
        setModelPerformanceTracker: (t: unknown) => void;
        _clearOpenRouterCache?: () => void;
      };
    };

    codeModelSelector.setModelPerformanceTracker({
      analyzePerformanceByComplexity: () => ({ averageSuccessRate: 0, averageQualityScore: 0, averageResponseTime: 0, averageTokenEfficiency: 0, averageResourceUsage: 0, bestPerformingModels: [] }),
      getModelStats: () => ({ complexityScore: 0.3, successRate: 1.0, qualityScore: 1.0, avgResponseTime: 1000, tokenEfficiency: 1.0, systemResourceUsage: 0.1, memoryFootprint: 4 }),
    });

    const result = await codeModelSelector.findBestModelForSubtask(makeSubtask(500));

    expect(result?.id).not.toBe('poor-coder');
    expect(result?.id).toBe('good-coder');
  });

  it('does NOT exclude model with undefined code score (no benchmark data)', async () => {
    const unBenchmarked = makeModel('new-coder');

    costMonitorMock.getAvailableModels.mockResolvedValue([unBenchmarked]);

    const detector = {
      detectCapabilities: (_id: string) => fakeCapabilities(), // no scores
    };
    capDetectorModule._setCapabilityDetectorForTests(detector);

    const configMod = await import('../../../dist/config/index.js') as { config: Record<string, unknown> };
    configMod.config.codeScoreThreshold = 0.3;

    const { codeModelSelector } = await import('../../../dist/modules/decision-engine/services/codeModelSelector.js') as {
      codeModelSelector: {
        findBestModelForSubtask: (subtask: unknown, task?: string) => Promise<{ id: string } | null>;
        setModelPerformanceTracker: (t: unknown) => void;
      };
    };

    codeModelSelector.setModelPerformanceTracker({
      analyzePerformanceByComplexity: () => ({ averageSuccessRate: 0, averageQualityScore: 0, averageResponseTime: 0, averageTokenEfficiency: 0, averageResourceUsage: 0, bestPerformingModels: [] }),
      getModelStats: () => ({ complexityScore: 0.3, successRate: 1.0, qualityScore: 1.0, avgResponseTime: 1000, tokenEfficiency: 1.0, systemResourceUsage: 0.1, memoryFootprint: 4 }),
    });

    const result = await codeModelSelector.findBestModelForSubtask(makeSubtask(500));

    // Must be selected — no benchmark data ≠ poor performer
    expect(result?.id).toBe('new-coder');
  });

  it('includes model with score 0.25 when CODE_SCORE_THRESHOLD overridden to 0.2', async () => {
    const marginalCoder = makeModel('marginal-coder');

    costMonitorMock.getAvailableModels.mockResolvedValue([marginalCoder]);

    const detector = {
      detectCapabilities: (_id: string) => fakeCapabilities({ scores: { code: 0.25 } }),
    };
    capDetectorModule._setCapabilityDetectorForTests(detector);

    const configMod = await import('../../../dist/config/index.js') as { config: Record<string, unknown> };
    configMod.config.codeScoreThreshold = 0.2; // lower threshold

    const { codeModelSelector } = await import('../../../dist/modules/decision-engine/services/codeModelSelector.js') as {
      codeModelSelector: {
        findBestModelForSubtask: (subtask: unknown, task?: string) => Promise<{ id: string } | null>;
        setModelPerformanceTracker: (t: unknown) => void;
      };
    };

    codeModelSelector.setModelPerformanceTracker({
      analyzePerformanceByComplexity: () => ({ averageSuccessRate: 0, averageQualityScore: 0, averageResponseTime: 0, averageTokenEfficiency: 0, averageResourceUsage: 0, bestPerformingModels: [] }),
      getModelStats: () => ({ complexityScore: 0.3, successRate: 1.0, qualityScore: 1.0, avgResponseTime: 1000, tokenEfficiency: 1.0, systemResourceUsage: 0.1, memoryFootprint: 4 }),
    });

    const result = await codeModelSelector.findBestModelForSubtask(makeSubtask(500));

    expect(result?.id).toBe('marginal-coder');

    // Restore default
    configMod.config.codeScoreThreshold = 0.3;
  });
});

// ---------------------------------------------------------------------------
// codeModelSelector — largeContext filter for large prompts
// ---------------------------------------------------------------------------

describe('codeModelSelector largeContext filter (issue #28)', () => {
  let capDetectorModule: { _setCapabilityDetectorForTests: (d: unknown) => void };
  let costMonitorMock: { getAvailableModels: ReturnType<typeof jest.fn> };

  beforeEach(async () => {
    capDetectorModule = await import('../../../dist/modules/core/capability-detector.js') as typeof capDetectorModule;
    const costMod = await import('../../../dist/modules/cost-monitor/index.js') as { costMonitor: { getAvailableModels: ReturnType<typeof jest.fn> } };
    costMonitorMock = costMod.costMonitor;
  });

  afterEach(() => {
    capDetectorModule._setCapabilityDetectorForTests(undefined);
    jest.clearAllMocks();
  });

  it('excludes largeContext=false models for subtasks ≥ 32768 tokens', async () => {
    const smallCtx = makeModel('small-ctx', 8192);
    const largeCtx = makeModel('large-ctx', 131072);

    costMonitorMock.getAvailableModels.mockResolvedValue([smallCtx, largeCtx]);

    const detector = {
      detectCapabilities: (id: string) => {
        if (id === 'small-ctx') return fakeCapabilities({ largeContext: false, maxContextTokens: 8192 });
        if (id === 'large-ctx') return fakeCapabilities({ largeContext: true, maxContextTokens: 131072 });
        return fakeCapabilities();
      },
    };
    capDetectorModule._setCapabilityDetectorForTests(detector);

    const { codeModelSelector } = await import('../../../dist/modules/decision-engine/services/codeModelSelector.js') as {
      codeModelSelector: {
        findBestModelForSubtask: (subtask: unknown, task?: string) => Promise<{ id: string } | null>;
        setModelPerformanceTracker: (t: unknown) => void;
      };
    };

    codeModelSelector.setModelPerformanceTracker({
      analyzePerformanceByComplexity: () => ({ averageSuccessRate: 0, averageQualityScore: 0, averageResponseTime: 0, averageTokenEfficiency: 0, averageResourceUsage: 0, bestPerformingModels: [] }),
      getModelStats: () => ({ complexityScore: 0.3, successRate: 1.0, qualityScore: 1.0, avgResponseTime: 1000, tokenEfficiency: 1.0, systemResourceUsage: 0.1, memoryFootprint: 4 }),
    });

    const result = await codeModelSelector.findBestModelForSubtask(makeSubtask(40000));

    expect(result?.id).toBe('large-ctx');
  });

  it('falls back to raw contextWindow when capability detector unavailable', async () => {
    const smallRaw = makeModel('small-raw', 8192);
    const largeRaw = makeModel('large-raw', 131072);

    costMonitorMock.getAvailableModels.mockResolvedValue([smallRaw, largeRaw]);

    // Detector throws — simulates uninitialised or unavailable state
    const throwingDetector = {
      detectCapabilities: () => { throw new Error('not initialised'); },
    };
    capDetectorModule._setCapabilityDetectorForTests(throwingDetector);

    const { codeModelSelector } = await import('../../../dist/modules/decision-engine/services/codeModelSelector.js') as {
      codeModelSelector: {
        findBestModelForSubtask: (subtask: unknown, task?: string) => Promise<{ id: string } | null>;
        setModelPerformanceTracker: (t: unknown) => void;
      };
    };

    codeModelSelector.setModelPerformanceTracker({
      analyzePerformanceByComplexity: () => ({ averageSuccessRate: 0, averageQualityScore: 0, averageResponseTime: 0, averageTokenEfficiency: 0, averageResourceUsage: 0, bestPerformingModels: [] }),
      getModelStats: () => ({ complexityScore: 0.3, successRate: 1.0, qualityScore: 1.0, avgResponseTime: 1000, tokenEfficiency: 1.0, systemResourceUsage: 0.1, memoryFootprint: 4 }),
    });

    const result = await codeModelSelector.findBestModelForSubtask(makeSubtask(40000));

    // Falls back to raw contextWindow: large-raw (131072 >= 40000) survives, small-raw excluded
    expect(result?.id).toBe('large-raw');
  });
});
