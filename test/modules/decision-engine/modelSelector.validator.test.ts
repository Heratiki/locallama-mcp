import { beforeEach, describe, expect, it, jest } from '@jest/globals';

jest.unstable_mockModule('../../../dist/utils/logger.js', () => ({
  logger: { error: jest.fn(), warn: jest.fn(), info: jest.fn(), debug: jest.fn() },
}));

const mockGetAvailableModels = jest.fn<() => Promise<Array<any>>>();
const mockGetFreeModels = jest.fn<() => Promise<Array<any>>>();
jest.unstable_mockModule('../../../dist/modules/cost-monitor/index.js', () => ({
  costMonitor: {
    getAvailableModels: mockGetAvailableModels,
    getFreeModels: mockGetFreeModels,
  },
}));

const mockGetDatabase = jest.fn(() => ({ models: {} }));
jest.unstable_mockModule('../../../dist/modules/decision-engine/services/modelsDb.js', () => ({
  modelsDbService: {
    getDatabase: mockGetDatabase,
  },
}));

const mockGetModel = jest.fn<(modelId: string) => any>(() => undefined);
jest.unstable_mockModule('../../../dist/modules/core/model/index.js', () => ({
  getModelRegistry: () => ({
    getModel: mockGetModel,
  }),
}));

const mockIsProviderLocal = jest.fn<(provider: string) => boolean>();
jest.unstable_mockModule('../../../dist/modules/core/provider/index.js', () => ({
  isProviderLocal: mockIsProviderLocal,
  isProviderId: (p: string, id: string) => p === id,
  getProviderRegistry: () => ({
    get: () => undefined,
  }),
}));

jest.unstable_mockModule('../../../dist/config/index.js', () => ({
  config: {
    rootDir: '.',
    minValidatorScore: 0.6,
    reliableBenchmarkCount: 3,
  },
}));

const { modelSelector } = await import('../../../dist/modules/decision-engine/services/modelSelector.js');

describe('modelSelector.getBestValidatorModel test suite', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetAvailableModels.mockResolvedValue([]);
    mockGetFreeModels.mockResolvedValue([]);
    mockIsProviderLocal.mockReturnValue(true);
  });

  it('selects highest-confidence validator candidate using scores.validate', async () => {
    mockGetAvailableModels.mockResolvedValue([
      { id: 'model-a', provider: 'ollama', contextWindow: 8192 },
      { id: 'model-b', provider: 'ollama', contextWindow: 8192 },
    ]);

    mockGetModel.mockImplementation((id: string) => {
      if (id === 'model-a') {
        return {
          id: 'model-a',
          benchmarkSummary: {
            scores: { validate: 0.8 },
            successRate: 1,
            qualityScore: 0.8,
            avgResponseTime: 1000,
            benchmarkCount: 3,
          },
        };
      }
      if (id === 'model-b') {
        return {
          id: 'model-b',
          benchmarkSummary: {
            scores: { validate: 0.7 },
            successRate: 1,
            qualityScore: 0.7,
            avgResponseTime: 1000,
            benchmarkCount: 3,
          },
        };
      }
      return undefined;
    });

    const selected = await modelSelector.getBestValidatorModel(0.5, 500);
    expect(selected?.id).toBe('model-a');
  });

  it('enforces MIN_VALIDATOR_SCORE and returns null when no candidate meets minimum score', async () => {
    mockGetAvailableModels.mockResolvedValue([
      { id: 'model-a', provider: 'ollama', contextWindow: 8192 },
      { id: 'model-b', provider: 'ollama', contextWindow: 8192 },
    ]);

    mockGetModel.mockImplementation((id: string) => {
      if (id === 'model-a') {
        return {
          id: 'model-a',
          benchmarkSummary: {
            scores: { validate: 0.5 }, // below 0.6
            successRate: 1,
            qualityScore: 0.5,
            avgResponseTime: 1000,
            benchmarkCount: 3,
          },
        };
      }
      return undefined;
    });

    const selected = await modelSelector.getBestValidatorModel(0.5, 500);
    expect(selected).toBeNull();
  });

  it('avoids choosing the current generator as validator when alternate qualified candidates exist', async () => {
    mockGetAvailableModels.mockResolvedValue([
      { id: 'model-generator', provider: 'ollama', contextWindow: 8192 },
      { id: 'model-validator', provider: 'ollama', contextWindow: 8192 },
    ]);

    mockGetModel.mockImplementation((id: string) => {
      if (id === 'model-generator') {
        return {
          id: 'model-generator',
          benchmarkSummary: {
            scores: { validate: 0.9 }, // higher score
            successRate: 1,
            qualityScore: 0.9,
            avgResponseTime: 1000,
            benchmarkCount: 3,
          },
        };
      }
      if (id === 'model-validator') {
        return {
          id: 'model-validator',
          benchmarkSummary: {
            scores: { validate: 0.7 }, // lower score but meets 0.6 threshold
            successRate: 1,
            qualityScore: 0.7,
            avgResponseTime: 1000,
            benchmarkCount: 3,
          },
        };
      }
      return undefined;
    });

    const selected = await modelSelector.getBestValidatorModel(0.5, 500, 'model-generator');
    expect(selected?.id).toBe('model-validator');
  });

  it('chooses the current generator as validator if no other qualified candidate exists', async () => {
    mockGetAvailableModels.mockResolvedValue([
      { id: 'model-generator', provider: 'ollama', contextWindow: 8192 },
      { id: 'model-validator', provider: 'ollama', contextWindow: 8192 },
    ]);

    mockGetModel.mockImplementation((id: string) => {
      if (id === 'model-generator') {
        return {
          id: 'model-generator',
          benchmarkSummary: {
            scores: { validate: 0.8 }, // meets threshold
            successRate: 1,
            qualityScore: 0.8,
            avgResponseTime: 1000,
            benchmarkCount: 3,
          },
        };
      }
      if (id === 'model-validator') {
        return {
          id: 'model-validator',
          benchmarkSummary: {
            scores: { validate: 0.5 }, // does not meet threshold
            successRate: 1,
            qualityScore: 0.5,
            avgResponseTime: 1000,
            benchmarkCount: 3,
          },
        };
      }
      return undefined;
    });

    const selected = await modelSelector.getBestValidatorModel(0.5, 500, 'model-generator');
    expect(selected?.id).toBe('model-generator');
  });

  it('prefers local/free tiers over paid tier, even if paid has a higher score', async () => {
    mockGetAvailableModels.mockResolvedValue([
      { id: 'model-paid', provider: 'openrouter', contextWindow: 8192 },
      { id: 'model-local', provider: 'ollama', contextWindow: 8192 },
    ]);

    // mockIsProviderLocal should identify local/free correctly
    mockIsProviderLocal.mockImplementation((p: string) => p === 'ollama');

    mockGetModel.mockImplementation((id: string) => {
      if (id === 'model-paid') {
        return {
          id: 'model-paid',
          benchmarkSummary: {
            scores: { validate: 0.95 }, // highest score, but paid
            successRate: 1,
            qualityScore: 0.95,
            avgResponseTime: 1000,
            benchmarkCount: 3,
          },
        };
      }
      if (id === 'model-local') {
        return {
          id: 'model-local',
          benchmarkSummary: {
            scores: { validate: 0.7 }, // lower score but meets 0.6, and local
            successRate: 1,
            qualityScore: 0.7,
            avgResponseTime: 1000,
            benchmarkCount: 3,
          },
        };
      }
      return undefined;
    });

    const selected = await modelSelector.getBestValidatorModel(0.5, 500);
    expect(selected?.id).toBe('model-local');
  });
});
