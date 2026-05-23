import { describe, expect, it, jest, beforeEach } from '@jest/globals';

// ---------------------------------------------------------------------------
// Mocks — must be set up before any dynamic import of dist/ modules
// ---------------------------------------------------------------------------

jest.unstable_mockModule('../../../dist/utils/logger.js', () => ({
  logger: {
    error: jest.fn(),
    warn: jest.fn(),
    info: jest.fn(),
    debug: jest.fn(),
  },
}));

const executeTaskMock = jest.fn();
const executeWithConcurrencyLimitMock = jest.fn(async (_provider, run: () => Promise<unknown>) => await run());
const supportsModelMock = jest.fn();
const initBenchmarkDbMock = jest.fn();
const saveBenchmarkResultMock = jest.fn();
const getDynamicTimeoutMock = jest.fn();

jest.unstable_mockModule('../../../dist/modules/benchmark/storage/benchmarkDb.js', () => ({
  initBenchmarkDb: initBenchmarkDbMock,
  saveBenchmarkResult: saveBenchmarkResultMock,
  getRecentModelResults: jest.fn(),
  cleanupOldResults: jest.fn(),
}));

jest.unstable_mockModule('../../../dist/modules/benchmark/core/runner.js', () => ({
  getDynamicTimeout: getDynamicTimeoutMock,
  benchmarkTask: jest.fn(),
}));

jest.unstable_mockModule('../../../dist/modules/benchmark/evaluation/quality.js', () => ({
  evaluateQuality: jest.fn().mockReturnValue(0.8),
}));

// ---------------------------------------------------------------------------
// Provider registry mock
// ---------------------------------------------------------------------------

const fakeProvider = {
  id: 'test-provider',
  displayName: 'Test Provider',
  costClass: 'local',
  isLocal: true,
  executeTask: executeTaskMock,
  supportsModel: supportsModelMock,
  listModels: jest.fn(),
  isAvailable: jest.fn(),
  getCost: jest.fn().mockReturnValue({ prompt: 0, completion: 0 }),
  init: jest.fn(),
};

const providerRegistryMock = {
  get: jest.fn().mockReturnValue(fakeProvider),
  list: jest.fn().mockReturnValue([fakeProvider]),
  listByCostClass: jest.fn().mockReturnValue([fakeProvider]),
  has: jest.fn().mockReturnValue(true),
  executeWithConcurrencyLimit: executeWithConcurrencyLimitMock,
};

jest.unstable_mockModule('../../../dist/modules/core/provider/index.js', () => ({
  getProviderRegistry: jest.fn().mockReturnValue(providerRegistryMock),
  isProviderLocal: jest.fn().mockReturnValue(true),
  isProviderId: jest.fn().mockReturnValue(false),
}));

// ---------------------------------------------------------------------------
// Model registry mock
// ---------------------------------------------------------------------------

const fakeModelMeta = {
  id: 'qwen2.5-coder-7b',
  providerId: 'test-provider',
  displayName: 'Qwen 2.5 Coder 7B',
  contextWindow: 8192,
  capabilities: { chat: true, code: true, vision: false, toolUse: true, largeContext: false, maxContextTokens: 8192 },
  cost: { prompt: 0, completion: 0 },
  promptingStrategyId: 'default',
};

const updateBenchmarkSummaryMock = jest.fn();

const modelRegistryMock = {
  getModel: jest.fn().mockReturnValue(fakeModelMeta),
  listByProvider: jest.fn().mockReturnValue([fakeModelMeta]),
  updateBenchmarkSummary: updateBenchmarkSummaryMock,
};

jest.unstable_mockModule('../../../dist/modules/core/model/index.js', () => ({
  getModelRegistry: jest.fn().mockReturnValue(modelRegistryMock),
}));

// ---------------------------------------------------------------------------
// Import SUT after mocks
// ---------------------------------------------------------------------------

