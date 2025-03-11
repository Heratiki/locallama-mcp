import axios from 'axios';
import { fallbackHandler } from '../../../src/modules/fallback-handler/index.js';
import { config } from '../../../src/config/index.js';
import { openRouterModule } from '../../../src/modules/openrouter/index.js';
import { logger } from '../../../src/utils/logger.js';

// Mock dependencies
jest.mock('axios');
jest.mock('../../../src/config/index');
jest.mock('../../../src/modules/openrouter/index');
jest.mock('../../../src/utils/logger');

describe('Fallback Handler', () => {
  beforeEach(() => {
    jest.resetAllMocks();
    
    // Set default config values for testing
    (config as jest.Mocked<typeof config>).lmStudioEndpoint = 'http://localhost:1234/v1';
    (config as jest.Mocked<typeof config>).ollamaEndpoint = 'http://localhost:11434/api';
    (config as jest.Mocked<typeof config>).openRouterApiKey = 'test-key';
  });

  describe('service availability checks', () => {
    test('checks LM Studio availability', async () => {
      (axios.get as jest.Mock).mockResolvedValue({ status: 200 });
      const result = await fallbackHandler.checkServiceAvailability('lm-studio');
      expect(result).toBe(true);
      expect(axios.get).toHaveBeenCalledWith(
        'http://localhost:1234/v1/models',
        expect.any(Object)
      );
    });

    test('checks Ollama availability', async () => {
      (axios.get as jest.Mock).mockResolvedValue({ status: 200 });
      const result = await fallbackHandler.checkServiceAvailability('ollama');
      expect(result).toBe(true);
      expect(axios.get).toHaveBeenCalledWith(
        'http://localhost:11434/api/tags',
        expect.any(Object)
      );
    });

    test('checks paid API availability', async () => {
      (openRouterModule.getFreeModels as jest.Mock).mockResolvedValue([{ id: 'model1' }]);
      const result = await fallbackHandler.checkServiceAvailability('paid-api');
      expect(result).toBe(true);
    });

    test('handles LM Studio failure', async () => {
      (axios.get as jest.Mock).mockRejectedValue(new Error('Connection refused'));
      const result = await fallbackHandler.checkServiceAvailability('lm-studio');
      expect(result).toBe(false);
    });

    test('handles Ollama failure', async () => {
      (axios.get as jest.Mock).mockRejectedValue(new Error('Connection refused'));
      const result = await fallbackHandler.checkServiceAvailability('ollama');
      expect(result).toBe(false);
    });

    test('handles paid API without API key', async () => {
      (config as jest.Mocked<typeof config>).openRouterApiKey = undefined;
      const result = await fallbackHandler.checkServiceAvailability('paid-api');
      expect(result).toBe(false);
    });

    test('handles paid API failure', async () => {
      (openRouterModule.getFreeModels as jest.Mock).mockRejectedValue(new Error('API error'));
      const result = await fallbackHandler.checkServiceAvailability('paid-api');
      expect(result).toBe(false);
    });

    test('handles service check timeouts', async () => {
      // Mock a timeout
      (axios.get as jest.Mock).mockRejectedValue(new Error('timeout'));
      
      const result = await fallbackHandler.checkServiceAvailability('lm-studio');
      
      expect(result).toBe(false);
    });

    test('handles service check errors', async () => {
      // Mock a connection error
      (axios.get as jest.Mock).mockRejectedValue(new Error('connection refused'));
      
      const result = await fallbackHandler.checkServiceAvailability('ollama');
      
      expect(result).toBe(false);
    });
  });

  describe('fallback strategies', () => {
    test('handles fallback when all services are down', async () => {
      // Simulate all services being down
      (axios.get as jest.Mock).mockRejectedValue(new Error('Connection refused'));
      (openRouterModule.getFreeModels as jest.Mock).mockRejectedValue(new Error('API error'));

      const fallbackOption = await fallbackHandler.getBestFallbackOption('local');
      expect(fallbackOption).toBeNull();
    });

    test('detects available fallback services', async () => {
      // Simulate LM Studio being available
      (axios.get as jest.Mock).mockImplementation((url) => {
        if (url.includes('models')) {
          return Promise.resolve({ status: 200 });
        }
        return Promise.reject(new Error('Connection refused'));
      });

      const fallbackOption = await fallbackHandler.getBestFallbackOption('paid');
      expect(fallbackOption).toBe('lm-studio');
    });

    test('prioritizes services correctly', async () => {
      // Simulate all services being available
      (axios.get as jest.Mock).mockResolvedValue({ status: 200 });
      (openRouterModule.getFreeModels as jest.Mock).mockResolvedValue([{ id: 'model1' }]);

      const localFallback = await fallbackHandler.getBestFallbackOption('local');
      expect(localFallback).toBe('paid-api');

      const paidFallback = await fallbackHandler.getBestFallbackOption('paid');
      expect(paidFallback).toBe('lm-studio');
    });
  });

  describe('retry mechanism', () => {
    test('retries failed requests', async () => {
      const mockAxios = axios.get as jest.Mock;
      mockAxios
        .mockRejectedValueOnce(new Error('Temporary error'))
        .mockResolvedValueOnce({ status: 200 });

      const result = await fallbackHandler.checkServiceAvailability('lm-studio');
      expect(result).toBe(true);
      expect(mockAxios).toHaveBeenCalledTimes(2);
    });

    test('respects retry limits', async () => {
      const mockAxios = axios.get as jest.Mock;
      mockAxios.mockRejectedValue(new Error('Persistent error'));

      const result = await fallbackHandler.checkServiceAvailability('lm-studio');
      expect(result).toBe(false);
      expect(mockAxios.mock.calls.length).toBeLessThanOrEqual(3); // Default max retries
    });
  });

  describe('error handling', () => {
    test('handles network timeout', async () => {
      (axios.get as jest.Mock).mockRejectedValue(new Error('timeout'));
      const result = await fallbackHandler.checkServiceAvailability('lm-studio');
      expect(result).toBe(false);
      expect(logger.warn).toHaveBeenCalled();
    });

    test('handles invalid response', async () => {
      (axios.get as jest.Mock).mockResolvedValue({ status: 500 });
      const result = await fallbackHandler.checkServiceAvailability('lm-studio');
      expect(result).toBe(false);
      expect(logger.warn).toHaveBeenCalled();
    });

    test('handles unexpected errors', async () => {
      (axios.get as jest.Mock).mockImplementation(() => {
        throw new Error('Unexpected error');
      });
      const result = await fallbackHandler.checkServiceAvailability('lm-studio');
      expect(result).toBe(false);
      expect(logger.error).toHaveBeenCalled();
    });

    test('handles local service errors with fallback', async () => {
      const error = new Error('Local service unavailable');
      const context = {
        operation: 'process_code',
        provider: 'local' as const,
        fallbackAvailable: true,
        task: 'test task',
        modelId: 'llama3'
      };

      // Mock service availability check
      jest.spyOn(fallbackHandler, 'checkServiceAvailability').mockResolvedValue(true);
      jest.spyOn(fallbackHandler, 'getBestFallbackOption').mockResolvedValue('paid-api');

      const result = await fallbackHandler.handleError(error, context);
      
      expect(result.success).toBe(true);
      expect(result.fallbackUsed).toBe(true);
    });

    test('handles paid API errors with fallback', async () => {
      const error = new Error('API rate limit exceeded');
      const context = {
        operation: 'generate_code',
        provider: 'paid' as const,
        fallbackAvailable: true,
        task: 'test task'
      };

      // Mock service availability check
      jest.spyOn(fallbackHandler, 'checkServiceAvailability').mockResolvedValue(true);
      jest.spyOn(fallbackHandler, 'getBestFallbackOption').mockResolvedValue('lm-studio');

      const result = await fallbackHandler.handleError(error, context);
      
      expect(result.success).toBe(true);
      expect(result.fallbackUsed).toBe(true);
    });

    test('handles errors when no fallback is available', async () => {
      const error = new Error('Service error');
      const context = {
        operation: 'process_code',
        provider: 'local' as const,
        fallbackAvailable: false,
        task: 'test task'
      };

      const result = await fallbackHandler.handleError(error, context);
      
      expect(result.success).toBe(false);
      expect(result.fallbackUsed).toBe(false);
    });
  });

  describe('fallback options', () => {
    test('gets best available fallback for local service', async () => {
      // Mock service availability checks
      jest.spyOn(fallbackHandler, 'checkServiceAvailability')
        .mockResolvedValueOnce(true);  // Paid API available

      const option = await fallbackHandler.getBestFallbackOption('local');
      
      expect(option).toBe('paid-api');
    });

    test('gets best available fallback for paid API', async () => {
      // Mock service availability checks
      jest.spyOn(fallbackHandler, 'checkServiceAvailability')
        .mockResolvedValueOnce(true);  // LM Studio available

      const option = await fallbackHandler.getBestFallbackOption('paid');
      
      expect(option).toBe('lm-studio');
    });

    test('handles no available fallback options', async () => {
      // Mock all services being unavailable
      jest.spyOn(fallbackHandler, 'checkServiceAvailability')
        .mockResolvedValue(false);

      const option = await fallbackHandler.getBestFallbackOption('local');
      
      expect(option).toBeNull();
    });
  });

  describe('error recovery', () => {
    test('recovers from temporary service disruptions', async () => {
      const error = new Error('Temporary service disruption');
      const context = {
        operation: 'process_code',
        provider: 'local' as const,
        fallbackAvailable: true,
        task: 'test task',
        timeout: 1000
      };

      // Mock service becoming available after retry
      jest.spyOn(fallbackHandler, 'getBestFallbackOption')
        .mockResolvedValue('paid-api');

      const result = await fallbackHandler.handleError(error, context);
      
      expect(result.success).toBe(true);
      expect(result.fallbackUsed).toBe(true);
    });

    test('handles permanent service failures', async () => {
      const error = new Error('Service permanently unavailable');
      const context = {
        operation: 'process_code',
        provider: 'local' as const,
        fallbackAvailable: true,
        task: 'test task',
        timeout: 1000
      };

      // Mock service remaining unavailable
      jest.spyOn(fallbackHandler, 'getBestFallbackOption')
        .mockResolvedValue(null);

      const result = await fallbackHandler.handleError(error, context);
      
      expect(result.success).toBe(false);
      expect(result.fallbackUsed).toBe(false);
    });

    test('respects timeout constraints', async () => {
      const error = new Error('Service error');
      const context = {
        operation: 'process_code',
        provider: 'local' as const,
        fallbackAvailable: true,
        task: 'test task',
        timeout: 100 // Very short timeout
      };

      // Mock a delayed service check
      jest.spyOn(fallbackHandler, 'getBestFallbackOption')
        .mockImplementation(() => new Promise(resolve => setTimeout(() => resolve('paid-api'), 200)));

      const result = await fallbackHandler.handleError(error, context);
      
      expect(result.success).toBe(false);
      expect(result.fallbackUsed).toBe(false);
    });
  });
});