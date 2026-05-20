import { beforeEach, describe, expect, it, jest } from '@jest/globals';

jest.unstable_mockModule('../../../../dist/utils/logger.js', () => ({
  logger: {
    error: jest.fn(),
    warn: jest.fn(),
    info: jest.fn(),
    debug: jest.fn(),
  },
}));

const providerModule = await import('../../../../dist/modules/core/provider/index.js');
const {
  ProviderRegistry,
  _setProviderRegistryForTests,
  localProviderLifecycle,
  _resetLocalProviderLifecycleForTests,
} = providerModule;

function makeLocalProvider(id: string) {
  return {
    id,
    displayName: id,
    costClass: 'local' as const,
    isLocal: true,
    init: jest.fn(() => Promise.resolve()),
    isAvailable: jest.fn(() => Promise.resolve(true)),
    listModels: jest.fn(() => Promise.resolve([])),
    supportsModel: jest.fn(() => true),
    executeTask: jest.fn(() => Promise.resolve({ content: 'ok', model: id })),
    releaseResources: jest.fn(() => Promise.resolve()),
    getCost: jest.fn(() => ({ prompt: 0, completion: 0 })),
  };
}

describe('localProviderLifecycle', () => {
  beforeEach(() => {
    _resetLocalProviderLifecycleForTests();
    _setProviderRegistryForTests(new ProviderRegistry());
  });

  it('unloads the previous local provider before cross-provider handoff', async () => {
    const registry = new ProviderRegistry();
    const ollama = makeLocalProvider('ollama');
    const lmStudio = makeLocalProvider('lm-studio');
    registry.register(ollama);
    registry.register(lmStudio);
    _setProviderRegistryForTests(registry);

    await localProviderLifecycle.beforeExecution(ollama, 'qwen2.5-coder:7b');
    await localProviderLifecycle.beforeExecution(lmStudio, 'google/gemma-4-e4b');

    expect(ollama.releaseResources).toHaveBeenCalledWith({
      reason: 'cross-provider-handoff',
      modelId: 'qwen2.5-coder:7b',
    });
    expect(lmStudio.releaseResources).not.toHaveBeenCalled();
  });

  it('unloads the previous model when switching models within the same local provider', async () => {
    const registry = new ProviderRegistry();
    const ollama = makeLocalProvider('ollama');
    registry.register(ollama);
    _setProviderRegistryForTests(registry);

    await localProviderLifecycle.beforeExecution(ollama, 'qwen2.5-coder:7b');
    await localProviderLifecycle.beforeExecution(ollama, 'qwen2.5-coder:14b');

    expect(ollama.releaseResources).toHaveBeenCalledTimes(1);
    expect(ollama.releaseResources).toHaveBeenCalledWith({
      reason: 'same-provider-model-switch',
      modelId: 'qwen2.5-coder:7b',
    });
  });

  it('does not unload on the very first execution (no previous model)', async () => {
    const registry = new ProviderRegistry();
    const ollama = makeLocalProvider('ollama');
    registry.register(ollama);
    _setProviderRegistryForTests(registry);

    await localProviderLifecycle.beforeExecution(ollama, 'qwen2.5-coder:7b');

    expect(ollama.releaseResources).not.toHaveBeenCalled();
  });

  it('unloads the previous model on each same-provider switch across multiple switches', async () => {
    const registry = new ProviderRegistry();
    const ollama = makeLocalProvider('ollama');
    registry.register(ollama);
    _setProviderRegistryForTests(registry);

    await localProviderLifecycle.beforeExecution(ollama, 'model-a');
    await localProviderLifecycle.beforeExecution(ollama, 'model-b');
    await localProviderLifecycle.beforeExecution(ollama, 'model-c');

    expect(ollama.releaseResources).toHaveBeenCalledTimes(2);
    expect(ollama.releaseResources).toHaveBeenNthCalledWith(1, {
      reason: 'same-provider-model-switch',
      modelId: 'model-a',
    });
    expect(ollama.releaseResources).toHaveBeenNthCalledWith(2, {
      reason: 'same-provider-model-switch',
      modelId: 'model-b',
    });
  });
});
