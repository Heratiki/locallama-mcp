import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import axios from 'axios';

jest.unstable_mockModule('../../../dist/config/index.js', () => ({
  config: {
    rootDir: process.cwd(),
    lmStudioEndpoint: 'http://localhost:1234/v1',
    providerTimeoutMs: 120000,
    defaultModelConfig: {
      temperature: 0.1,
      maxTokens: 256,
      topP: 0.95,
      frequencyPenalty: 0,
      presencePenalty: 0,
    },
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

const { lmStudioModule } = await import('../../../dist/modules/lm-studio/index.js');

describe('lmStudioModule logging sanitization', () => {
  beforeEach(() => {
    jest.restoreAllMocks();
    loggerMock.error.mockClear();
    loggerMock.warn.mockClear();
    loggerMock.info.mockClear();
    loggerMock.debug.mockClear();

    lmStudioModule.modelTracking = {
      lastUpdated: new Date().toISOString(),
      models: {
        'qwen2.5-coder-7b': {
          id: 'qwen2.5-coder-7b',
          name: 'Qwen 2.5 Coder 7B',
          provider: 'lm-studio',
          contextWindow: 8192,
          capabilities: {
            chat: true,
            completion: true,
          },
          costPerToken: {
            prompt: 0,
            completion: 0,
          },
          promptingStrategy: {
            systemPrompt: 'You are a helpful assistant.',
            useChat: true,
          },
          lastUpdated: new Date().toISOString(),
          version: '1.0',
        },
      },
    };
  });

  it('redacts authorization details when logging LM Studio Axios errors', async () => {
    const axiosError = Object.assign(new Error('Request failed with status code 401'), {
      isAxiosError: true,
      code: 'ERR_BAD_REQUEST',
      response: {
        status: 401,
        data: { error: 'Unauthorized' },
      },
      config: {
        headers: {
          Authorization: 'Bearer lm-studio-key',
          Cookie: 'session=secret',
        },
      },
      request: {
        _header: 'Authorization: Bearer lm-studio-key\r\nCookie: session=secret\r\n',
      },
    });

    jest.spyOn(axios, 'post').mockRejectedValue(axiosError);

    const result = await lmStudioModule.callLMStudioApi('qwen2.5-coder-7b', 'hello', 1000);

    expect(result.success).toBe(false);
    const logged = JSON.stringify(loggerMock.error.mock.calls);
    expect(logged).not.toContain('lm-studio-key');
    expect(logged).not.toContain('session=secret');
    expect(logged).toContain('[REDACTED]');
  });
});