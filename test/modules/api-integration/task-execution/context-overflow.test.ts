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
    // A task of 401 characters → ceil(401/4) = 101 tokens > contextWindow 100
    const bigTask = 'x'.repeat(401);

    const modelReg = new ModelRegistry();
    modelReg.registerModel({
      id: 'small-model',
      providerId: 'ollama',
      displayName: 'Small Model',
      contextWindow: 100,
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
    const bigTask = 'x'.repeat(401); // 101 tokens

    const modelReg = new ModelRegistry();
    modelReg.registerModel({
      id: 'small-model',
      providerId: 'ollama',
      displayName: 'Small Model',
      contextWindow: 100,
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
    expect(err.estimatedTokens).toBe(101);
    expect(err.contextWindow).toBe(100);
    expect(err.message).toContain('small-model');
    expect(err.message).toContain('101');
    expect(err.message).toContain('100');
  });

  it('does NOT throw ContextWindowError when task fits within contextWindow', async () => {
    // A task of 40 characters → ceil(40/4) = 10 tokens < contextWindow 100
    const smallTask = 'x'.repeat(40);

    const modelReg = new ModelRegistry();
    modelReg.registerModel({
      id: 'small-model',
      providerId: 'ollama',
      displayName: 'Small Model',
      contextWindow: 100,
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
});
