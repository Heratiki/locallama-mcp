import { beforeEach, describe, expect, it, jest } from '@jest/globals';

const benchmarkFreeModelsMock = jest.fn();

jest.unstable_mockModule('../../../dist/config/index.js', () => ({
  config: {
    openRouterApiKey: 'test-key'
  }
}));

jest.unstable_mockModule('../../../dist/utils/logger.js', () => ({
  logger: {
    error: jest.fn(),
    warn: jest.fn(),
    info: jest.fn(),
    debug: jest.fn()
  }
}));

jest.unstable_mockModule('../../../dist/modules/openrouter/index.js', () => ({
  openRouterModule: {
    modelTracking: { models: {} },
    initialize: jest.fn(),
    executeTask: jest.fn(),
    clearTrackingData: jest.fn(),
    getFreeModels: jest.fn().mockResolvedValue([]),
    updatePromptingStrategy: jest.fn()
  }
}));

jest.unstable_mockModule('../../../dist/modules/benchmark/index.js', () => ({
  benchmarkModule: {
    benchmarkFreeModels: benchmarkFreeModelsMock
  }
}));

jest.unstable_mockModule('../../../dist/modules/decision-engine/services/benchmarkService.js', () => {
  throw new Error('legacy benchmarkService should not be imported by openrouter-integration');
});

const { benchmarkFreeModels } = await import('../../../dist/modules/api-integration/openrouter-integration/index.js');

describe('openrouter-integration benchmarkFreeModels', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    benchmarkFreeModelsMock.mockResolvedValue({
      results: {},
      summary: {
        bestQualityModel: 'none',
        bestSpeedModel: 'none',
        totalTime: 0,
        modelsCount: 0,
        tasksCount: 0,
        runsCount: 0
      }
    });
  });

  it('delegates benchmark_free_models to the modular benchmark engine', async () => {
    const result = await benchmarkFreeModels({
      tasks: [
        {
          taskId: 'free-model-api',
          task: 'Write a TypeScript debounce helper.',
          contextLength: 120,
          expectedOutputLength: 60,
          complexity: 0.3
        }
      ],
      runsPerTask: 1,
      parallel: false,
      maxParallelTasks: 1
    });

    expect(benchmarkFreeModelsMock).toHaveBeenCalledWith({
      tasks: [
        {
          taskId: 'free-model-api',
          task: 'Write a TypeScript debounce helper.',
          contextLength: 120,
          expectedOutputLength: 60,
          complexity: 0.3
        }
      ],
      runsPerTask: 1,
      parallel: false,
      maxParallelTasks: 1
    });
    expect(result.summary.modelsCount).toBe(0);
  });
});
