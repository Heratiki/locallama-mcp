import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import axios from 'axios';

jest.unstable_mockModule('../../../dist/config/index.js', () => ({
  config: {
    rootDir: process.cwd(),
    ollamaEndpoint: 'http://localhost:11434/api',
    ollamaTimeout: 25,
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

const { ollamaModule } = await import('../../../dist/modules/ollama/index.js');
const { OllamaErrorType } = await import('../../../dist/modules/ollama/types.js');
const { InferenceTimeoutError } = await import('../../../dist/modules/utils/inferenceTimeout.js');

describe('ollamaModule timeout handling', () => {
  beforeEach(() => {
    jest.restoreAllMocks();
    loggerMock.error.mockClear();
    loggerMock.warn.mockClear();
    loggerMock.info.mockClear();
    loggerMock.debug.mockClear();

    ollamaModule.modelTracking = {
      lastUpdated: new Date().toISOString(),
      models: {
        'gemma3n:e2b': {
          id: 'gemma3n:e2b',
          name: 'Gemma 3n E2B',
          provider: 'ollama',
          contextWindow: 8192,
          family: 'gemma',
          size: '3B',
          capabilities: {
            chat: true,
            completion: true,
            embedding: false,
          },
          promptingStrategy: {
            systemPrompt: 'You are a helpful assistant.',
            useChat: true,
          },
          lastUpdated: new Date().toISOString(),
          version: '1.0',
          isLocal: true,
        },
      },
    };
  });

  it('throws InferenceTimeoutError when OLLAMA_TIMEOUT expires', async () => {
    const callSpy = jest.spyOn(ollamaModule, 'callOllamaApi').mockResolvedValue({
      success: false,
      error: OllamaErrorType.TIMEOUT,
    });

    await expect(ollamaModule.executeTask('gemma3n:e2b', 'Write an add function')).rejects.toBeInstanceOf(
      InferenceTimeoutError,
    );

    await expect(ollamaModule.executeTask('gemma3n:e2b', 'Write an add function')).rejects.toMatchObject({
      providerId: 'ollama',
      timeoutMs: 25,
    });

    expect(callSpy).toHaveBeenCalled();
  });

  it('returns content when inference completes within timeout window', async () => {
    const callSpy = jest.spyOn(ollamaModule, 'callOllamaApi').mockResolvedValue({
      success: true,
      text: 'function add(a, b) { return a + b; }',
      usage: {
        prompt_tokens: 12,
        completion_tokens: 9,
      },
    });

    await expect(ollamaModule.executeTask('gemma3n:e2b', 'Write an add function')).resolves.toContain('function add');
    expect(callSpy).toHaveBeenCalled();
  });

  it('redacts authorization details when logging Ollama Axios errors', async () => {
    const axiosError = Object.assign(new Error('Request failed with status code 401'), {
      isAxiosError: true,
      code: 'ERR_BAD_REQUEST',
      response: {
        status: 401,
        data: { error: 'Unauthorized' },
      },
      config: {
        headers: {
          Authorization: 'Bearer test-key',
          'X-Api-Key': 'secret-key',
        },
      },
      request: {
        _header: 'Authorization: Bearer test-key\r\nX-Api-Key: secret-key\r\n',
      },
    });

    jest.spyOn(axios, 'post').mockRejectedValue(axiosError);

    const result = await ollamaModule.callOllamaApi('gemma3n:e2b', 'hello', 1000);

    expect(result.success).toBe(false);
    const logged = JSON.stringify(loggerMock.error.mock.calls);
    expect(logged).not.toContain('test-key');
    expect(logged).not.toContain('secret-key');
    expect(logged).toContain('[REDACTED]');
  });
});
