import { beforeEach, describe, expect, it, jest } from '@jest/globals';

const getFreeModelsMock = jest.fn();
const executeTaskMock = jest.fn();
const initBenchmarkDbMock = jest.fn();
const saveBenchmarkResultMock = jest.fn();
const getRecentModelResultsMock = jest.fn();

jest.unstable_mockModule('../../../dist/modules/cost-monitor/index.js', () => ({
  costMonitor: {
    getFreeModels: getFreeModelsMock,
    getAvailableModels: jest.fn().mockResolvedValue([])
  }
}));

jest.unstable_mockModule('../../../dist/modules/core/provider/index.js', () => ({
  getProviderRegistry: jest.fn(() => ({
    get: jest.fn((providerId: string) => providerId === 'openrouter'
      ? {
          id: 'openrouter',
          executeTask: executeTaskMock
        }
      : undefined)
  })),
  isProviderLocal: jest.fn((providerId: string) => providerId === 'ollama' || providerId === 'lm-studio')
}));

jest.unstable_mockModule('../../../dist/modules/benchmark/storage/benchmarkDb.js', () => ({
  initBenchmarkDb: initBenchmarkDbMock,
  saveBenchmarkResult: saveBenchmarkResultMock,
  getRecentModelResults: getRecentModelResultsMock
}));

jest.unstable_mockModule('../../../dist/modules/decision-engine/services/codeEvaluationService.js', () => ({
  codeEvaluationService: {
    evaluateCodeQuality: jest.fn()
  }
}));

const { benchmarkFreeModels } = await import('../../../dist/modules/benchmark/core/runner.js');

describe('benchmarkFreeModels', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    initBenchmarkDbMock.mockResolvedValue(undefined);
    getRecentModelResultsMock.mockResolvedValue(null);
    getFreeModelsMock.mockResolvedValue([]);
    executeTaskMock.mockResolvedValue({
      content: 'function add(a, b) { return a + b; }',
      model: 'openrouter/free-code',
      promptTokens: 10,
      completionTokens: 20
    });
  });

  it('benchmarks free models through the modular runner and stores results in benchmarkDb', async () => {
    getFreeModelsMock.mockResolvedValue([
      {
        id: 'openrouter/free-code',
        name: 'Free Code',
        provider: 'openrouter',
        contextWindow: 4096,
        capabilities: { chat: true, completion: true },
        costPerToken: { prompt: 0, completion: 0 }
      }
    ]);

    const result = await benchmarkFreeModels({
      tasks: [
        {
          taskId: 'free-model-smoke',
          task: 'Write a JavaScript add function.',
          contextLength: 80,
          expectedOutputLength: 40,
          complexity: 0.2
        }
      ],
      runsPerTask: 1,
      parallel: false,
      maxParallelTasks: 1
    });

    expect(getFreeModelsMock).toHaveBeenCalledWith(true);
    expect(executeTaskMock).toHaveBeenCalledWith(
      'openrouter/free-code',
      'Write a JavaScript add function.',
      expect.objectContaining({ timeoutMs: expect.any(Number) })
    );
    expect(saveBenchmarkResultMock).toHaveBeenCalledTimes(1);
    expect(saveBenchmarkResultMock).toHaveBeenCalledWith(expect.objectContaining({
      taskId: 'free-model-smoke-openrouter_free_code',
      paid: expect.objectContaining({
        model: 'openrouter/free-code',
        successRate: 1
      })
    }));
    expect(result.summary).toMatchObject({
      modelsCount: 1,
      tasksCount: 1,
      runsCount: 1
    });
    expect(result.results['openrouter/free-code']).toMatchObject({
      successfulTasks: 1,
      totalTasks: 1,
      successRate: 1
    });
  });

  it('propagates rate-limit failures as structured benchmark provider errors', async () => {
    getFreeModelsMock.mockResolvedValue([
      {
        id: 'openrouter/free-code',
        name: 'Free Code',
        provider: 'openrouter',
        contextWindow: 4096,
        capabilities: { chat: true, completion: true },
        costPerToken: { prompt: 0, completion: 0 }
      }
    ]);
    executeTaskMock.mockRejectedValue(new Error('OpenRouter rate limit reached (10 calls/min). Retry after 60s.'));

    await expect(benchmarkFreeModels({
      tasks: [
        {
          taskId: 'rate-limit-case',
          task: 'Write a JavaScript add function.',
          contextLength: 80,
          expectedOutputLength: 40,
          complexity: 0.2
        }
      ]
    })).rejects.toMatchObject({
      name: 'BenchmarkProviderError',
      code: 'benchmark_rate_limited',
      providerId: 'openrouter',
      modelId: 'openrouter/free-code'
    });

    expect(saveBenchmarkResultMock).not.toHaveBeenCalled();
  });
});
