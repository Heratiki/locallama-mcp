import { benchmarkModule } from '../../../../src/modules/benchmark/index.js';
import { benchmarkTask } from '../../../../src/modules/benchmark/core/runner.js';
import { generateSummary } from '../../../../src/modules/benchmark/core/summary.js';
import { initBenchmarkDb, cleanupOldResults } from '../../../../src/modules/benchmark/storage/benchmarkDb.js';

jest.mock('../../../../src/modules/benchmark/core/runner.js');
jest.mock('../../../../src/modules/benchmark/core/summary.js');
jest.mock('../../../../src/modules/benchmark/storage/benchmarkDb.js');

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
      { id: 'task1', params: {} },
      { id: 'task2', params: {} }
    ];
    const mockResults = [
      { id: 'task1', result: 'success' },
      { id: 'task2', result: 'success' }
    ];
    const mockSummary = { total: 2, success: 2 };

    (initBenchmarkDb as jest.Mock).mockResolvedValue(undefined);
    (benchmarkTask as jest.Mock).mockImplementation((task) => mockResults.find(r => r.id === task.id));
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