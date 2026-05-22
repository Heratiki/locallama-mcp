/**
 * Unit tests for the llama.cpp LLMProvider adapter (provider.ts).
 *
 * Covers: registration in ProviderRegistry, init, isAvailable, listModels,
 * supportsModel, executeTask (prefix stripping), releaseResources mode-awareness.
 */
import { beforeEach, describe, expect, it, jest } from '@jest/globals';

// --- mocks ---------------------------------------------------------------

const loggerMock = { error: jest.fn(), warn: jest.fn(), info: jest.fn(), debug: jest.fn() };

jest.unstable_mockModule('../../../dist/utils/logger.js', () => ({
  logger: loggerMock,
}));

jest.unstable_mockModule('../../../dist/config/index.js', () => ({
  config: {
    rootDir: process.cwd(),
    llamaCppEndpoint: 'http://localhost:8080',
    providerTimeoutMs: 120000,
    defaultModelConfig: {
      temperature: 0.7,
      maxTokens: 2048,
      topP: 0.95,
      frequencyPenalty: 0,
      presencePenalty: 0,
    },
  },
}));

// Stub localProviderLifecycle so beforeExecution is a no-op in unit tests.
jest.unstable_mockModule('../../../dist/modules/core/provider/local-runtime-lifecycle.js', () => ({
  localProviderLifecycle: {
    beforeExecution: jest.fn(() => Promise.resolve()),
  },
  _resetLocalProviderLifecycleForTests: jest.fn(),
}));

// Stub buildCodeTaskExecutionOptions to return empty object.
jest.unstable_mockModule('../../../dist/modules/core/prompting/execution-profile.js', () => ({
  buildCodeTaskExecutionOptions: jest.fn(() => ({})),
}));

// --- imports (after mocks) -----------------------------------------------

const { llamaCppModule } = await import('../../../dist/modules/llama-cpp/index.js');
const { llamaCppProvider } = await import('../../../dist/modules/llama-cpp/provider.js');

// -------------------------------------------------------------------------

const FAKE_MODELS = [
  { id: 'llama-cpp:llama-3-8b', name: 'llama-3-8b', provider: 'llama-cpp', capabilities: { chat: true, completion: true }, costPerToken: { prompt: 0, completion: 0 }, contextWindow: 4096 },
];

describe('llamaCppProvider — basic properties', () => {
  it('has correct id and costClass', () => {
    expect(llamaCppProvider.id).toBe('llama-cpp');
    expect(llamaCppProvider.costClass).toBe('local');
    expect(llamaCppProvider.isLocal).toBe(true);
  });

  it('getCost returns zero', () => {
    expect(llamaCppProvider.getCost('any')).toEqual({ prompt: 0, completion: 0 });
  });

  it('getVersion returns null (no stable version endpoint)', async () => {
    expect(await llamaCppProvider.getVersion?.()).toBeNull();
  });
});

describe('llamaCppProvider — init and isAvailable', () => {
  beforeEach(() => {
    jest.restoreAllMocks();
    llamaCppModule.cachedModels = [];
    llamaCppModule.mode = 'unknown';
    llamaCppModule.capabilities = {
      mode: 'unknown',
      modelCount: 0,
      supportsMultiModel: false,
      health: 'unknown',
      lastHealthCheck: new Date(0).toISOString(),
      lastHealthCheckResult: 'not yet run',
    };
  });

  it('init resolves without throwing when server unavailable', async () => {
    jest.spyOn(llamaCppModule, 'initialize').mockResolvedValueOnce(undefined);
    await expect(llamaCppProvider.init()).resolves.toBeUndefined();
  });

  it('isAvailable returns false when health is unknown', async () => {
    llamaCppModule.capabilities.modelCount = 1; // Assume models are present
    expect(await llamaCppProvider.isAvailable()).toBe(false);
  });

  it('isAvailable returns true when health is healthy and models are present', async () => {
    llamaCppModule.capabilities.health = 'healthy';
    llamaCppModule.capabilities.modelCount = 1;
    expect(await llamaCppProvider.isAvailable()).toBe(true);
  });

  it('isAvailable returns false when health is healthy but no models are present', async () => {
    llamaCppModule.capabilities.health = 'healthy';
    llamaCppModule.capabilities.modelCount = 0;
    expect(await llamaCppProvider.isAvailable()).toBe(false);
  });

  it('isAvailable returns false after a failed init', async () => {
    jest.spyOn(llamaCppModule, 'initialize').mockRejectedValueOnce(new Error('init failed'));
    await llamaCppProvider.init(); // This will fail internally and set health to unhealthy
    expect(await llamaCppProvider.isAvailable()).toBe(false);
  });
});

