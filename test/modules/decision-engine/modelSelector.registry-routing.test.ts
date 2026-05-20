/**
 * Tests for issue #50 — Unify telemetry routing reads from ModelRegistry and
 * correct preemptive heuristic bias.
 *
 * Key acceptance criteria validated here:
 *  1. getBestLocalModel reads benchmark data from ModelRegistry (not modelsDb JSON).
 *  2. A large unbenchmarked model (70B) wins over a small model (2B) with a
 *     single benchmark run for complex tasks when quality is prioritised.
 *  3. Once a model has reliable benchmark data (≥ 3 runs), empirical scores
 *     drive selection over heuristics.
 */
import { beforeEach, describe, expect, it, jest } from '@jest/globals';

// ---------------------------------------------------------------------------
// Infrastructure mocks — must be declared before any dynamic imports
// ---------------------------------------------------------------------------

jest.unstable_mockModule('../../../dist/utils/logger.js', () => ({
  logger: { error: jest.fn(), warn: jest.fn(), info: jest.fn(), debug: jest.fn() },
}));

const mockGetAvailableModels = jest
  .fn<() => Promise<Array<{ id: string; provider: string; contextWindow: number }>>>()
  .mockResolvedValue([]);

jest.unstable_mockModule('../../../dist/modules/cost-monitor/index.js', () => ({
  costMonitor: {
    getAvailableModels: mockGetAvailableModels,
    getFreeModels: jest.fn().mockResolvedValue([]),
  },
}));

// modelsDb is mocked empty to prove getBestLocalModel no longer relies on it
// for benchmark data.
const mockGetDatabase = jest.fn(() => ({ models: {} }));
jest.unstable_mockModule(
  '../../../dist/modules/decision-engine/services/modelsDb.js',
  () => ({
    modelsDbService: {
      getDatabase: mockGetDatabase,
    },
  }),
);

// ModelRegistry mock — the single authoritative source under test.
const mockGetModel = jest.fn<
  (modelId: string) =>
    | {
        benchmarkSummary?: {
          benchmarkCount?: number;
          successRate?: number;
          qualityScore?: number;
          avgResponseTime?: number;
          scores?: { code?: number };
          lastRunAt?: number;
          taskCategories?: string[];
        };
      }
    | undefined
>(() => undefined);

jest.unstable_mockModule('../../../dist/modules/core/model/index.js', () => ({
  getModelRegistry: () => ({
    getModel: mockGetModel,
  }),
}));

jest.unstable_mockModule('../../../dist/modules/openrouter/index.js', () => ({
  openRouterModule: {
    modelTracking: { models: {} },
    initialize: jest.fn().mockResolvedValue(undefined),
  },
}));

jest.unstable_mockModule(
  '../../../dist/modules/api-integration/tool-definition/index.js',
  () => ({
    isOpenRouterConfigured: () => false,
  }),
);

jest.unstable_mockModule('../../../dist/modules/core/provider/index.js', () => ({
  isProviderId: jest.fn().mockReturnValue(false),
  isProviderLocal: jest
    .fn()
    .mockImplementation(
      (provider: string) =>
        provider === 'ollama' || provider === 'lm-studio' || provider === 'local',
    ),
}));

// ---------------------------------------------------------------------------
// Module under test (loaded after mocks)
// ---------------------------------------------------------------------------

