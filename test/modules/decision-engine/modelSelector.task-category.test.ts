import { beforeEach, describe, expect, it, jest } from '@jest/globals';

jest.unstable_mockModule('../../../dist/utils/logger.js', () => ({
  logger: { error: jest.fn(), warn: jest.fn(), info: jest.fn(), debug: jest.fn() },
}));

const mockGetAvailableModels = jest.fn<() => Promise<Array<{ id: string; provider: string; contextWindow: number }>>>()
  .mockResolvedValue([]);

jest.unstable_mockModule('../../../dist/modules/cost-monitor/index.js', () => ({
  costMonitor: {
    getAvailableModels: mockGetAvailableModels,
    getFreeModels: jest.fn().mockResolvedValue([]),
  },
}));

const mockGetDatabase = jest.fn(() => ({ models: {} }));
jest.unstable_mockModule('../../../dist/modules/decision-engine/services/modelsDb.js', () => ({
  modelsDbService: {
    getDatabase: mockGetDatabase,
  },
}));

const mockGetModel = jest.fn<(modelId: string) => { benchmarkSummary?: { scores?: { code?: number } } } | undefined>(() => undefined);
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

jest.unstable_mockModule('../../../dist/modules/api-integration/tool-definition/index.js', () => ({
  isOpenRouterConfigured: () => false,
}));

jest.unstable_mockModule('../../../dist/modules/core/provider/index.js', () => ({
  isProviderId: jest.fn().mockReturnValue(false),
  isProviderLocal: jest.fn().mockImplementation((provider: string) => provider === 'ollama' || provider === 'lm-studio' || provider === 'local'),
}));

const { modelSelector } = await import('../../../dist/modules/decision-engine/services/modelSelector.js');

describe('modelSelector.getBestLocalModel task-category scoring (issue #50)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('prefers stronger ModelRegistry task-category score over higher generic modelsDb quality', async () => {
    mockGetAvailableModels.mockResolvedValue([
      { id: 'model-a', provider: 'ollama', contextWindow: 8192 },
      { id: 'model-b', provider: 'ollama', contextWindow: 8192 },
    ]);

    mockGetDatabase.mockReturnValue({
      models: {
        'model-a': {
          benchmarkCount: 3,
          successRate: 0.95,
          qualityScore: 0.95,
          avgResponseTime: 1000,
          complexityScore: 0.5,
        },
        'model-b': {
          benchmarkCount: 3,
          successRate: 0.9,
          qualityScore: 0.6,
          avgResponseTime: 1000,
          complexityScore: 0.5,
        },
      },
    });

    mockGetModel.mockImplementation((id: string) => {
      if (id === 'model-a') return { benchmarkSummary: { scores: { code: 0.1 } } };
      if (id === 'model-b') return { benchmarkSummary: { scores: { code: 0.9 } } };
      return undefined;
    });

    const selected = await modelSelector.getBestLocalModel(0.5, 500, undefined, 'code');
    expect(selected?.id).toBe('model-b');
  });

  it('preserves cold-start behavior when task-category score is unavailable', async () => {
    mockGetAvailableModels.mockResolvedValue([
      { id: 'model-a', provider: 'ollama', contextWindow: 8192 },
      { id: 'model-b', provider: 'ollama', contextWindow: 8192 },
    ]);

    mockGetDatabase.mockReturnValue({
      models: {
        'model-a': {
          benchmarkCount: 3,
          successRate: 0.95,
          qualityScore: 0.95,
          avgResponseTime: 1000,
          complexityScore: 0.5,
        },
        'model-b': {
          benchmarkCount: 3,
          successRate: 0.9,
          qualityScore: 0.6,
          avgResponseTime: 1000,
          complexityScore: 0.5,
        },
      },
    });

    mockGetModel.mockReturnValue(undefined);

    const selected = await modelSelector.getBestLocalModel(0.5, 500, undefined, 'code');
    expect(selected?.id).toBe('model-a');
  });
});