describe('llamaCppProvider — listModels', () => {
  it('maps model fields correctly', async () => {
    jest.spyOn(llamaCppModule, 'getAvailableModels').mockResolvedValueOnce(FAKE_MODELS);
    const models = await llamaCppProvider.listModels();
    expect(models).toHaveLength(1);
    expect(models[0].id).toBe('llama-cpp:llama-3-8b');
    expect(models[0].contextWindow).toBe(4096);
  });
});

describe('llamaCppProvider — supportsModel', () => {
  beforeEach(async () => {
    // Prime the cache via init
    jest.spyOn(llamaCppModule, 'initialize').mockResolvedValueOnce(undefined);
    jest.spyOn(llamaCppModule, 'getAvailableModels').mockResolvedValue(FAKE_MODELS);
    await llamaCppProvider.init();
  });

  it('recognises cached model id', () => {
    expect(llamaCppProvider.supportsModel('llama-cpp:llama-3-8b')).toBe(true);
  });

  it('strips llama-cpp: prefix for cache lookup', () => {
    expect(llamaCppProvider.supportsModel('llama-cpp:llama-3-8b')).toBe(true);
  });

  it('returns false for unknown model', () => {
    expect(llamaCppProvider.supportsModel('unknown-model')).toBe(false);
  });
});

describe('llamaCppProvider — executeTask', () => {
  it('strips llama-cpp: prefix before calling module', async () => {
    const execSpy = jest.spyOn(llamaCppModule, 'executeTask').mockResolvedValueOnce('result text');
    await llamaCppProvider.executeTask('llama-cpp:llama-3-8b', 'Write a fn');
    expect(execSpy).toHaveBeenCalledWith('llama-3-8b', 'Write a fn', expect.any(Object));
  });

  it('passes through model id when no prefix', async () => {
    const execSpy = jest.spyOn(llamaCppModule, 'executeTask').mockResolvedValueOnce('result');
    await llamaCppProvider.executeTask('bare-model', 'task');
    expect(execSpy).toHaveBeenCalledWith('bare-model', 'task', expect.any(Object));
  });

  it('returns content and model in result', async () => {
    jest.spyOn(llamaCppModule, 'executeTask').mockResolvedValueOnce('my content');
    const result = await llamaCppProvider.executeTask('llama-3-8b', 'task');
    expect(result.content).toBe('my content');
    expect(result.model).toBe('llama-3-8b');
  });
});

describe('llamaCppProvider — releaseResources', () => {
  it('resolves without throwing (no-op)', async () => {
    const relSpy = jest.spyOn(llamaCppModule, 'releaseResources').mockResolvedValueOnce(undefined);
    await expect(
      llamaCppProvider.releaseResources?.({ reason: 'cross-provider-handoff', modelId: 'llama-3-8b' }),
    ).resolves.toBeUndefined();
    expect(relSpy).toHaveBeenCalled();
  });

  it('logs mode and reason in debug', async () => {
    jest.spyOn(llamaCppModule, 'releaseResources').mockResolvedValueOnce(undefined);
    loggerMock.debug.mockClear();
    llamaCppModule.capabilities.mode = 'single-model';
    await llamaCppProvider.releaseResources?.({ reason: 'shutdown', modelId: 'llama-3-8b' });
    expect(loggerMock.debug).toHaveBeenCalledWith(
      expect.stringContaining('single-model'),
    );
  });
});

describe('llamaCppProvider — ProviderRegistry integration', () => {
  it('can register and retrieve by id', async () => {
    const { ProviderRegistry } = await import('../../../dist/modules/core/provider/index.js');
    const registry = new ProviderRegistry();
    registry.register(llamaCppProvider);
    expect(registry.has('llama-cpp')).toBe(true);
    expect(registry.get('llama-cpp')).toBe(llamaCppProvider);
  });

  it('reports costClass local', async () => {
    const { ProviderRegistry } = await import('../../../dist/modules/core/provider/index.js');
    const registry = new ProviderRegistry();
    registry.register(llamaCppProvider);
    const locals = registry.listByCostClass('local');
    expect(locals.map((p) => p.id)).toContain('llama-cpp');
  });
});
