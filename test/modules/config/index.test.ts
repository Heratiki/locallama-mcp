import { config, validateConfig, Config } from '../../../src/config/index.js';
import dotenv from 'dotenv';

// Mock dependencies
jest.mock('dotenv');

describe('Config', () => {
  // Store original environment
  const originalEnv = process.env;

  beforeEach(() => {
    // Reset environment for each test
    process.env = { ...originalEnv };
    jest.resetAllMocks();
  });

  afterAll(() => {
    // Restore original environment
    process.env = originalEnv;
  });

  describe('validateConfig', () => {
    test('validates valid configuration', () => {
      // Set up valid config values
      config.server.port = 3000;
      config.lmStudioEndpoint = 'http://localhost:1234';
      config.ollamaEndpoint = 'http://localhost:11434';
      config.tokenThreshold = 1000;
      config.costThreshold = 0.02;
      config.qualityThreshold = 0.7;
      config.defaultModelConfig.temperature = 0.7;
      config.defaultModelConfig.topP = 0.9;
      config.defaultModelConfig.maxTokens = 2048;
      config.benchmark.runsPerTask = 3;
      config.benchmark.maxParallelTasks = 2;
      config.benchmark.taskTimeout = 60000;
      config.maxCacheSize = 1073741824;

      expect(() => validateConfig()).not.toThrow();
    });

    test('validates server port', () => {
      config.server.port = -1;
      expect(() => validateConfig()).toThrow('Invalid port number');

      config.server.port = 70000;
      expect(() => validateConfig()).toThrow('Invalid port number');
    });

    test('validates endpoint URLs', () => {
      config.lmStudioEndpoint = 'not-a-url';
      expect(() => validateConfig()).toThrow('Invalid endpoint URL');

      config.ollamaEndpoint = 'also-not-a-url';
      expect(() => validateConfig()).toThrow('Invalid endpoint URL');
    });

    test('validates thresholds', () => {
      config.tokenThreshold = 0;
      expect(() => validateConfig()).toThrow('Invalid token threshold');

      config.costThreshold = -1;
      expect(() => validateConfig()).toThrow('Invalid cost threshold');

      config.qualityThreshold = 1.5;
      expect(() => validateConfig()).toThrow('Invalid quality threshold');
    });

    test('validates model config', () => {
      config.defaultModelConfig.temperature = -0.1;
      expect(() => validateConfig()).toThrow('Invalid temperature');

      config.defaultModelConfig.temperature = 2.5;
      expect(() => validateConfig()).toThrow('Invalid temperature');

      config.defaultModelConfig.topP = 1.5;
      expect(() => validateConfig()).toThrow('Invalid topP');

      config.defaultModelConfig.maxTokens = 0;
      expect(() => validateConfig()).toThrow('Invalid maxTokens');
    });

    test('validates benchmark config', () => {
      config.benchmark.runsPerTask = 0;
      expect(() => validateConfig()).toThrow('Invalid runsPerTask');

      config.benchmark.maxParallelTasks = -1;
      expect(() => validateConfig()).toThrow('Invalid maxParallelTasks');

      config.benchmark.taskTimeout = 0;
      expect(() => validateConfig()).toThrow('Invalid taskTimeout');
    });

    test('validates cache settings', () => {
      config.maxCacheSize = 0;
      expect(() => validateConfig()).toThrow('Invalid maxCacheSize');
    });
  });

  describe('environment variables', () => {
    beforeEach(() => {
      // Reset config mock
      jest.resetModules();
    });

    test('loads server config from environment', () => {
      process.env.PORT = '4000';
      process.env.HOST = '127.0.0.1';
      process.env.API_PREFIX = '/api/v1';

      const { config } = require('../../../src/config/index.js');
      expect(config.server.port).toBe(4000);
      expect(config.server.host).toBe('127.0.0.1');
      expect(config.server.apiPrefix).toBe('/api/v1');
    });

    test('loads model config from environment', () => {
      process.env.MODEL_TEMPERATURE = '0.8';
      process.env.MODEL_TOP_P = '0.95';
      process.env.MODEL_MAX_TOKENS = '4096';

      const { config } = require('../../../src/config/index.js');
      expect(config.defaultModelConfig.temperature).toBe(0.8);
      expect(config.defaultModelConfig.topP).toBe(0.95);
      expect(config.defaultModelConfig.maxTokens).toBe(4096);
    });

    test('loads benchmark config from environment', () => {
      process.env.BENCHMARK_RUNS_PER_TASK = '5';
      process.env.BENCHMARK_PARALLEL = 'true';
      process.env.BENCHMARK_MAX_PARALLEL_TASKS = '4';
      process.env.BENCHMARK_TASK_TIMEOUT = '30000';

      const { config } = require('../../../src/config/index.js');
      expect(config.benchmark.runsPerTask).toBe(5);
      expect(config.benchmark.parallel).toBe(true);
      expect(config.benchmark.maxParallelTasks).toBe(4);
      expect(config.benchmark.taskTimeout).toBe(30000);
    });

    test('uses default values when environment variables are missing', () => {
      // Clear relevant environment variables
      delete process.env.PORT;
      delete process.env.MODEL_TEMPERATURE;
      delete process.env.BENCHMARK_RUNS_PER_TASK;

      const { config } = require('../../../src/config/index.js');
      expect(config.server.port).toBe(3000); // Default port
      expect(config.defaultModelConfig.temperature).toBe(0.7); // Default temperature
      expect(config.benchmark.runsPerTask).toBe(3); // Default runs per task
    });

    test('validates environment variable values', () => {
      process.env.MODEL_TEMPERATURE = 'invalid';
      process.env.BENCHMARK_RUNS_PER_TASK = 'not-a-number';

      const { config } = require('../../../src/config/index');
      // Should fall back to defaults for invalid values
      expect(config.defaultModelConfig.temperature).toBe(0.7);
      expect(config.benchmark.runsPerTask).toBe(3);
    });
  });

  describe('helper functions', () => {
    test('parseBool correctly parses boolean values', () => {
      process.env.TEST_BOOL_TRUE = 'true';
      process.env.TEST_BOOL_FALSE = 'false';
      process.env.TEST_BOOL_INVALID = 'invalid';

      const { config } = require('../../../src/config/index');
      expect(config.parseBoolean(process.env.TEST_BOOL_TRUE)).toBe(true);
      expect(config.parseBoolean(process.env.TEST_BOOL_FALSE)).toBe(false);
      expect(config.parseBoolean(process.env.TEST_BOOL_INVALID, true)).toBe(true);
      expect(config.parseBoolean(undefined, false)).toBe(false);
    });

    test('parseNumber handles numeric values correctly', () => {
      process.env.TEST_NUM_VALID = '123';
      process.env.TEST_NUM_INVALID = 'not-a-number';

      const { config } = require('../../../src/config/index');
      expect(config.parseNumber(process.env.TEST_NUM_VALID, 0)).toBe(123);
      expect(config.parseNumber(process.env.TEST_NUM_INVALID, 456)).toBe(456);
      expect(config.parseNumber(undefined, 789)).toBe(789);
    });

    test('parseNumber respects min/max constraints', () => {
      process.env.TEST_NUM = '50';

      const { config } = require('../../../src/config/index');
      expect(config.parseNumber(process.env.TEST_NUM, 0, 0, 100)).toBe(50);
      expect(config.parseNumber(process.env.TEST_NUM, 0, 75, 100)).toBe(75);
      expect(config.parseNumber(process.env.TEST_NUM, 0, 0, 25)).toBe(25);
    });
  });
});

