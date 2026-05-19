import { beforeEach, describe, expect, it, jest } from '@jest/globals';

jest.unstable_mockModule('../../../dist/config/index.js', () => ({
  config: {
    rootDir: process.cwd(),
    openRouterApiKey: 'test-key',
  },
}));

jest.unstable_mockModule('../../../dist/utils/logger.js', () => ({
  logger: {
    error: jest.fn(),
    warn: jest.fn(),
    info: jest.fn(),
    debug: jest.fn(),
  },
}));

const { openRouterModule } = await import('../../../dist/modules/openrouter/index.js');
const { OpenRouterErrorType } = await import('../../../dist/modules/openrouter/types.js');

describe('openRouterModule quarantine lifecycle', () => {
  beforeEach(() => {
    jest.restoreAllMocks();

    openRouterModule.modelTracking = {
      models: {},
      freeModels: [],
      freeModelHealth: {},
      lastUpdated: new Date().toISOString(),
    };

    jest.spyOn(openRouterModule, 'saveTrackingData').mockResolvedValue(undefined);
  });

  it('quarantined model status is visible in tracking data', () => {
    const nowIso = new Date().toISOString();
    const in30min = new Date(Date.now() + 30 * 60 * 1000).toISOString();

    openRouterModule.modelTracking.freeModels = ['test/model'];
    openRouterModule.modelTracking.freeModelHealth = {
      'test/model': {
        consecutiveFailures: 2,
        lastErrorType: OpenRouterErrorType.INVALID_REQUEST,
        lastFailureAt: nowIso,
        quarantinedUntil: in30min,
      },
    };

    expect(openRouterModule.isModelQuarantined('test/model')).toBe(true);

    const health = openRouterModule.modelTracking.freeModelHealth!['test/model'];
    expect(health.consecutiveFailures).toBe(2);
    expect(health.lastErrorType).toBe(OpenRouterErrorType.INVALID_REQUEST);
    expect(health.quarantinedUntil).toBe(in30min);
  });

  it('model becomes eligible again after the quarantine window expires', async () => {
    const nowIso = new Date().toISOString();
    // Set quarantinedUntil to 1 second in the past so the window has elapsed
    const expired = new Date(Date.now() - 1000).toISOString();

    openRouterModule.modelTracking = {
      lastUpdated: nowIso,
      freeModels: ['test/expired-model'],
      freeModelHealth: {
        'test/expired-model': {
          consecutiveFailures: 2,
          lastErrorType: OpenRouterErrorType.INVALID_REQUEST,
          lastFailureAt: nowIso,
          quarantinedUntil: expired,
        },
      },
      models: {
        'test/expired-model': {
          id: 'test/expired-model',
          name: 'test/expired-model',
          provider: 'openrouter',
          isFree: true,
          contextWindow: 8192,
          capabilities: { chat: true, completion: true, vision: false },
          costPerToken: { prompt: 0, completion: 0 },
          lastUpdated: nowIso,
        },
      },
    };

    // Window expired → model should NOT be quarantined
    expect(openRouterModule.isModelQuarantined('test/expired-model')).toBe(false);

    // Should appear in getFreeModels() since the quarantine has elapsed
    const freeModels = await openRouterModule.getFreeModels(false);
    expect(freeModels.map((m: { id: string }) => m.id)).toContain('test/expired-model');
  });
});
