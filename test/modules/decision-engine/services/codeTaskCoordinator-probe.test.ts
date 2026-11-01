import { afterAll, beforeEach, describe, expect, it, jest } from '@jest/globals';

/**
 * Issue #150 (F2): a subtask assigned a model whose `provider` is the model
 * id (`llama3.2:3b`) reaches `_executeSubtaskInner`. The direct registry
 * lookup misses, and the probe fallback only asks `supportsModel(bareId)`,
 * which every local provider answers from a warm id cache — after a cold
 * start (or when the model was pulled after startup) it returns false for a
 * bare id even though the provider lists the model, so the subtask fails
 * with "No registered provider supports model".
 *
 * These tests pin the probe fallback contract for bare model ids.
 */

jest.unstable_mockModule('../../../../dist/utils/logger.js', () => ({
  logger: {
    debug: jest.fn(),
    error: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
  },
}));

jest.unstable_mockModule('../../../../dist/config/index.js', () => ({
  config: {
    rootDir: '/tmp/opencode/issue-150',
    ollamaTimeout: 5000,
  },
}));

jest.unstable_mockModule('../../../../dist/modules/decision-engine/services/codeTaskAnalyzer.js', () => ({
  codeTaskAnalyzer: { decompose: jest.fn() },
}));

jest.unstable_mockModule('../../../../dist/modules/decision-engine/services/dependencyMapper.js', () => ({
  dependencyMapper: {
    sortByExecutionOrder: jest.fn(),
    findCriticalPath: jest.fn(),
    visualizeDependencies: jest.fn(),
    resolveDependencyCycles: jest.fn(),
  },
}));

jest.unstable_mockModule('../../../../dist/modules/decision-engine/services/codeModelSelector.js', () => ({
  codeModelSelector: { selectModelsForSubtasks: jest.fn() },
}));

jest.unstable_mockModule('../../../../dist/modules/openrouter/index.js', () => ({
  ModelNotFoundError: class ModelNotFoundError extends Error {},
}));

jest.unstable_mockModule('../../../../dist/modules/cost-monitor/index.js', () => ({
  costMonitor: {
    getAvailableModels: jest.fn().mockResolvedValue([]),
    getFreeModels: jest.fn().mockResolvedValue([]),
    estimateCost: jest.fn().mockResolvedValue({ paid: { cost: { total: 0 } } }),
  },
}));

jest.unstable_mockModule('../../../../dist/modules/decision-engine/services/jobTracker.js', () => ({
  getJobTracker: jest.fn(),
}));

// The provider registry is NOT mocked: the coordinator must see the test
// registry installed through the real `_setProviderRegistryForTests` hook.
const { getProviderRegistry: realGetProviderRegistry, _setProviderRegistryForTests } = await import(
  '../../../../dist/modules/core/provider/registry.js'
);

const { codeTaskCoordinator } = await import('../../../../dist/modules/decision-engine/services/codeTaskCoordinator.js');

/** Model object whose provider is the model id — the exact shape from locallama.log (#150). */
const modelWithProviderAsModelId = {
  id: 'llama3.2:3b',
  name: 'llama3.2:3b',
  provider: 'llama3.2:3b',
  capabilities: { chat: true, completion: true },
  costPerToken: { prompt: 0, completion: 0 },
  contextWindow: 8192,
};

const subtask = {
  id: 'subtask-1',
  description: 'Write a TypeScript slugify function',
  complexity: 0.2,
  estimatedTokens: 500,
  dependencies: [] as string[],
  codeType: 'function' as const,
  recommendedModelSize: 'small' as const,
};

const executeTaskContent = '```ts\nexport function slugify(input: string): string {\n  return input;\n}\n```';

function makeOllamaLikeProvider(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'ollama',
    displayName: 'Ollama',
    isLocal: true,
    costClass: 'local' as const,
    supportsModel: jest.fn().mockReturnValue(false),
    listModels: jest.fn().mockResolvedValue([
      { id: 'llama3.2:3b', displayName: 'Llama 3.2 3B' },
      { id: 'tinyllama:latest', displayName: 'TinyLlama' },
    ]),
    executeTask: jest.fn().mockResolvedValue({ content: executeTaskContent, model: 'llama3.2:3b' }),
    ...overrides,
  };
}

function installRegistry(providers: unknown[]) {
  _setProviderRegistryForTests({
    get: (providerId: string) => providers.find((p) => (p as { id: string }).id === providerId),
    list: () => providers,
    has: (providerId: string) => providers.some((p) => (p as { id: string }).id === providerId),
    executeWithConcurrencyLimit: async (_provider: unknown, run: () => Promise<unknown>) => run(),
  } as unknown as ReturnType<typeof realGetProviderRegistry>);
}