describe('Config Validation', () => {
  // Save original config
  const originalConfig = { ...config };

  beforeEach(() => {
    // Reset config before each test
    Object.assign(config, {
      server: {
        port: 3000
      },
      lmStudioEndpoint: 'http://localhost:1234/v1',
      ollamaEndpoint: 'http://localhost:11434/api',
      tokenThreshold: 1000,
      costThreshold: 0.02,
      qualityThreshold: 0.7,
      defaultLocalModel: 'llama3',
      openRouterApiKey: 'test-key',
      rootDir: '/test/dir'
    });
  });

  afterAll(() => {
    // Restore original config
    Object.assign(config, originalConfig);
  });

  test('validates valid configuration', () => {
    expect(() => validateConfig()).not.toThrow();
  });

  describe('server configuration', () => {
    test('rejects invalid port number (negative)', () => {
      config.server.port = -1;
      expect(() => validateConfig()).toThrow('Invalid port number');
    });

    test('rejects invalid port number (too large)', () => {
      config.server.port = 70000;
      expect(() => validateConfig()).toThrow('Invalid port number');
    });
  });

  describe('endpoint validation', () => {
    test('validates LM Studio endpoint', () => {
      config.lmStudioEndpoint = 'not-a-url';
      expect(() => validateConfig()).toThrow('Invalid endpoint URL');
    });

    test('validates Ollama endpoint', () => {
      config.ollamaEndpoint = 'not-a-url';
      expect(() => validateConfig()).toThrow('Invalid endpoint URL');
    });

    test('accepts valid URLs with different protocols', () => {
      config.lmStudioEndpoint = 'https://api.lmstudio.com';
      config.ollamaEndpoint = 'http://localhost:11434';
      expect(() => validateConfig()).not.toThrow();
    });
  });

  describe('threshold validation', () => {
    test('validates token threshold', () => {
      config.tokenThreshold = 0;
      expect(() => validateConfig()).toThrow('Invalid token threshold');
    });

    test('validates cost threshold', () => {
      config.costThreshold = -0.01;
      expect(() => validateConfig()).toThrow('Invalid cost threshold');
    });

    test('validates quality threshold', () => {
      config.qualityThreshold = 1.5;
      expect(() => validateConfig()).toThrow('Invalid quality threshold');
    });

    test('accepts valid thresholds', () => {
      config.tokenThreshold = 500;
      config.costThreshold = 0.05;
      config.qualityThreshold = 0.8;
      expect(() => validateConfig()).not.toThrow();
    });
  });

  describe('model configuration', () => {
    test('validates default local model', () => {
      config.defaultLocalModel = '';
      expect(() => validateConfig()).toThrow('Invalid default local model');
    });

    test('accepts valid model configuration', () => {
      config.defaultLocalModel = 'mistral-7b';
      expect(() => validateConfig()).not.toThrow();
    });
  });

  describe('API configuration', () => {
    test('validates OpenRouter API key if configured', () => {
      config.openRouterApiKey = '';
      // Should not throw since OpenRouter is optional
      expect(() => validateConfig()).not.toThrow();
    });

    test('accepts valid API configuration', () => {
      config.openRouterApiKey = 'valid-key-123';
      expect(() => validateConfig()).not.toThrow();
    });
  });

  describe('directory validation', () => {
    test('validates root directory', () => {
      config.rootDir = '';
      expect(() => validateConfig()).toThrow('Invalid root directory');
    });

    test('accepts valid directory configuration', () => {
      config.rootDir = '/valid/path';
      expect(() => validateConfig()).not.toThrow();
    });
  });

  describe('multiple errors', () => {
    test('collects multiple validation errors', () => {
      config.server.port = -1;
      config.tokenThreshold = 0;
      config.qualityThreshold = 2;
      
      expect(() => validateConfig()).toThrow();
      try {
        validateConfig();
      } catch (error) {
        const message = error.message;
        expect(message).toContain('Invalid port number');
        expect(message).toContain('Invalid token threshold');
        expect(message).toContain('Invalid quality threshold');
      }
    });
  });
});