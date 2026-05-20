import { beforeEach, describe, expect, it, jest } from '@jest/globals';

const benchmarkTaskMock = jest.fn();
const generateSummaryMock = jest.fn();
const initBenchmarkDbMock = jest.fn();
const cleanupOldResultsMock = jest.fn();

jest.unstable_mockModule('../../../dist/modules/benchmark/core/runner.js', () => ({
  benchmarkTask: benchmarkTaskMock
}));

jest.unstable_mockModule('../../../dist/modules/benchmark/core/summary.js', () => ({
  generateSummary: generateSummaryMock
}));

jest.unstable_mockModule('../../../dist/modules/benchmark/storage/benchmarkDb.js', () => ({
  initBenchmarkDb: initBenchmarkDbMock,
  saveBenchmarkResult: jest.fn(),
  getRecentModelResults: jest.fn(),
  cleanupOldResults: cleanupOldResultsMock
}));

jest.unstable_mockModule('../../../dist/modules/benchmark/api/ollama.js', () => ({
  callOllamaApi: jest.fn()
}));

jest.unstable_mockModule('../../../dist/modules/benchmark/api/lm-studio.js', () => ({
  callLmStudioApi: jest.fn()
}));

jest.unstable_mockModule('../../../dist/modules/benchmark/api/simulation.js', () => ({
  simulateOpenAiApi: jest.fn(),
  simulateGenericApi: jest.fn()
}));

const { benchmarkModule } = await import('../../../dist/modules/benchmark/index.js');

describe('benchmarkModule', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should have the expected structure', () => {
    expect(benchmarkModule).toHaveProperty('defaultConfig');
    expect(benchmarkModule).toHaveProperty('benchmarkTask');
    expect(benchmarkModule).toHaveProperty('benchmarkTasks');
    expect(benchmarkModule).toHaveProperty('generateSummary');
    expect(benchmarkModule).toHaveProperty('api');
    expect(benchmarkModule).toHaveProperty('evaluation');
    expect(benchmarkModule).toHaveProperty('storage');
  });

  it('should run benchmarkTasks and generate a summary', async () => {
    const mockTasks = [
      { taskId: 'task1', task: 'Test task 1', contextLength: 100, expectedOutputLength: 50, complexity: 0.5 },
      { taskId: 'task2', task: 'Test task 2', contextLength: 150, expectedOutputLength: 75, complexity: 0.9 }
    ];

    const mockResults = [
      { id: 'task1', result: 'success' },
      { id: 'task2', result: 'success' }
    ];

    const mockSummary = { total: 2, success: 2 };

    initBenchmarkDbMock.mockResolvedValue(undefined);
    benchmarkTaskMock.mockImplementation((task) => mockResults.find((r) => r.id === task.taskId));
    generateSummaryMock.mockReturnValue(mockSummary);
    cleanupOldResultsMock.mockResolvedValue(undefined);

    const summary = await benchmarkModule.benchmarkTasks(mockTasks);

    expect(initBenchmarkDbMock).toHaveBeenCalledTimes(1);
    expect(benchmarkTaskMock).toHaveBeenCalledTimes(mockTasks.length);
    expect(generateSummaryMock).toHaveBeenCalledWith(mockResults);
    expect(cleanupOldResultsMock).toHaveBeenCalledTimes(1);
    expect(summary).toEqual(mockSummary);
  });
});
