import { describe, expect, it, jest, beforeEach } from '@jest/globals';

// ── Mocks ─────────────────────────────────────────────────────────────────────

jest.unstable_mockModule('../../../dist/utils/logger.js', () => ({
  logger: {
    error: jest.fn(),
    warn: jest.fn(),
    info: jest.fn(),
    debug: jest.fn(),
  },
}));

const mockUpdateJobProgress = jest.fn<() => Promise<void>>().mockResolvedValue(undefined);
const mockFailJob = jest.fn<() => Promise<void>>().mockResolvedValue(undefined);

jest.unstable_mockModule('../../../dist/modules/decision-engine/services/jobTracker.js', () => ({
  getJobTracker: jest.fn().mockResolvedValue({
    updateJobProgress: mockUpdateJobProgress,
    failJob: mockFailJob,
  }),
}));

// ── Helpers ───────────────────────────────────────────────────────────────────

type FakeProvider = {
  id: string;
  displayName: string;
  costClass: 'local' | 'free' | 'paid';
  isLocal: boolean;
  init: ReturnType<typeof jest.fn>;
  isAvailable: ReturnType<typeof jest.fn>;
  listModels: ReturnType<typeof jest.fn>;
  supportsModel: ReturnType<typeof jest.fn>;
  executeTask: ReturnType<typeof jest.fn>;
  getCost: ReturnType<typeof jest.fn>;
};

function makeProvider(
  id: string,
  costClass: 'local' | 'free' | 'paid',
  modelIds: string[],
): FakeProvider {
  return {
    id,
    displayName: id,
    costClass,
    isLocal: costClass === 'local',
    init: jest.fn<() => Promise<void>>().mockResolvedValue(undefined),
    isAvailable: jest.fn<() => Promise<boolean>>().mockResolvedValue(true),
    listModels: jest.fn<() => Promise<{ id: string }[]>>().mockResolvedValue(
      modelIds.map((m) => ({ id: m })),
    ),
    supportsModel: jest.fn((m: unknown) => modelIds.includes(m as string)),
    executeTask: jest.fn<() => Promise<{ content: string; model: string }>>().mockResolvedValue({
      content: `result-from-${id}`,
      model: id,
    }),
    getCost: jest.fn(() => ({ prompt: 0, completion: 0 })),
  };
}

// ── Module imports (after mocks are set up) ───────────────────────────────────

const { ProviderRegistry, _setProviderRegistryForTests } = await import(
  '../../../dist/modules/core/provider/index.js'
);
const { ModelRegistry, _setModelRegistryForTests } = await import(
  '../../../dist/modules/core/model/index.js'
);
const { TaskExecutor } = await import(
  '../../../dist/modules/api-integration/task-execution/index.js'
);

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('TaskExecutor (provider-agnostic dispatch)', () => {
  let lmStudio: FakeProvider;
  let ollama: FakeProvider;
  let openRouter: FakeProvider;

  beforeEach(() => {
    lmStudio = makeProvider('lm-studio', 'local', ['llama-3.2-3b']);
    ollama = makeProvider('ollama', 'local', ['qwen2.5-coder-7b']);
    openRouter = makeProvider('openrouter', 'paid', ['anthropic/claude-3.5-haiku']);

    // Fresh registry per test
    const reg = new ProviderRegistry();
    reg.register(lmStudio);
    reg.register(ollama);
    reg.register(openRouter);
    _setProviderRegistryForTests(reg);

    const modelReg = new ModelRegistry();
    _setModelRegistryForTests(modelReg);

    mockUpdateJobProgress.mockClear();
    mockFailJob.mockClear();
  });

  it('dispatches prefixed lm-studio:<id> to the lm-studio provider', async () => {
    const executor = new TaskExecutor();
    const result = await executor.executeTask('lm-studio:llama-3.2-3b', 'hello', 'job-1');

    expect(lmStudio.executeTask).toHaveBeenCalledWith('llama-3.2-3b', 'hello', expect.any(Object));
    expect(result).toBe('result-from-lm-studio');
    expect(ollama.executeTask).not.toHaveBeenCalled();
    expect(openRouter.executeTask).not.toHaveBeenCalled();
  });

  it('dispatches prefixed ollama:<id> to the ollama provider', async () => {
    const executor = new TaskExecutor();
    const result = await executor.executeTask('ollama:qwen2.5-coder-7b', 'hello', 'job-2');

    expect(ollama.executeTask).toHaveBeenCalledWith('qwen2.5-coder-7b', 'hello', expect.any(Object));
    expect(result).toBe('result-from-ollama');
    expect(lmStudio.executeTask).not.toHaveBeenCalled();
  });

  it('dispatches prefixed openrouter:<id> to the openrouter provider', async () => {
    const executor = new TaskExecutor();
    const result = await executor.executeTask(
      'openrouter:anthropic/claude-3.5-haiku',
      'hello',
      'job-3',
    );

    expect(openRouter.executeTask).toHaveBeenCalledWith(
      'anthropic/claude-3.5-haiku',
      'hello',
      expect.any(Object),
    );
    expect(result).toBe('result-from-openrouter');
  });

  it('dispatches bare id via ModelRegistry providerId', async () => {
    // Seed registry with the model pointing to ollama
    const modelReg = new ModelRegistry();
    modelReg.registerModel({
      id: 'qwen2.5-coder-7b',
      providerId: 'ollama',
      displayName: 'Qwen 2.5 Coder 7B',
      contextWindow: 32768,
      capabilities: { chat: true, code: true, vision: false, toolUse: false, largeContext: true, maxContextTokens: 32768 },
      cost: { prompt: 0, completion: 0 },
      promptingStrategyId: 'default',
    });
    _setModelRegistryForTests(modelReg);

    const executor = new TaskExecutor();
    const result = await executor.executeTask('qwen2.5-coder-7b', 'hello', 'job-4');

    expect(ollama.executeTask).toHaveBeenCalledWith('qwen2.5-coder-7b', 'hello', expect.any(Object));
    expect(result).toBe('result-from-ollama');
  });

  it('falls back to probing local providers for bare ids not in registry', async () => {
    // llama-3.2-3b is in lmStudio.modelIds but not in ModelRegistry
    const executor = new TaskExecutor();
    const result = await executor.executeTask('llama-3.2-3b', 'hello', 'job-5');

    expect(lmStudio.supportsModel).toHaveBeenCalledWith('llama-3.2-3b');
    expect(lmStudio.executeTask).toHaveBeenCalledWith('llama-3.2-3b', 'hello', expect.any(Object));
    expect(result).toBe('result-from-lm-studio');
  });

  it('fires job progress at 25% and 75%', async () => {
    const executor = new TaskExecutor();
    await executor.executeTask('lm-studio:llama-3.2-3b', 'hi', 'job-progress');

    const calls = mockUpdateJobProgress.mock.calls;
    const progresses = calls.map((c) => c[1] as number);
    expect(progresses).toContain(25);
    expect(progresses).toContain(75);
  });

  it('calls failJob and rethrows when provider throws', async () => {
    lmStudio.executeTask.mockRejectedValueOnce(new Error('network error'));

    const executor = new TaskExecutor();
    await expect(
      executor.executeTask('lm-studio:llama-3.2-3b', 'hi', 'job-fail'),
    ).rejects.toThrow('network error');

    expect(mockFailJob).toHaveBeenCalledWith('job-fail', 'network error');
  });

  it('throws when no provider can handle the model', async () => {
    const executor = new TaskExecutor();
    await expect(
      executor.executeTask('unknown-model-xyz', 'hi', 'job-unknown'),
    ).rejects.toThrow(/No provider found/);
  });
});
