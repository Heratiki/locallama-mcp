import { beforeEach, describe, expect, it, jest } from '@jest/globals';

// Mock config and logger before any other imports
const mockConfig = {
  llamaCppEndpoint: 'http://localhost:8080',
  llamaCppHealthProbeEnabled: true,
  llamaCppHealthProbePrompt: `write 'ok'`,
  llamaCppHealthProbeTimeoutMs: 5000,
};

jest.unstable_mockModule('../../../dist/config/index.js', () => ({
  config: mockConfig,
}));

const loggerMock = {
  error: jest.fn(),
  warn: jest.fn(),
  info: jest.fn(),
  debug: jest.fn(),
};

jest.unstable_mockModule('../../../dist/utils/logger.js', () => ({
  logger: loggerMock,
}));

// Import module under test
const { llamaCppModule } = await import('../../../dist/modules/llama-cpp/index.js');

describe('llama.cpp health probe', () => {
  let callApiSpy: jest.SpiedFunction<typeof llamaCppModule.callApi>;

  beforeEach(() => {
    jest.restoreAllMocks();
    callApiSpy = jest.spyOn(llamaCppModule, 'callApi');
    // Reset capabilities before each test
    llamaCppModule.capabilities = {
      mode: 'unknown',
      modelCount: 0,
      supportsMultiModel: false,
      health: 'unknown',
      lastHealthCheck: new Date(0).toISOString(),
      lastHealthCheckResult: 'not yet run',
    };
    llamaCppModule.cachedModels = [];
  });

  it('sets health to healthy on a successful probe with "ok" response', async () => {
    llamaCppModule.cachedModels = [{ id: 'test-model', object: 'model' }];
    callApiSpy.mockResolvedValue({ success: true, text: 'ok' });

    await llamaCppModule._runHealthProbe();

    expect(llamaCppModule.capabilities.health).toBe('healthy');
    expect(llamaCppModule.capabilities.lastHealthCheckResult).toBe('ok');
  });

  it('sets health to degraded on an empty response', async () => {
    llamaCppModule.cachedModels = [{ id: 'test-model', object: 'model' }];
    callApiSpy.mockResolvedValue({ success: true, text: '' });

    await llamaCppModule._runHealthProbe();

    expect(llamaCppModule.capabilities.health).toBe('degraded');
    expect(llamaCppModule.capabilities.lastHealthCheckResult).toContain('degenerate response');
  });

  it('sets health to degraded on a repeated character response', async () => {
    llamaCppModule.cachedModels = [{ id: 'test-model', object: 'model' }];
    callApiSpy.mockResolvedValue({ success: true, text: '........' });

    await llamaCppModule._runHealthProbe();

    expect(llamaCppModule.capabilities.health).toBe('degraded');
    expect(llamaCppModule.capabilities.lastHealthCheckResult).toContain('degenerate response');
  });

  it('sets health to degraded on a "thinking" loop response', async () => {
    llamaCppModule.cachedModels = [{ id: 'test-model', object: 'model' }];
    callApiSpy.mockResolvedValue({ success: true, text: 'Thinking... thinking...' });

    await llamaCppModule._runHealthProbe();

    expect(llamaCppModule.capabilities.health).toBe('degraded');
    expect(llamaCppModule.capabilities.lastHealthCheckResult).toContain('degenerate response');
  });

  it('sets health to unhealthy when the API call fails', async () => {
    llamaCppModule.cachedModels = [{ id: 'test-model', object: 'model' }];
    callApiSpy.mockResolvedValue({ success: false, error: 'server_error' as any });

    await llamaCppModule._runHealthProbe();

    expect(llamaCppModule.capabilities.health).toBe('unhealthy');
    expect(llamaCppModule.capabilities.lastHealthCheckResult).toContain('API call failed');
  });

  it('sets health to unhealthy when no models are cached', async () => {
    llamaCppModule.cachedModels = [];

    await llamaCppModule._runHealthProbe();

    expect(callApiSpy).not.toHaveBeenCalled();
    expect(llamaCppModule.capabilities.health).toBe('unhealthy');
    expect(llamaCppModule.capabilities.lastHealthCheckResult).toBe('no models found');
  });

  it('sets health to healthy and result to "disabled" when probe is disabled', async () => {
    mockConfig.llamaCppHealthProbeEnabled = false;
    llamaCppModule.cachedModels = [{ id: 'test-model', object: 'model' }];

    await llamaCppModule._runHealthProbe();

    expect(callApiSpy).not.toHaveBeenCalled();
    expect(llamaCppModule.capabilities.health).toBe('healthy');
    expect(llamaCppModule.capabilities.lastHealthCheckResult).toBe('disabled');

    // Reset for other tests
    mockConfig.llamaCppHealthProbeEnabled = true;
  });

  it('isAvailable returns false when health is unhealthy', async () => {
    const { llamaCppProvider } = await import('../../../dist/modules/llama-cpp/provider.js');
    llamaCppModule.capabilities.health = 'unhealthy';
    llamaCppModule.capabilities.modelCount = 1;
    expect(await llamaCppProvider.isAvailable()).toBe(false);
  });

  it('isAvailable returns false when health is degraded', async () => {
    const { llamaCppProvider } = await import('../../../dist/modules/llama-cpp/provider.js');
    llamaCppModule.capabilities.health = 'degraded';
    llamaCppModule.capabilities.modelCount = 1;
    expect(await llamaCppProvider.isAvailable()).toBe(false);
  });

  it('isAvailable returns true when health is healthy and models exist', async () => {
    const { llamaCppProvider } = await import('../../../dist/modules/llama-cpp/provider.js');
    llamaCppModule.capabilities.health = 'healthy';
    llamaCppModule.capabilities.modelCount = 1;
    expect(await llamaCppProvider.isAvailable()).toBe(true);
  });

  it('isAvailable returns false when health is healthy but no models exist', async () => {
    const { llamaCppProvider } = await import('../../../dist/modules/llama-cpp/provider.js');
    llamaCppModule.capabilities.health = 'healthy';
    llamaCppModule.capabilities.modelCount = 0;
    expect(await llamaCppProvider.isAvailable()).toBe(false);
  });
});