describe('codeTaskCoordinator probe fallback for models whose provider is the model id (issue #150)', () => {
  beforeEach(() => {
    _setProviderRegistryForTests(undefined);
  });

  afterAll(() => {
    _setProviderRegistryForTests(undefined);
  });

  it('ignores an earlier prefix-accepting provider and picks the later provider that actually owns the model', async () => {
    // Review of 273c0e3: probing the provider-qualified id
    // (`${p.id}:${bareId}`) matches the FIRST registered provider for ANY
    // model, because providers like ollama accept every id carrying their
    // own prefix (src/modules/ollama/provider.ts:60-63). The probe must not
    // route on that signal: the provider that lists the model must win.
    const prefixAcceptingFirst = makeOllamaLikeProvider({
      // Mirrors the real OllamaProvider with a cold cache: bare ids are
      // rejected, but EVERY `ollama:`-prefixed id is accepted.
      supportsModel: jest.fn().mockImplementation((modelId: string) => modelId.startsWith('ollama:')),
      // This provider does NOT list the target model.
      listModels: jest.fn().mockResolvedValue([
        { id: 'mistral:7b', displayName: 'Mistral 7B' },
      ]),
      // If wrongly chosen, this must not produce a passing result.
      executeTask: jest.fn(),
    });
    const owningLaterProvider = makeOllamaLikeProvider({
      id: 'lm-studio',
      displayName: 'LM Studio',
      // Cold cache: rejects the bare id; lists the model authoritatively.
      supportsModel: jest.fn().mockReturnValue(false),
      listModels: jest.fn().mockResolvedValue([
        { id: 'llama3.2:3b', displayName: 'Llama 3.2 3B' },
      ]),
    });
    installRegistry([prefixAcceptingFirst, owningLaterProvider]);

    const result = await codeTaskCoordinator.executeSubtask(subtask, modelWithProviderAsModelId);

    expect(result).not.toMatch(/^Error:/);
    expect(prefixAcceptingFirst.executeTask).not.toHaveBeenCalled();
    expect(owningLaterProvider.listModels).toHaveBeenCalled();
    expect(owningLaterProvider.executeTask).toHaveBeenCalledWith(
      'llama3.2:3b',
      expect.stringContaining('slugify'),
      expect.objectContaining({ timeoutMs: 5000 }),
    );
  });

  it('finds the provider via its model list when supportsModel only recognizes prefixed ids', async () => {
    // Mirrors the real OllamaProvider with a cold model cache:
    // bare ids are rejected, `ollama:`-prefixed ids are accepted. The bare-id
    // probe must miss and the authoritative listModels() match must find it.
    const provider = makeOllamaLikeProvider({
      supportsModel: jest.fn().mockImplementation((modelId: string) => modelId.startsWith('ollama:')),
    });
    installRegistry([provider]);

    const result = await codeTaskCoordinator.executeSubtask(subtask, modelWithProviderAsModelId);

    expect(result).not.toMatch(/^Error:/);
    expect(provider.listModels).toHaveBeenCalled();
    expect(provider.executeTask).toHaveBeenCalledWith(
      'llama3.2:3b',
      expect.stringContaining('slugify'),
      expect.objectContaining({ timeoutMs: 5000 }),
    );
  });

  it('finds the provider by refreshing its model list when supportsModel rejects the bare id from a cold cache', async () => {
    const provider = makeOllamaLikeProvider({
      supportsModel: jest.fn().mockReturnValue(false), // cold cache: rejects everything
    });
    installRegistry([provider]);

    const result = await codeTaskCoordinator.executeSubtask(subtask, modelWithProviderAsModelId);

    expect(result).not.toMatch(/^Error:/);
    expect(provider.listModels).toHaveBeenCalled();
    expect(provider.executeTask).toHaveBeenCalledWith(
      'llama3.2:3b',
      expect.stringContaining('slugify'),
      expect.objectContaining({ timeoutMs: 5000 }),
    );
  });

  it('still executes directly when supportsModel accepts the bare id (warm cache control case)', async () => {
    const provider = makeOllamaLikeProvider({
      supportsModel: jest.fn().mockReturnValue(true),
    });
    installRegistry([provider]);

    const result = await codeTaskCoordinator.executeSubtask(subtask, modelWithProviderAsModelId);

    expect(result).not.toMatch(/^Error:/);
    expect(provider.executeTask).toHaveBeenCalledWith(
      'llama3.2:3b',
      expect.stringContaining('slugify'),
      expect.objectContaining({ timeoutMs: 5000 }),
    );
  });
});
