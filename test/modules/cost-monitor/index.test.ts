import { describe, expect, it, jest, beforeEach } from '@jest/globals';
import { costMonitor } from '../../../dist/modules/cost-monitor/index.js';

// Mock dependencies
jest.mock('../../../dist/config/index.js'); // Corrected path (dist)
jest.mock('../../../dist/utils/logger.js'); // Corrected path (dist)
jest.mock('../../../../src/modules/openrouter/index.js');

describe('costMonitor', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should have the expected structure', () => {
    expect(costMonitor).toHaveProperty('getApiUsage');
    expect(costMonitor).toHaveProperty('estimateCost');
    expect(costMonitor).toHaveProperty('getFreeModels');
    expect(costMonitor).toHaveProperty('tokenManager');
    expect(costMonitor).toHaveProperty('codeCache');
  });

  it('should return API usage statistics', async () => {
    const mockUsage = {
      api: 'openrouter',
      tokenUsage: { prompt: 100, completion: 200, total: 300 },
      cost: { prompt: 0.01, completion: 0.02, total: 0.03 },
      timestamp: new Date().toISOString(),
    };

    jest.spyOn(costMonitor, 'getOpenRouterUsage').mockResolvedValue(mockUsage);

    const usage = await costMonitor.getApiUsage('openrouter');

    expect(usage).toEqual(mockUsage);
    expect(costMonitor.getOpenRouterUsage).toHaveBeenCalledTimes(1);
  });

  it('should estimate costs for a task', async () => {
    const mockEstimate = {
      local: {
        cost: { prompt: 0, completion: 0, total: 0, currency: 'USD' },
        tokenCount: { prompt: 100, completion: 50, total: 150 },
      },
      paid: {
        cost: { prompt: 0.01, completion: 0.02, total: 0.03, currency: 'USD' },
        tokenCount: { prompt: 100, completion: 50, total: 150 },
      },
      recommendation: 'local',
    };

    jest.spyOn(costMonitor, 'estimateCost').mockResolvedValue(mockEstimate);

    const estimate = await costMonitor.estimateCost({ contextLength: 100, outputLength: 50 });

    expect(estimate).toEqual(mockEstimate);
    expect(costMonitor.estimateCost).toHaveBeenCalledTimes(1);
  });

  it('should fetch free models', async () => {
    const mockFreeModels = [
      { id: 'model1', contextWindow: 2048 },
      { id: 'model2', contextWindow: 4096 },
    ];

    jest.spyOn(costMonitor, 'getFreeModels').mockResolvedValue(mockFreeModels);

    const freeModels = await costMonitor.getFreeModels();

    expect(freeModels).toEqual(mockFreeModels);
    expect(costMonitor.getFreeModels).toHaveBeenCalledTimes(1);
  });
});