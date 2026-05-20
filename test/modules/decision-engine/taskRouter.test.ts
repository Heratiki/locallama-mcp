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

const mockGetBestPerformingModels = jest.fn<(...args: any[]) => any[]>().mockReturnValue([]);
jest.unstable_mockModule('../../../dist/modules/decision-engine/services/modelPerformance.js', () => ({
  modelPerformanceTracker: {
    getBestPerformingModels: mockGetBestPerformingModels,
    recordModelUsage: jest.fn(),
  },
}));

const mockGetAvailableModels = jest.fn<() => Promise<any[]>>().mockResolvedValue([]);
jest.unstable_mockModule('../../../dist/modules/cost-monitor/index.js', () => ({
  costMonitor: {
    getAvailableModels: mockGetAvailableModels,
  },
}));

// Load modules under test dynamically after mocks are declared
const { taskRouter } = await import('../../../dist/modules/decision-engine/services/taskRouter.js');
const { getModelRegistry } = await import('../../../dist/modules/core/model/index.js');

describe('taskRouter largeContext capability filtering', () => {
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
    getModelRegistry().clear();
    mockGetBestPerformingModels.mockReturnValue([]);
    mockGetAvailableModels.mockResolvedValue([]);
  });

  it('filters models by largeContext capability when task requires large context (>= 32k)', async () => {
    // 1. Seed models in ModelRegistry
    // model-large-context has caps.largeContext = true (empirically supported or inferred via 32k context)
    // model-small-context has caps.largeContext = false
    // model-no-registry does not exist in registry
    getModelRegistry().seedFromProvider(provider as any, [
      { id: 'model-large-context', displayName: 'Large Model', family: 'qwen', contextWindow: 32768 },
      { id: 'model-small-context', displayName: 'Small Model', family: 'qwen', contextWindow: 4096 }
    ]);

    const task = {
      complexity: 0.5,
      estimatedTokens: 40000, // Requires large context
      priority: 'cost' as const
    };

    // Set available models
    const models = [
      { id: 'model-large-context', name: 'Large Model', provider: 'lm-studio', contextWindow: 32768 },
      { id: 'model-small-context', name: 'Small Model', provider: 'lm-studio', contextWindow: 4096 },
      { id: 'model-no-registry', name: 'No Registry', provider: 'lm-studio', contextWindow: 65536 } // Large context window, but not in registry
    ];
    mockGetAvailableModels.mockResolvedValue(models);

    // Let's test fallbackModelSelection via routeTask (since getBestPerformingModels returns empty, it falls back)
    const selectedModel = await taskRouter.routeTask(task);

    // model-small-context should be filtered out (largeContext = false)
    // model-large-context should be kept (largeContext = true)
    // model-no-registry should be kept (not in registry, falls back to contextWindow 65536 >= 40000)
    // We expect the router to pick model-large-context or model-no-registry, but NOT model-small-context.
    expect(selectedModel).not.toBeNull();
    expect(selectedModel!.id).not.toBe('model-small-context');
  });

  it('filters out model-large-context if task requires large context but largeContext capability is explicitly false', async () => {
    getModelRegistry().seedFromProvider(provider as any, [
      { id: 'model-large-context-lying', displayName: 'Large Model Lying', family: 'qwen', contextWindow: 65536 }
    ]);

    // Manually override capabilities.largeContext to false to simulate registry/overrides file stating it doesn't actually support large context
    const modelMeta = getModelRegistry().getModel('model-large-context-lying')!;
    modelMeta.capabilities.largeContext = false;

    const task = {
      complexity: 0.5,
      estimatedTokens: 40000,
      priority: 'cost' as const
    };

    mockGetAvailableModels.mockResolvedValue([
      { id: 'model-large-context-lying', name: 'Large Model Lying', provider: 'lm-studio', contextWindow: 65536 }
    ]);

    const selectedModel = await taskRouter.routeTask(task);
    // Since the only model available is marked as false for largeContext, it should return null
    expect(selectedModel).toBeNull();
  });
});