const { benchmarkModel } = await import('../../../dist/modules/benchmark/core/model-benchmarker.js');

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('benchmarkModel', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Reset mocks to defaults
    providerRegistryMock.get.mockReturnValue(fakeProvider);
    modelRegistryMock.getModel.mockReturnValue(fakeModelMeta);
    initBenchmarkDbMock.mockResolvedValue(null);
    saveBenchmarkResultMock.mockResolvedValue(undefined);
    getDynamicTimeoutMock.mockReturnValue(30_000);
    executeTaskMock.mockResolvedValue({
      content: 'function sort(...) {}',
      model: 'qwen2.5-coder-7b',
      promptTokens: 50,
      completionTokens: 100,
    });
    executeWithConcurrencyLimitMock.mockClear();
    supportsModelMock.mockReturnValue(false);
  });

  it('resolves the provider via ModelRegistry.getModel', async () => {
    const result = await benchmarkModel({ modelId: 'qwen2.5-coder-7b', taskCategories: ['code'] });

    expect(result.providerId).toBe('test-provider');
    expect(result.modelId).toBe('qwen2.5-coder-7b');
  });

  it('calls provider.executeTask for each task in the requested category', async () => {
    await benchmarkModel({ modelId: 'qwen2.5-coder-7b', taskCategories: ['code'] });

    // 'code' category has 2 tasks
    expect(executeTaskMock).toHaveBeenCalledTimes(2);
    expect(executeWithConcurrencyLimitMock).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'test-provider' }),
      expect.any(Function),
      { workload: 'benchmark', priority: 'background' },
    );
    expect(executeTaskMock.mock.calls[0][0]).toBe('qwen2.5-coder-7b');
    expect(typeof executeTaskMock.mock.calls[0][1]).toBe('string');
  });

  it('defaults to code + chat when taskCategories is omitted', async () => {
    await benchmarkModel({ modelId: 'qwen2.5-coder-7b' });

    // code = 2 tasks, chat = 2 tasks → 4 total executeTask calls
    expect(executeTaskMock).toHaveBeenCalledTimes(4);
    expect(result => result).toBeDefined();
  });

  it('calls ModelRegistry.updateBenchmarkSummary after the run', async () => {
    await benchmarkModel({ modelId: 'qwen2.5-coder-7b', taskCategories: ['code'] });

    expect(updateBenchmarkSummaryMock).toHaveBeenCalledTimes(1);
    const [calledModelId, summary] = updateBenchmarkSummaryMock.mock.calls[0] as [string, unknown];
    expect(calledModelId).toBe('qwen2.5-coder-7b');
    expect(typeof summary).toBe('object');
  });

  it('persists each successful run to benchmarkDb', async () => {
    await benchmarkModel({ modelId: 'qwen2.5-coder-7b', taskCategories: ['code'] });

    // 2 tasks in 'code' category → 2 saves
    expect(saveBenchmarkResultMock).toHaveBeenCalledTimes(2);
  });

  it('records successRate=1 in categoryResults when all tasks succeed', async () => {
    const result = await benchmarkModel({ modelId: 'qwen2.5-coder-7b', taskCategories: ['code'] });

    expect(result.categoryResults.code?.successRate).toBe(1);
  });

  it('records successRate < 1 when some tasks fail', async () => {
    // First call succeeds, second fails
    executeTaskMock
      .mockResolvedValueOnce({ content: 'ok', model: 'qwen2.5-coder-7b' })
      .mockRejectedValueOnce(new Error('timeout'));

    const result = await benchmarkModel({ modelId: 'qwen2.5-coder-7b', taskCategories: ['code'] });

    expect(result.categoryResults.code?.successRate).toBeCloseTo(0.5);
    expect(result.failureCount).toBe(1);
    expect(result.categoryResults.code?.failures?.[0]?.errorMessage).toContain('timeout');
  });

  it('handles all tasks failing gracefully without throwing', async () => {
    executeTaskMock.mockRejectedValue(new Error('provider unavailable'));

    const result = await benchmarkModel({ modelId: 'qwen2.5-coder-7b', taskCategories: ['code'] });

    expect(result.categoryResults.code?.successRate).toBe(0);
    expect(result.summary.successRate).toBe(0);
  });

  it('throws when model is not in registry and no provider supports it', async () => {
    modelRegistryMock.getModel.mockReturnValue(undefined);
    supportsModelMock.mockReturnValue(false);

    await expect(
      benchmarkModel({ modelId: 'unknown-model', taskCategories: ['code'] })
    ).rejects.toThrow(/not found in any registered provider/);
  });

  it('throws when the resolved provider is not in the registry', async () => {
    providerRegistryMock.get.mockReturnValue(undefined);

    await expect(
      benchmarkModel({ modelId: 'qwen2.5-coder-7b', taskCategories: ['code'] })
    ).rejects.toThrow(/not in the registry/);
  });

  it('includes taskCategories in the returned summary', async () => {
    const result = await benchmarkModel({
      modelId: 'qwen2.5-coder-7b',
      taskCategories: ['code', 'chat'],
    });

    expect(result.summary.taskCategories).toEqual(['code', 'chat']);
  });

  it('populates summary.scores.code from code category quality', async () => {
    const result = await benchmarkModel({ modelId: 'qwen2.5-coder-7b', taskCategories: ['code'] });

    expect(typeof result.summary.scores.code).toBe('number');
  });

  it('falls back to scanning providers when model is not in ModelRegistry', async () => {
    modelRegistryMock.getModel.mockReturnValue(undefined);
    supportsModelMock.mockReturnValue(true); // provider claims to support it

    const result = await benchmarkModel({
      modelId: 'unlisted-model',
      taskCategories: ['chat'],
    });

    expect(result.providerId).toBe('test-provider');
  });

  it('uses requested providerId instead of registry lookup when specified', async () => {
    // Registry says provider is 'test-provider' but caller requests 'lm_studio'
    const lmStudioProvider = { ...fakeProvider, id: 'lm_studio' };
    providerRegistryMock.get.mockImplementation((id: string) =>
      id === 'lm_studio' ? lmStudioProvider : undefined
    );

    const result = await benchmarkModel({
      modelId: 'gemma3-4b-64k:latest',
      providerId: 'lm_studio',
      taskCategories: ['chat'],
    });

    expect(result.providerId).toBe('lm_studio');
    // modelRegistry.getModel should still be called (for contextWindow), but
    // provider selection must not be overridden by registry providerId
    expect(providerRegistryMock.get).toHaveBeenCalledWith('lm_studio');
  });

  it('throws when requested providerId is not in registry', async () => {
    providerRegistryMock.get.mockReturnValue(undefined);

    await expect(
      benchmarkModel({ modelId: 'gemma3-4b-64k:latest', providerId: 'unknown_provider', taskCategories: ['chat'] })
    ).rejects.toThrow(/not in the registry/);
  });

  it('resolves provider-prefixed model ids when requested id is unprefixed', async () => {
    modelRegistryMock.getModel.mockReturnValue(undefined);

    // Provider only claims support for prefixed id, not bare id.
    supportsModelMock.mockImplementation((id: string) => id === 'test-provider:google/gemma-4-e4b');
    fakeProvider.listModels.mockResolvedValueOnce([
      {
        id: 'test-provider:google/gemma-4-e4b',
        displayName: 'Gemma 4 E4B',
        contextWindow: 4096,
        costPerToken: { prompt: 0, completion: 0 },
      },
    ]);

    await benchmarkModel({
      modelId: 'google/gemma-4-e4b',
      taskCategories: ['chat'],
    });

    expect(executeTaskMock).toHaveBeenCalled();
    expect(executeTaskMock.mock.calls[0]?.[0]).toBe('test-provider:google/gemma-4-e4b');
  });
});
