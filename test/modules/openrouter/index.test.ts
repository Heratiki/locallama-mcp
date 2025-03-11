import { openRouterModule } from '../../../src/modules/openrouter/index.js';
import { config } from '../../../src/config/index.js';
import { logger } from '../../../src/utils/logger.js';
import fs from 'fs/promises';
import path from 'path';

// Mock dependencies
jest.mock('../../../src/config/index');
jest.mock('../../../src/utils/logger');
jest.mock('fs/promises');

describe('OpenRouter Module', () => {
  beforeEach(() => {
    jest.resetAllMocks();
    
    // Set default config values for testing
    (config as jest.Mocked<typeof config>).openRouterApiKey = 'test-key';
    (config as jest.Mocked<typeof config>).rootDir = '/test/root';
  });

  describe('initialization', () => {
    test('loads existing tracking data', async () => {
      const mockData = {
        models: {
          'model1': {
            id: 'model1',
            name: 'Model 1',
            provider: 'openai',
            isFree: true,
            contextWindow: 4096,
            capabilities: { chat: true, completion: true, vision: false },
            costPerToken: { prompt: 0, completion: 0 },
            lastUpdated: new Date().toISOString()
          },
          'model2': {
            id: 'model2',
            name: 'Model 2',
            provider: 'anthropic',
            isFree: false,
            contextWindow: 8192,
            capabilities: { chat: true, completion: true, vision: false },
            costPerToken: { prompt: 0.01, completion: 0.02 },
            lastUpdated: new Date().toISOString()
          }
        },
        lastUpdated: new Date().toISOString(),
        freeModels: ['model1']
      };

      (fs.readFile as jest.Mock).mockResolvedValue(JSON.stringify(mockData));

      await openRouterModule.initialize();
      expect(openRouterModule.modelTracking.models).toEqual(mockData.models);
      expect(openRouterModule.modelTracking.freeModels).toEqual(mockData.freeModels);
    });

    test('creates new tracking data when none exists', async () => {
      (fs.readFile as jest.Mock).mockRejectedValue(new Error('File not found'));

      await openRouterModule.initialize();
      expect(openRouterModule.modelTracking.models).toEqual({});
      expect(openRouterModule.modelTracking.freeModels).toEqual([]);
    });

    test('loads prompting strategies', async () => {
      const mockStrategies = {
        'task1': { prompt: 'test prompt', system: 'test system' }
      };

      (fs.readFile as jest.Mock)
        .mockResolvedValueOnce('{}') // For tracking data
        .mockResolvedValueOnce(JSON.stringify(mockStrategies));

      await openRouterModule.initialize();
      expect(openRouterModule.promptingStrategies).toEqual(mockStrategies);
    });

    test('forces update when specified', async () => {
      await openRouterModule.initialize(true);
      expect(logger.debug).toHaveBeenCalledWith(expect.stringContaining('Forcing update'));
    });
  });

  describe('free model detection', () => {
    beforeEach(async () => {
      await openRouterModule.initialize();
    });

    test('gets free models', async () => {
      const mockModels: Record<string, any> = {
        'model1': {
          id: 'model1',
          name: 'Model 1',
          provider: 'openai',
          isFree: true,
          contextWindow: 4096,
          capabilities: { chat: true, completion: true, vision: false },
          costPerToken: { prompt: 0, completion: 0 },
          lastUpdated: new Date().toISOString()
        },
        'model2': {
          id: 'model2',
          name: 'Model 2',
          provider: 'anthropic',
          isFree: true,
          contextWindow: 8192,
          capabilities: { chat: true, completion: true, vision: false },
          costPerToken: { prompt: 0, completion: 0 },
          lastUpdated: new Date().toISOString()
        },
        'model3': {
          id: 'model3',
          name: 'Model 3',
          provider: 'google',
          isFree: false,
          contextWindow: 16384,
          capabilities: { chat: true, completion: true, vision: false },
          costPerToken: { prompt: 0.01, completion: 0.02 },
          lastUpdated: new Date().toISOString()
        }
      };

      openRouterModule.modelTracking.models = mockModels;
      openRouterModule.modelTracking.freeModels = ['model1', 'model2'];

      const freeModels = await openRouterModule.getFreeModels();
      expect(freeModels).toHaveLength(2);
      expect(freeModels.map(m => m.id)).toEqual(['model1', 'model2']);
    });

    test('updates free models list', async () => {
      const oldModels = {
        'model1': {
          id: 'model1',
          name: 'Model 1',
          provider: 'openai',
          isFree: true,
          contextWindow: 4096,
          capabilities: { chat: true, completion: true, vision: false },
          costPerToken: { prompt: 0, completion: 0 },
          lastUpdated: new Date().toISOString()
        }
      };
      
      const newModels = {
        'model2': {
          id: 'model2',
          name: 'Model 2',
          provider: 'anthropic',
          isFree: true,
          contextWindow: 8192,
          capabilities: { chat: true, completion: true, vision: false },
          costPerToken: { prompt: 0, completion: 0 },
          lastUpdated: new Date().toISOString()
        }
      };

      openRouterModule.modelTracking.models = oldModels;
      openRouterModule.modelTracking.freeModels = ['model1'];

      await openRouterModule.updateModels();
      expect(openRouterModule.modelTracking.freeModels).toContain('model2');
    });

    test('handles no free models', async () => {
      openRouterModule.modelTracking.models = {
        'model1': {
          id: 'model1',
          name: 'Model 1',
          provider: 'openai',
          isFree: false,
          contextWindow: 4096,
          capabilities: { chat: true, completion: true, vision: false },
          costPerToken: { prompt: 0.01, completion: 0.02 },
          lastUpdated: new Date().toISOString()
        }
      };
      openRouterModule.modelTracking.freeModels = [];

      const freeModels = await openRouterModule.getFreeModels();
      expect(freeModels).toHaveLength(0);
    });
  });

  describe('prompting strategies', () => {
    beforeEach(async () => {
      await openRouterModule.initialize();
    });

    test('updates prompting strategy', async () => {
      const strategy = {
        systemPrompt: 'test system prompt',
        userPrompt: 'test user prompt',
        assistantPrompt: 'test assistant prompt',
        useChat: true
      };
      const successRate = 0.8;
      const qualityScore = 0.9;

      await openRouterModule.updatePromptingStrategy('task1', strategy, successRate, qualityScore);
      expect(openRouterModule.promptingStrategies['task1']).toEqual(strategy);
      expect(fs.writeFile).toHaveBeenCalled();
    });

    test('gets prompting strategy', () => {
      const strategy = {
        modelId: 'test-model',
        systemPrompt: 'test system prompt',
        userPrompt: 'test user prompt',
        assistantPrompt: 'test assistant prompt',
        useChat: true,
        successRate: 0.8,
        qualityScore: 0.9,
        lastUpdated: new Date().toISOString()
      };

      openRouterModule.promptingStrategies['task1'] = strategy;
      expect(openRouterModule.getPromptingStrategy('task1')).toEqual(strategy);
    });

    test('handles missing strategy', () => {
      expect(openRouterModule.getPromptingStrategy('nonexistent')).toBeUndefined();
    });
  });

  describe('tracking data management', () => {
    test('clears tracking data', async () => {
      const mockData = {
        models: {
          'model1': {
            id: 'model1',
            name: 'Model 1',
            provider: 'openai',
            isFree: true,
            contextWindow: 4096,
            capabilities: { chat: true, completion: true, vision: false },
            costPerToken: { prompt: 0, completion: 0 },
            lastUpdated: new Date().toISOString()
          }
        },
        freeModels: ['model1'],
        lastUpdated: new Date().toISOString()
      };

      openRouterModule.modelTracking = mockData;

      await openRouterModule.clearTrackingData();
      expect(openRouterModule.modelTracking.models).toEqual({});
      expect(openRouterModule.modelTracking.freeModels).toEqual([]);
      expect(fs.writeFile).toHaveBeenCalled();
    });

    test('saves tracking data', async () => {
      await openRouterModule.saveTrackingData();
      expect(fs.writeFile).toHaveBeenCalledWith(
        expect.stringContaining('openrouter-tracking.json'),
        expect.any(String)
      );
    });

    test('handles save errors', async () => {
      (fs.writeFile as jest.Mock).mockRejectedValue(new Error('Write error'));
      await expect(openRouterModule.saveTrackingData()).rejects.toThrow();
      expect(logger.error).toHaveBeenCalled();
    });
  });

  describe('benchmarking', () => {
    test('benchmarks prompting strategies', async () => {
      const task = 'test task';
      const modelId = 'test-model';
      const timeout = 5000;

      const result = await openRouterModule.benchmarkPromptingStrategies(modelId, task, timeout);
      expect(result).toHaveProperty('bestStrategy');
      expect(result).toHaveProperty('success');
      expect(result).toHaveProperty('usage');
    });

    test('evaluates response quality', () => {
      const task = 'Write a function to calculate factorial';
      const response = 'Here is a recursive factorial function...';

      const quality = openRouterModule.evaluateQuality(task, response);
      expect(quality).toBeGreaterThanOrEqual(0);
      expect(quality).toBeLessThanOrEqual(1);
    });
  });
});