const { modelSelector } = await import(
  '../../../dist/modules/decision-engine/services/modelSelector.js'
);
const { COMPLEXITY_THRESHOLDS } = await import(
  '../../../dist/modules/decision-engine/types/index.js'
);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a minimal BenchmarkSummary for the registry mock. */
function makeBenchmarkSummary(overrides: {
  benchmarkCount?: number;
  successRate?: number;
  qualityScore?: number;
  avgResponseTime?: number;
  scores?: { code?: number; reasoning?: number; speed?: number };
}) {
  return {
    lastRunAt: Date.now(),
    taskCategories: ['code', 'chat'],
    scores: overrides.scores ?? {},
    benchmarkCount: overrides.benchmarkCount ?? 1,
    successRate: overrides.successRate ?? 0.8,
    qualityScore: overrides.qualityScore ?? 0.8,
    avgResponseTime: overrides.avgResponseTime ?? 1000,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('modelSelector.getBestLocalModel — issue #50 registry unification', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Default: modelsDb is empty — proves we do NOT rely on it
    mockGetDatabase.mockReturnValue({ models: {} });
  });

  // ── Slice 1: Heuristic bias correction (tracer bullet) ───────────────────

  describe('heuristic bias correction', () => {
    it('selects 70B unbenchmarked model over 2B model with 1 benchmark run for complex tasks', async () => {
      // Two models: a large 70B with no benchmark data and a tiny 2B with one
      // moderate benchmark run. For a complex task, the 70B should win.
      // We populate modelsDb with the 2B data so the current code takes the
      // empirical path — that is the exact bias the fix must overcome.
      mockGetAvailableModels.mockResolvedValue([
        { id: 'llama3-70b', provider: 'ollama', contextWindow: 8192 },
        { id: 'qwen-2b', provider: 'ollama', contextWindow: 8192 },
      ]);

      // Populate BOTH modelsDb and registry so both old and new code paths see the same data.
      mockGetDatabase.mockReturnValue({
        models: {
          'qwen-2b': {
            benchmarkCount: 1,
            successRate: 0.75,
            qualityScore: 0.65,
            avgResponseTime: 2000,
            complexityScore: 0.3,
          },
        },
      });

      mockGetModel.mockImplementation((id: string) => {
        if (id === 'qwen-2b') {
          return {
            benchmarkSummary: makeBenchmarkSummary({
              benchmarkCount: 1,
              successRate: 0.75,
              qualityScore: 0.65,
              avgResponseTime: 2000,
            }),
          };
        }
        return undefined; // llama3-70b has no benchmark data
      });

      // Complex task — well above MEDIUM threshold
      const complexity = COMPLEXITY_THRESHOLDS.MEDIUM + 0.1;
      const selected = await modelSelector.getBestLocalModel(complexity, 500);
      expect(selected?.id).toBe('llama3-70b');
    });

    it('selects 70B unbenchmarked over 2B with 1 benchmark even when 2B metrics look good', async () => {
      mockGetAvailableModels.mockResolvedValue([
        { id: 'llama3-70b', provider: 'ollama', contextWindow: 8192 },
        { id: 'phi-2b', provider: 'ollama', contextWindow: 8192 },
      ]);

      // Populate modelsDb so the old code path takes the empirical route for phi-2b.
      mockGetDatabase.mockReturnValue({
        models: {
          'phi-2b': {
            benchmarkCount: 1,
            successRate: 0.95,
            qualityScore: 0.90,
            avgResponseTime: 500,
            complexityScore: 0.3,
          },
        },
      });

      // 2B has impressive-looking single-run metrics (could be lucky)
      mockGetModel.mockImplementation((id: string) => {
        if (id === 'phi-2b') {
          return {
            benchmarkSummary: makeBenchmarkSummary({
              benchmarkCount: 1,
              successRate: 0.95,
              qualityScore: 0.90,
              avgResponseTime: 500,
            }),
          };
        }
        return undefined;
      });

      const selected = await modelSelector.getBestLocalModel(
        COMPLEXITY_THRESHOLDS.COMPLEX + 0.05, // very complex
        500,
      );
      expect(selected?.id).toBe('llama3-70b');
    });

    it('prefers small model over large for simple tasks (no benchmark data)', async () => {
      mockGetAvailableModels.mockResolvedValue([
        { id: 'llama3-70b', provider: 'ollama', contextWindow: 8192 },
        { id: 'phi-2b', provider: 'ollama', contextWindow: 8192 },
      ]);
      // Neither has benchmark data
      mockGetModel.mockReturnValue(undefined);

      const selected = await modelSelector.getBestLocalModel(
        COMPLEXITY_THRESHOLDS.SIMPLE - 0.05, // simple task
        200,
      );
      expect(selected?.id).toBe('phi-2b');
    });
  });

  // ── Slice 2: Data source unification ─────────────────────────────────────

  describe('data source unification — reads from ModelRegistry', () => {
    it('uses registry benchmark data to score a model even when modelsDb is empty', async () => {
      // bench-7b has high benchmark data ONLY in the registry (not in modelsDb).
      // basic-70b has no data anywhere.
      // bench-7b should win because the registry data is the source of truth.
      mockGetAvailableModels.mockResolvedValue([
        { id: 'basic-70b', provider: 'ollama', contextWindow: 8192 },
        { id: 'bench-7b', provider: 'ollama', contextWindow: 8192 },
      ]);

      // modelsDb is empty (default from beforeEach)
      mockGetModel.mockImplementation((id: string) => {
        if (id === 'bench-7b') {
          return {
            benchmarkSummary: makeBenchmarkSummary({
              benchmarkCount: 5, // reliable data
              successRate: 0.95,
              qualityScore: 0.95,
              avgResponseTime: 800,
            }),
          };
        }
        return undefined; // basic-70b has no registry entry
      });

      // Complex task: without the fix, basic-70b wins via heuristics (0.3) over
      // bench-7b (heuristic 0.2, because modelsDb empty). With the fix, bench-7b
      // reads from registry and scores ~0.91 (fully confident), beating basic-70b.
      const selected = await modelSelector.getBestLocalModel(
        COMPLEXITY_THRESHOLDS.MEDIUM + 0.1,
        500,
      );
      expect(selected?.id).toBe('bench-7b');
    });

    it('avoids a model whose code score is 0 in the registry for code tasks', async () => {
      mockGetAvailableModels.mockResolvedValue([
        { id: 'weak-coder-7b', provider: 'ollama', contextWindow: 8192 },
        { id: 'strong-coder-7b', provider: 'ollama', contextWindow: 8192 },
      ]);

      mockGetModel.mockImplementation((id: string) => {
        if (id === 'weak-coder-7b') {
          return {
            benchmarkSummary: makeBenchmarkSummary({
              benchmarkCount: 3,
              successRate: 0.8,
              qualityScore: 0.8,
              avgResponseTime: 1000,
              scores: { code: 0.0 }, // zero code score
            }),
          };
        }
        if (id === 'strong-coder-7b') {
          return {
            benchmarkSummary: makeBenchmarkSummary({
              benchmarkCount: 3,
              successRate: 0.8,
              qualityScore: 0.8,
              avgResponseTime: 1000,
              scores: { code: 0.9 }, // strong code score
            }),
          };
        }
        return undefined;
      });

      const selected = await modelSelector.getBestLocalModel(0.5, 500, undefined, 'code');
      expect(selected?.id).toBe('strong-coder-7b');
    });
  });

  // ── Slice 3: Reliable data overrides heuristics ───────────────────────────

  describe('reliable benchmark data drives selection', () => {
    it('a well-benchmarked 7B model beats an unbenchmarked 70B for complex tasks', async () => {
      mockGetAvailableModels.mockResolvedValue([
        { id: 'llama3-70b', provider: 'ollama', contextWindow: 8192 },
        { id: 'codellama-7b', provider: 'ollama', contextWindow: 8192 },
      ]);

      // codellama-7b has reliable data (≥3 runs) with high scores
      mockGetModel.mockImplementation((id: string) => {
        if (id === 'codellama-7b') {
          return {
            benchmarkSummary: makeBenchmarkSummary({
              benchmarkCount: 3,
              successRate: 0.95,
              qualityScore: 0.95,
              avgResponseTime: 600,
            }),
          };
        }
        return undefined; // llama3-70b has no benchmark data
      });

      const selected = await modelSelector.getBestLocalModel(
        COMPLEXITY_THRESHOLDS.MEDIUM + 0.1,
        500,
      );
      // codellama-7b's empirical score (~0.95) beats llama3-70b's heuristic (~0.75)
      expect(selected?.id).toBe('codellama-7b');
    });

    it('a 70B model with reliable benchmarks beats a 2B model with 1 run', async () => {
      mockGetAvailableModels.mockResolvedValue([
        { id: 'llama3-70b', provider: 'ollama', contextWindow: 8192 },
        { id: 'phi-2b', provider: 'ollama', contextWindow: 8192 },
      ]);

      mockGetModel.mockImplementation((id: string) => {
        if (id === 'llama3-70b') {
          return {
            benchmarkSummary: makeBenchmarkSummary({
              benchmarkCount: 3,
              successRate: 0.85,
              qualityScore: 0.85,
              avgResponseTime: 3000,
            }),
          };
        }
        if (id === 'phi-2b') {
          return {
            benchmarkSummary: makeBenchmarkSummary({
              benchmarkCount: 1,
              successRate: 0.9,
              qualityScore: 0.9,
              avgResponseTime: 300,
            }),
          };
        }
        return undefined;
      });

      const selected = await modelSelector.getBestLocalModel(
        COMPLEXITY_THRESHOLDS.MEDIUM + 0.1,
        500,
      );
      expect(selected?.id).toBe('llama3-70b');
    });
  });
});
