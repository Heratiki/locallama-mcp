import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import axios from 'axios';

jest.unstable_mockModule('../../../dist/config/index.js', () => ({
  config: {
    rootDir: process.cwd(),
    openRouterApiKey: 'test-key',
  },
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

const { openRouterModule } = await import('../../../dist/modules/openrouter/index.js');
const { OpenRouterErrorType } = await import('../../../dist/modules/openrouter/types.js');

describe('openRouterModule free-model health gating', () => {
  beforeEach(() => {
    jest.restoreAllMocks();
    loggerMock.error.mockClear();
    loggerMock.warn.mockClear();
    loggerMock.info.mockClear();
    loggerMock.debug.mockClear();

    openRouterModule.modelTracking = {
      models: {},
      freeModels: [],
      freeModelHealth: {},
      lastUpdated: new Date().toISOString(),
    };

    jest.spyOn(openRouterModule, 'saveTrackingData').mockResolvedValue(undefined);
  });

  it('filters quarantined free models from getFreeModels()', async () => {
    const nowIso = new Date().toISOString();
    const in30Minutes = new Date(Date.now() + 30 * 60 * 1000).toISOString();

    openRouterModule.modelTracking = {
      lastUpdated: nowIso,
      freeModels: ['bad/free-model', 'good/free-model'],
      freeModelHealth: {
        'bad/free-model': {
          consecutiveFailures: 2,
          lastErrorType: OpenRouterErrorType.INVALID_REQUEST,
          lastFailureAt: nowIso,
          quarantinedUntil: in30Minutes,
        },
      },
      models: {
        'bad/free-model': {
          id: 'bad/free-model',
          name: 'bad/free-model',
          provider: 'openrouter',
          isFree: true,
          contextWindow: 8192,
          capabilities: { chat: true, completion: true, vision: false },
          costPerToken: { prompt: 0, completion: 0 },
          lastUpdated: nowIso,
        },
        'good/free-model': {
          id: 'good/free-model',
          name: 'good/free-model',
          provider: 'openrouter',
          isFree: true,
          contextWindow: 8192,
          capabilities: { chat: true, completion: true, vision: false },
          costPerToken: { prompt: 0, completion: 0 },
          lastUpdated: nowIso,
        },
      },
    };

    const freeModels = await openRouterModule.getFreeModels(false);
    expect(freeModels.map((model: { id: string }) => model.id)).toEqual(['good/free-model']);
  });

  it('quarantines a free model after repeated invalid_request failures', async () => {
    const nowIso = new Date().toISOString();

    openRouterModule.modelTracking = {
      lastUpdated: nowIso,
      freeModels: ['flaky/free-model'],
      freeModelHealth: {},
      models: {
        'flaky/free-model': {
          id: 'flaky/free-model',
          name: 'flaky/free-model',
          provider: 'openrouter',
          isFree: true,
          contextWindow: 8192,
          capabilities: { chat: true, completion: true, vision: false },
          costPerToken: { prompt: 0, completion: 0 },
          lastUpdated: nowIso,
        },
      },
    };

    const callApiSpy = jest
      .spyOn(openRouterModule, 'callOpenRouterApi')
      .mockResolvedValue({ success: false, error: OpenRouterErrorType.INVALID_REQUEST });

    await expect(openRouterModule.executeTask('flaky/free-model', 'Write a JS add function')).rejects.toThrow(
      'Error executing task: invalid_request',
    );

    await expect(openRouterModule.executeTask('flaky/free-model', 'Write a JS add function')).rejects.toThrow(
      'Error executing task: invalid_request',
    );

    expect(openRouterModule.isModelQuarantined('flaky/free-model')).toBe(true);
    expect(openRouterModule.modelTracking.freeModelHealth?.['flaky/free-model']?.consecutiveFailures).toBe(2);

    await expect(openRouterModule.executeTask('flaky/free-model', 'Write a JS add function')).rejects.toThrow(
      'temporarily quarantined',
    );

    expect(callApiSpy).toHaveBeenCalledTimes(2);
  });

  it('redacts authorization details when logging OpenRouter Axios errors', async () => {
    const nowIso = new Date().toISOString();

    openRouterModule.modelTracking = {
      lastUpdated: nowIso,
      freeModels: ['flaky/free-model'],
      freeModelHealth: {},
      models: {
        'flaky/free-model': {
          id: 'flaky/free-model',
          name: 'flaky/free-model',
          provider: 'openrouter',
          isFree: true,
          contextWindow: 8192,
          capabilities: { chat: true, completion: true, vision: false },
          costPerToken: { prompt: 0, completion: 0 },
          lastUpdated: nowIso,
        },
      },
    };

    const axiosError = Object.assign(new Error('Request failed with status code 429'), {
      isAxiosError: true,
      code: 'ERR_BAD_REQUEST',
      response: {
        status: 429,
        data: {
          error: {
            message: 'Provider returned error',
            code: 429,
          },
        },
      },
      config: {
        headers: {
          Authorization: 'Bearer test-key',
        },
      },
      request: {
        _header: 'Authorization: Bearer test-key\r\nX-Api-Key: hidden-key\r\n',
      },
    });

    jest.spyOn(axios, 'post').mockRejectedValue(axiosError);

    const result = await openRouterModule.callOpenRouterApi('flaky/free-model', 'hello', 1000);

    expect(result.success).toBe(false);
    const logged = JSON.stringify(loggerMock.error.mock.calls);
    expect(logged).not.toContain('test-key');
    expect(logged).not.toContain('hidden-key');
    expect(logged).toContain('[REDACTED]');
  });
});
