import { describe, expect, it, jest, beforeEach } from '@jest/globals';

// ── Mocks ─────────────────────────────────────────────────────────────────────

jest.unstable_mockModule('../../../../dist/utils/logger.js', () => ({
  logger: {
    error: jest.fn(),
    warn: jest.fn(),
    info: jest.fn(),
    debug: jest.fn(),
  },
}));

jest.unstable_mockModule('../../../../dist/modules/decision-engine/services/jobTracker.js', () => ({
  getJobTracker: jest.fn().mockResolvedValue({
    updateJobProgress: jest.fn<() => Promise<void>>().mockResolvedValue(undefined),
    failJob: jest.fn<() => Promise<void>>().mockResolvedValue(undefined),
  }),
}));

// ── Module imports (after mocks) ──────────────────────────────────────────────

const { ProviderRegistry, _setProviderRegistryForTests } = await import(
  '../../../../dist/modules/core/provider/index.js'
);
const { ModelRegistry, _setModelRegistryForTests } = await import(
  '../../../../dist/modules/core/model/index.js'
);
const { TaskExecutor, ContextWindowError } = await import(
  '../../../../dist/modules/api-integration/task-execution/index.js'
);
const { countTokens } = await import('../../../../dist/modules/utils/tokenCount.js');

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeMinimalProvider(id: string) {
  return {
    id,
    displayName: id,
    costClass: 'local' as const,
    isLocal: true,
    init: jest.fn<() => Promise<void>>().mockResolvedValue(undefined),
    isAvailable: jest.fn<() => Promise<boolean>>().mockResolvedValue(true),
    listModels: jest.fn<() => Promise<{ id: string }[]>>().mockResolvedValue([]),
    supportsModel: jest.fn<(m: unknown) => boolean>().mockReturnValue(false),
    executeTask: jest.fn<() => Promise<{ content: string; model: string }>>().mockResolvedValue({
      content: 'ok',
      model: id,
    }),
    getCost: jest.fn(() => ({ prompt: 0, completion: 0 })),
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('TaskExecutor — context-window enforcement', () => {
  beforeEach(() => {
    const reg = new ProviderRegistry();
    reg.register(makeMinimalProvider('ollama'));
    _setProviderRegistryForTests(reg);
  });

  it('throws ContextWindowError when task exceeds model contextWindow', async () => {
    const bigTask = 'token '.repeat(120);
    const contextWindow = countTokens(bigTask) - 1;

    const modelReg = new ModelRegistry();
    modelReg.registerModel({
      id: 'small-model',
      providerId: 'ollama',
      displayName: 'Small Model',
      contextWindow,
      capabilities: {
        chat: true,
        code: true,
        vision: false,
        toolUse: false,
        largeContext: false,
        maxContextTokens: 100,
      },
      cost: { prompt: 0, completion: 0 },
      promptingStrategyId: 'default',
    });
    _setModelRegistryForTests(modelReg);

    const executor = new TaskExecutor();
    await expect(
      executor.executeTask('small-model', bigTask, 'job-overflow'),
    ).rejects.toThrow(ContextWindowError);
  });

  it('ContextWindowError has correct fields', async () => {
    const bigTask = 'token '.repeat(120);
    const estimatedTokens = countTokens(bigTask);

    const modelReg = new ModelRegistry();
    modelReg.registerModel({
      id: 'small-model',
      providerId: 'ollama',
      displayName: 'Small Model',
      contextWindow: estimatedTokens - 1,
      capabilities: {
        chat: true,
        code: true,
        vision: false,
        toolUse: false,
        largeContext: false,
        maxContextTokens: 100,
      },
      cost: { prompt: 0, completion: 0 },
      promptingStrategyId: 'default',
    });
    _setModelRegistryForTests(modelReg);

    const executor = new TaskExecutor();
    let caughtError: unknown;
    try {
      await executor.executeTask('small-model', bigTask, 'job-overflow-fields');
    } catch (err) {
      caughtError = err;
    }

    expect(caughtError).toBeInstanceOf(ContextWindowError);
    const err = caughtError as ContextWindowError;
    expect(err.name).toBe('ContextWindowError');
    expect(err.modelId).toBe('small-model');
    expect(err.estimatedTokens).toBe(estimatedTokens);
    expect(err.modelContextWindow).toBe(estimatedTokens - 1);
    expect(err.contextWindow).toBe(estimatedTokens - 1);
    expect(err.message).toContain('small-model');
    expect(err.message).toContain(String(estimatedTokens));
    expect(err.message).toContain(String(estimatedTokens - 1));
  });

  it('does NOT throw ContextWindowError when task fits within contextWindow', async () => {
    const smallTask = 'short task';

    const modelReg = new ModelRegistry();
    modelReg.registerModel({
      id: 'small-model',
      providerId: 'ollama',
      displayName: 'Small Model',
      contextWindow: countTokens(smallTask),
      capabilities: {
        chat: true,
        code: true,
        vision: false,
        toolUse: false,
        largeContext: false,
        maxContextTokens: 100,
      },
      cost: { prompt: 0, completion: 0 },
      promptingStrategyId: 'default',
    });
    _setModelRegistryForTests(modelReg);

    const provider = makeMinimalProvider('ollama');
    provider.executeTask.mockResolvedValueOnce({ content: 'success', model: 'small-model' });
    const reg = new ProviderRegistry();
    reg.register(provider);
    _setProviderRegistryForTests(reg);

    const executor = new TaskExecutor();
    const result = await executor.executeTask('small-model', smallTask, 'job-fits');
    expect(result).toBe('success');
  });

  it('does NOT throw ContextWindowError when model is not in registry', async () => {
    // Unknown model → no metadata → skip check, fall through to "no provider" error
    const bigTask = 'x'.repeat(401);

    const modelReg = new ModelRegistry();
    _setModelRegistryForTests(modelReg);

    const executor = new TaskExecutor();
    await expect(
      executor.executeTask('unknown-model', bigTask, 'job-no-meta'),
    ).rejects.toThrow(/No provider found/);
  });

  it('opens provider circuit after repeated execution failures', async () => {
    const failingProvider = makeMinimalProvider('ollama');
    failingProvider.executeTask.mockRejectedValue(new Error('provider down'));

    const reg = new ProviderRegistry();
    reg.register(failingProvider);
    _setProviderRegistryForTests(reg);

    const modelReg = new ModelRegistry();
    modelReg.registerModel({
      id: 'unstable-model',
      providerId: 'ollama',
      displayName: 'Unstable Model',
      contextWindow: 4000,
      capabilities: {
        chat: true,
        code: true,
        vision: false,
        toolUse: false,
        largeContext: false,
        maxContextTokens: 4000,
      },
      cost: { prompt: 0, completion: 0 },
      promptingStrategyId: 'default',
    });
    _setModelRegistryForTests(modelReg);

    const executor = new TaskExecutor();
    for (let i = 0; i < 3; i++) {
      await expect(
        executor.executeTask('unstable-model', 'small task', `job-fail-${i}`),
      ).rejects.toThrow(/provider down|Failed to execute model/);
    }

    expect(reg.isAvailable('ollama')).toBe(false);
  });

  it('skips circuit-open local provider and falls back to an available provider', async () => {
    const failingLocal = makeMinimalProvider('ollama');
    failingLocal.supportsModel.mockReturnValue(true);
    failingLocal.executeTask.mockRejectedValue(new Error('ollama unavailable'));

    const healthyRemote = {
      ...makeMinimalProvider('openrouter'),
      costClass: 'paid' as const,
      isLocal: false,
      supportsModel: jest.fn<(m: unknown) => boolean>().mockReturnValue(false),
      executeTask: jest
        .fn<() => Promise<{ content: string; model: string }>>()
        .mockResolvedValue({ content: 'fallback-success', model: 'openrouter' }),
    };

    const reg = new ProviderRegistry();
    reg.register(failingLocal);
    reg.register(healthyRemote);
    _setProviderRegistryForTests(reg);

    const modelReg = new ModelRegistry();
    modelReg.registerModel({
      id: 'hybrid-model',
      providerId: 'ollama',
      displayName: 'Hybrid Model',
      contextWindow: 4000,
      capabilities: {
        chat: true,
        code: true,
        vision: false,
        toolUse: false,
        largeContext: false,
        maxContextTokens: 4000,
      },
      cost: { prompt: 0, completion: 0 },
      promptingStrategyId: 'default',
    });
    _setModelRegistryForTests(modelReg);

    const executor = new TaskExecutor();

    // Open the local provider circuit first.
    for (let i = 0; i < 3; i++) {
      await expect(
        executor.executeTask('hybrid-model', 'small task', `job-open-${i}`),
      ).rejects.toThrow(/ollama unavailable|Failed to execute model/);
    }
    expect(reg.isAvailable('ollama')).toBe(false);

    healthyRemote.supportsModel.mockReturnValue(true);

    const result = await executor.executeTask('hybrid-model', 'small task', 'job-fallback-success');
    expect(result).toBe('fallback-success');
    expect(healthyRemote.executeTask).toHaveBeenCalled();
  });
});
