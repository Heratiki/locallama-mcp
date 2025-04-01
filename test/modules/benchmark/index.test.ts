import { benchmarkModule } from '../../../dist/modules/benchmark/index.js';
import { benchmarkTask } from '../../../dist/modules/benchmark/core/runner.js';
import { generateSummary } from '../../../dist/modules/benchmark/core/summary.js';
import { initBenchmarkDb, cleanupOldResults } from '../../../dist/modules/benchmark/storage/benchmarkDb.js';

jest.mock('../../../dist/modules/benchmark/core/runner.js');
jest.mock('../../../dist/modules/benchmark/core/summary.js');
jest.mock('../../../dist/modules/benchmark/storage/benchmarkDb.ts');
jest.mock('../../../dist/modules/benchmark/api/ollama.js');
jest.mock('../../../dist/modules/benchmark/api/lm-studio.js');
jest.mock('../../../dist/modules/benchmark/api/simulation.js');

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

    (initBenchmarkDb as jest.Mock).mockResolvedValue(undefined);
    (benchmarkTask as jest.Mock).mockImplementation((task) => mockResults.find(r => r.id === task.taskId));
    (generateSummary as jest.Mock).mockReturnValue(mockSummary);
    (cleanupOldResults as jest.Mock).mockResolvedValue(undefined);

    const summary = await benchmarkModule.benchmarkTasks(mockTasks);

    expect(initBenchmarkDb).toHaveBeenCalledTimes(1);
    expect(benchmarkTask).toHaveBeenCalledTimes(mockTasks.length);
    expect(generateSummary).toHaveBeenCalledWith(mockResults);
    expect(cleanupOldResults).toHaveBeenCalledTimes(1);
    expect(summary).toEqual(mockSummary);
  });
});