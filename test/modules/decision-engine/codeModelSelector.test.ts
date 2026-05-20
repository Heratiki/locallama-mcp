import { describe, expect, it, jest, beforeEach } from '@jest/globals';

// Stub out logger
jest.unstable_mockModule('../../../dist/utils/logger.js', () => ({
  logger: {
    error: jest.fn(),
    warn: jest.fn(),
    info: jest.fn(),
    debug: jest.fn(),
  },
}));

const mockGetAvailableModels = jest.fn<() => Promise<any[]>>().mockResolvedValue([]);
const mockGetFreeModels = jest.fn<() => Promise<any[]>>().mockResolvedValue([]);

jest.unstable_mockModule('../../../dist/modules/cost-monitor/index.js', () => ({
  costMonitor: {
    getAvailableModels: mockGetAvailableModels,
    getFreeModels: mockGetFreeModels,
  },
}));

// Load modules under test dynamically after mocks are declared
const { codeModelSelector } = await import('../../../dist/modules/decision-engine/services/codeModelSelector.js');
const { getModelRegistry } = await import('../../../dist/modules/core/model/index.js');
const { config } = await import('../../../dist/config/index.js');

describe('codeModelSelector capability score filtering', () => {
  const mockTracker = {
    analyzePerformanceByComplexity: jest.fn(() => ({
      minAcceptableScore: 0.3,
      preferLocalThreshold: 0.5,
    })),
    getModelStats: jest.fn(() => null),
  };

  const provider = {
    id: 'lm-studio',
    displayName: 'LM Studio',
    costClass: 'local' as const,
    isLocal: true,
    init: jest.fn(() => Promise.resolve()),
    isAvailable: jest.fn(() => Promise.resolve(true)),
    listModels: jest.fn(() => Promise.resolve([])),
    supportsModel: jest.fn(() => false),
    executeTask: jest.fn(() => Promise.resolve({ content: '', model: '' })),
    getCost: jest.fn(() => ({ prompt: 0, completion: 0 })),
  };

  beforeEach(() => {
    config.codeScoreThreshold = 0.3;
    codeModelSelector._modelPerformanceTracker = mockTracker as any;
    getModelRegistry().clear();
    
    // Seed models in ModelRegistry
    getModelRegistry().seedFromProvider(provider as any, [
      { id: 'model-low-score', displayName: 'Model Low', family: 'qwen', contextWindow: 4096 },
      { id: 'model-high-score', displayName: 'Model High', family: 'qwen', contextWindow: 4096 },
      { id: 'model-no-score', displayName: 'Model No Score', family: 'qwen', contextWindow: 4096 }
    ]);

    // Set mock models for costMonitor
    mockGetAvailableModels.mockResolvedValue([
      { id: 'model-low-score', name: 'Model Low', provider: 'lm-studio', contextWindow: 4096 },
      { id: 'model-high-score', name: 'Model High', provider: 'lm-studio', contextWindow: 4096 },
      { id: 'model-no-score', name: 'Model No Score', provider: 'lm-studio', contextWindow: 4096 }
    ]);
    mockGetFreeModels.mockResolvedValue([]);
  });

  it('filters out models below the threshold when empirical scores exist', async () => {
    // Set empirical scores
    getModelRegistry().updateBenchmarkSummary('model-low-score', {
      lastRunAt: Date.now(),
      taskCategories: ['code'],
      scores: { code: 0.2 },
      successRate: 0.5,
    });
    getModelRegistry().updateBenchmarkSummary('model-high-score', {
      lastRunAt: Date.now(),
      taskCategories: ['code'],
      scores: { code: 0.8 },
      successRate: 0.9,
    });

    const subtask = {
      id: 'task-1',
      description: 'Implement coding helper',
      complexity: 0.4,
      estimatedTokens: 1000,
    };

    // We expect only 'model-high-score' and 'model-no-score' to be evaluated.
    // Let's verify by overriding scoreModelForSubtask or checking the result.
    // If we mock scoreModelForSubtask:
    const scoredIds: string[] = [];
    const originalScoreModel = codeModelSelector.scoreModelForSubtask;
    codeModelSelector.scoreModelForSubtask = jest.fn(async (model: any) => {
      scoredIds.push(model.id);
      return model.id === 'model-high-score' ? 0.9 : 0.5;
    });

    try {
      const bestModel = await codeModelSelector.findBestModelForSubtask(subtask);
      expect(bestModel?.id).toBe('model-high-score');
      expect(scoredIds).toContain('model-high-score');
      expect(scoredIds).toContain('model-no-score');
      expect(scoredIds).not.toContain('model-low-score');
    } finally {
      codeModelSelector.scoreModelForSubtask = originalScoreModel;
    }
  });

  it('gracefully passes through models when empirical scores are absent', async () => {
    const subtask = {
      id: 'task-1',
      description: 'Implement coding helper',
      complexity: 0.4,
      estimatedTokens: 1000,
    };

    const scoredIds: string[] = [];
    const originalScoreModel = codeModelSelector.scoreModelForSubtask;
    codeModelSelector.scoreModelForSubtask = jest.fn(async (model: any) => {
      scoredIds.push(model.id);
      return model.id === 'model-no-score' ? 0.95 : 0.5;
    });

    try {
      const bestModel = await codeModelSelector.findBestModelForSubtask(subtask);
      expect(bestModel?.id).toBe('model-no-score');
      expect(scoredIds).toContain('model-low-score');
      expect(scoredIds).toContain('model-high-score');
      expect(scoredIds).toContain('model-no-score');
    } finally {
      codeModelSelector.scoreModelForSubtask = originalScoreModel;
    }
  });
});
