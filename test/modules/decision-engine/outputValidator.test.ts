import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import type { ModelMetadata } from '../../../dist/modules/core/model/types.js';

jest.unstable_mockModule('../../../dist/utils/logger.js', () => ({
  logger: { error: jest.fn(), warn: jest.fn(), info: jest.fn(), debug: jest.fn() },
}));

const mockExecuteTask = jest.fn();
const mockGetProvider = jest.fn();
jest.unstable_mockModule('../../../dist/modules/core/provider/index.js', () => ({
  getProviderRegistry: () => ({
    get: mockGetProvider,
  }),
}));

const mockGetModel = jest.fn();
const mockUpdateBenchmarkSummary = jest.fn();
jest.unstable_mockModule('../../../dist/modules/core/model/index.js', () => ({
  getModelRegistry: () => ({
    getModel: mockGetModel,
    updateBenchmarkSummary: mockUpdateBenchmarkSummary,
  }),
}));

const mockGetDatabase = jest.fn();
const mockUpdateModelData = jest.fn();
jest.unstable_mockModule('../../../dist/modules/decision-engine/services/modelsDb.js', () => ({
  modelsDbService: {
    getDatabase: mockGetDatabase,
    updateModelData: mockUpdateModelData,
  },
}));

const { OutputValidator } = await import('../../../dist/modules/decision-engine/services/outputValidator.js');

describe('OutputValidator.validate test suite', () => {
  const mockModel: ModelMetadata = {
    id: 'test-model',
    providerId: 'test-provider',
    displayName: 'Test Model',
    contextWindow: 4096,
    capabilities: { chat: true, code: true, vision: false, toolUse: false, largeContext: false, maxContextTokens: 4096 },
    cost: { prompt: 0, completion: 0 },
    promptingStrategyId: 'default',
  };

  beforeEach(() => {
    jest.clearAllMocks();
    mockGetDatabase.mockReturnValue({ models: {} });
  });

  it('verifies happy path with YES first line', async () => {
    mockGetProvider.mockReturnValue({
      id: 'test-provider',
      executeTask: mockExecuteTask.mockResolvedValue({
        content: 'YES\nThe code is perfectly correct and meets all requirements.',
      }),
    });

    const result = await OutputValidator.validate('write add function', 'function add(a,b) { return a+b; }', mockModel);

    expect(result.passed).toBe(true);
    expect(result.parsed_cleanly).toBe(true);
    expect(result.confidence).toBeGreaterThanOrEqual(0.8);
    expect(result.reason).toBe('The code is perfectly correct and meets all requirements.');
  });

  it('verifies path with NO first line', async () => {
    mockGetProvider.mockReturnValue({
      id: 'test-provider',
      executeTask: mockExecuteTask.mockResolvedValue({
        content: 'NO\nThe code has syntax errors and is missing return type.',
      }),
    });

    const result = await OutputValidator.validate('write add function', 'function add(a,b) { return a-b; }', mockModel);

    expect(result.passed).toBe(false);
    expect(result.parsed_cleanly).toBe(true);
    expect(result.confidence).toBeGreaterThanOrEqual(0.8);
    expect(result.reason).toBe('The code has syntax errors and is missing return type.');
  });

  it('performs keyword fallback for YES in prose', async () => {
    mockGetProvider.mockReturnValue({
      id: 'test-provider',
      executeTask: mockExecuteTask.mockResolvedValue({
        content: 'This solution is correct because the add function is implemented correctly.',
      }),
    });

    const result = await OutputValidator.validate('write add function', 'function add(a,b) { return a+b; }', mockModel);

    expect(result.passed).toBe(true);
    expect(result.parsed_cleanly).toBe(false);
    expect(result.reason).toContain('correct');
  });

  it('performs keyword fallback for NO in prose', async () => {
    mockGetProvider.mockReturnValue({
      id: 'test-provider',
      executeTask: mockExecuteTask.mockResolvedValue({
        content: 'This solution is incorrect and fails the main unit test case.',
      }),
    });

    const result = await OutputValidator.validate('write add function', 'function add(a,b) { return a-b; }', mockModel);

    expect(result.passed).toBe(false);
    expect(result.parsed_cleanly).toBe(false);
    expect(result.reason).toContain('incorrect');
  });

  it('performs graceful skip on completely unparseable prose', async () => {
    mockGetProvider.mockReturnValue({
      id: 'test-provider',
      executeTask: mockExecuteTask.mockResolvedValue({
        content: 'I am a model and this is some completely neutral text that does not have keywords.',
      }),
    });

    const result = await OutputValidator.validate('write add function', 'function add(a,b) { return a+b; }', mockModel);

    expect(result.passed).toBe(true);
    expect(result.parsed_cleanly).toBe(false);
    expect(result.confidence).toBe(0);
    expect(result.reason).toContain('Unparseable response');
  });

  it('degrades gracefully and returns true when provider throws error', async () => {
    mockGetProvider.mockReturnValue({
      id: 'test-provider',
      executeTask: mockExecuteTask.mockRejectedValue(new Error('Connection failure')),
    });

    const result = await OutputValidator.validate('write add function', 'function add(a,b) { return a+b; }', mockModel);

    expect(result.passed).toBe(true);
    expect(result.parsed_cleanly).toBe(false);
    expect(result.confidence).toBe(0);
    expect(result.reason).toContain('Provider error: Connection failure');
  });

  it('updates validator model reputation in registry and db via EMA', async () => {
    // 1. Initial setup: model has validate score of 0.8 in registry and db
    mockGetModel.mockReturnValue({
      id: 'test-model',
      benchmarkSummary: {
        scores: { validate: 0.8 },
        benchmarkCount: 2,
      },
    });

    mockGetDatabase.mockReturnValue({
      models: {
        'test-model': {
          id: 'test-model',
          scores: { validate: 0.8 },
          benchmarkCount: 2,
        },
      },
    });

    mockGetProvider.mockReturnValue({
      id: 'test-provider',
      executeTask: mockExecuteTask.mockResolvedValue({
        content: 'YES\nThe code is correct.',
      }),
    });

    // 2. Execute validation (parsed_cleanly = true, signal = 1.0)
    await OutputValidator.validate('task', 'output', mockModel);

    // newScore = 0.8 * 0.95 + 1.0 * 0.05 = 0.76 + 0.05 = 0.81
    expect(mockUpdateBenchmarkSummary).toHaveBeenCalledWith(
      'test-model',
      expect.objectContaining({
        scores: expect.objectContaining({ validate: 0.81 }),
        benchmarkCount: 3,
      }),
    );

    expect(mockUpdateModelData).toHaveBeenCalledWith(
      'test-model',
      expect.objectContaining({
        scores: expect.objectContaining({ validate: 0.81 }),
        benchmarkCount: 3,
      }),
    );
  });
});
