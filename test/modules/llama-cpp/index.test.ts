/**
 * Unit tests for the llama.cpp provider module (src/modules/llama-cpp/index.ts).
 *
 * Covers: mode detection, availability, model listing, callApi, executeTask,
 * error classification, and releaseResources no-op behaviour.
 */
import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import axios from 'axios';

// --- mocks ---------------------------------------------------------------

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

const loggerMock = {
  error: jest.fn(),
  warn: jest.fn(),
  info: jest.fn(),
  debug: jest.fn(),
};

jest.unstable_mockModule('../../../dist/utils/logger.js', () => ({
  logger: loggerMock,
}));

jest.unstable_mockModule('../../../dist/modules/utils/sanitizeErrorForLogging.js', () => ({
  sanitizeErrorForLogging: (e: unknown) => String(e),
}));

jest.unstable_mockModule('../../../dist/modules/llama-cpp/discovery.js', () => ({
  discoverLlamaBinaries: jest.fn().mockResolvedValue({
    server: null,
    cli: null,
    run: null,
    version: null,
    supportsReasoningFormat: false,
    searchedPaths: [],
  }),
}));

// --- imports (must follow mock declarations) ------------------------------

const { llamaCppModule } = await import('../../../dist/modules/llama-cpp/index.js');
const { LlamaCppErrorType } = await import('../../../dist/modules/llama-cpp/types.js');
const { InferenceTimeoutError } = await import('../../../dist/modules/utils/inferenceTimeout.js');

// -------------------------------------------------------------------------

function makeModelsResponse(ids: string[]) {
  return {
    data: {
      data: ids.map((id) => ({ id, object: 'model' })),
    },
    status: 200,
    headers: {},
  };
}

function makeChatResponse(content: string) {
  return {
    data: {
      choices: [{ index: 0, message: { role: 'assistant', content }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
    },
    status: 200,
    headers: {},
  };
}

describe('llamaCppModule — mode detection', () => {
  beforeEach(() => {
    jest.restoreAllMocks();
    llamaCppModule.cachedModels = [];
    llamaCppModule.mode = 'unknown';
    llamaCppModule.binaries = null;
    llamaCppModule.capabilities = {
      mode: 'unknown',
      modelCount: 0,
      supportsMultiModel: false,
      health: 'unknown',
      lastHealthCheck: new Date(0).toISOString(),
      lastHealthCheckResult: 'not yet run',
      binaryDiscovered: false,
    };
    loggerMock.debug.mockClear();
    loggerMock.info.mockClear();
  });

  it('detects single-model mode when server reports one model', async () => {
    jest.spyOn(axios, 'get').mockResolvedValueOnce(makeModelsResponse(['llama-3-8b']));
    await llamaCppModule.refreshModels();
    expect(llamaCppModule.mode).toBe('single-model');
    expect(llamaCppModule.capabilities.mode).toBe('single-model');
    expect(llamaCppModule.capabilities.supportsMultiModel).toBe(false);
    expect(llamaCppModule.capabilities.modelCount).toBe(1);
  });

  it('detects router mode when server reports multiple models', async () => {
    jest.spyOn(axios, 'get').mockResolvedValueOnce(makeModelsResponse(['llama-3-8b', 'mistral-7b', 'phi-3']));
    await llamaCppModule.refreshModels();
    expect(llamaCppModule.mode).toBe('router');
    expect(llamaCppModule.capabilities.supportsMultiModel).toBe(true);
    expect(llamaCppModule.capabilities.modelCount).toBe(3);
  });

  it('sets mode to unknown when server reports zero models', async () => {
    jest.spyOn(axios, 'get').mockResolvedValueOnce(makeModelsResponse([]));
    await llamaCppModule.refreshModels();
    expect(llamaCppModule.mode).toBe('unknown');
    expect(llamaCppModule.capabilities.modelCount).toBe(0);
  });

  it('initialize() does not throw when endpoint unreachable', async () => {
    jest.spyOn(axios, 'get').mockRejectedValueOnce(
      Object.assign(new Error('ECONNREFUSED'), { code: 'ECONNREFUSED', isAxiosError: true }),
    );
    await expect(llamaCppModule.initialize()).resolves.toBeUndefined();
  });
});

describe('llamaCppModule — getAvailableModels', () => {
  beforeEach(() => {
    jest.restoreAllMocks();
    llamaCppModule.cachedModels = [];
    llamaCppModule.mode = 'unknown';
  });

  it('returns prefixed model list after cache warm', async () => {
    jest.spyOn(axios, 'get').mockResolvedValueOnce(makeModelsResponse(['llama-3-8b']));
    const models = await llamaCppModule.getAvailableModels();
    expect(models).toHaveLength(1);
    expect(models[0].id).toBe('llama-cpp:llama-3-8b');
    expect(models[0].provider).toBe('llama-cpp');
  });

  it('returns empty array when endpoint errors', async () => {
    jest.spyOn(axios, 'get').mockRejectedValueOnce(new Error('ECONNREFUSED'));
    const models = await llamaCppModule.getAvailableModels();
    expect(models).toEqual([]);
  });

  it('uses cached models without additional HTTP call', async () => {
    llamaCppModule.cachedModels = [{ id: 'cached-model', object: 'model' }];
    const getSpy = jest.spyOn(axios, 'get');
    const models = await llamaCppModule.getAvailableModels();
    expect(getSpy).not.toHaveBeenCalled();
    expect(models[0].id).toBe('llama-cpp:cached-model');
  });
});

describe('llamaCppModule — callApi', () => {
  beforeEach(() => {
    jest.restoreAllMocks();
    loggerMock.warn.mockClear();
  });

  it('returns success with text on valid chat completion response', async () => {
    jest.spyOn(axios, 'post').mockResolvedValueOnce(makeChatResponse('Hello world'));
    const result = await llamaCppModule.callApi('llama-3-8b', 'Say hello', 5000);
    expect(result.success).toBe(true);
    expect(result.text).toBe('Hello world');
    expect(result.usage?.prompt_tokens).toBe(10);
  });

  it('includes model field in request body', async () => {
    const postSpy = jest.spyOn(axios, 'post').mockResolvedValueOnce(makeChatResponse('ok'));
    await llamaCppModule.callApi('my-model', 'task', 5000);
    const body = postSpy.mock.calls[0][1] as { model?: string };
    expect(body.model).toBe('my-model');
  });

  it('returns TIMEOUT error when abort fires', async () => {
    jest.spyOn(axios, 'post').mockImplementationOnce(() => {
      const err = Object.assign(new Error('canceled'), { code: 'ERR_CANCELED', isAxiosError: true });
      return Promise.reject(err);
    });
    const result = await llamaCppModule.callApi('llama-3-8b', 'task', 100);
    expect(result.success).toBe(false);
    expect(result.error).toBe(LlamaCppErrorType.TIMEOUT);
  });

  it('returns SERVER_ERROR on ECONNREFUSED', async () => {
    jest.spyOn(axios, 'post').mockRejectedValueOnce(
      Object.assign(new Error('ECONNREFUSED'), { code: 'ECONNREFUSED', isAxiosError: true }),
    );
    const result = await llamaCppModule.callApi('llama-3-8b', 'task', 5000);
    expect(result.success).toBe(false);
    expect(result.error).toBe(LlamaCppErrorType.SERVER_ERROR);
  });

  it('returns MODEL_NOT_FOUND on HTTP 404', async () => {
    jest.spyOn(axios, 'post').mockRejectedValueOnce(
      Object.assign(new Error('Not Found'), {
        isAxiosError: true,
        response: { status: 404, data: {} },
      }),
    );
    const result = await llamaCppModule.callApi('bad-model', 'task', 5000);
    expect(result.success).toBe(false);
    expect(result.error).toBe(LlamaCppErrorType.MODEL_NOT_FOUND);
  });

  it('returns INVALID_REQUEST when choices array empty', async () => {
    jest.spyOn(axios, 'post').mockResolvedValueOnce({
      data: { choices: [] },
      status: 200,
      headers: {},
    });
    const result = await llamaCppModule.callApi('llama-3-8b', 'task', 5000);
    expect(result.success).toBe(false);
    expect(result.error).toBe(LlamaCppErrorType.INVALID_REQUEST);
  });
});

describe('llamaCppModule — executeTask', () => {
  beforeEach(() => {
    jest.restoreAllMocks();
  });

  it('returns text on success', async () => {
    jest.spyOn(llamaCppModule, 'callApi').mockResolvedValueOnce({
      success: true,
      text: 'function add(a,b){return a+b;}',
    });
    const result = await llamaCppModule.executeTask('llama-3-8b', 'Write add function');
    expect(result).toContain('function add');
  });

  it('throws InferenceTimeoutError on TIMEOUT error', async () => {
    jest.spyOn(llamaCppModule, 'callApi').mockResolvedValueOnce({
      success: false,
      error: LlamaCppErrorType.TIMEOUT,
    });
    await expect(
      llamaCppModule.executeTask('llama-3-8b', 'task', { timeoutMs: 5000 }),
    ).rejects.toBeInstanceOf(InferenceTimeoutError);
  });

  it('throws with InferenceTimeoutError.providerId = llama-cpp', async () => {
    jest.spyOn(llamaCppModule, 'callApi').mockResolvedValueOnce({
      success: false,
      error: LlamaCppErrorType.TIMEOUT,
    });
    await expect(
      llamaCppModule.executeTask('llama-3-8b', 'task', { timeoutMs: 9999 }),
    ).rejects.toMatchObject({ providerId: 'llama-cpp', timeoutMs: 9999 });
  });

  it('throws on SERVER_ERROR', async () => {
    jest.spyOn(llamaCppModule, 'callApi').mockResolvedValueOnce({
      success: false,
      error: LlamaCppErrorType.SERVER_ERROR,
    });
    await expect(llamaCppModule.executeTask('llama-3-8b', 'task')).rejects.toThrow(
      'llama.cpp server error',
    );
  });

  it('throws on MODEL_NOT_FOUND', async () => {
    jest.spyOn(llamaCppModule, 'callApi').mockResolvedValueOnce({
      success: false,
      error: LlamaCppErrorType.MODEL_NOT_FOUND,
    });
    await expect(llamaCppModule.executeTask('bad-model', 'task')).rejects.toThrow('bad-model');
  });
});

describe('llamaCppModule — releaseResources', () => {
  it('is a no-op and resolves without throwing', async () => {
    await expect(llamaCppModule.releaseResources('any-model')).resolves.toBeUndefined();
  });

  it('logs a debug message', async () => {
    loggerMock.debug.mockClear();
    await llamaCppModule.releaseResources('my-model');
    expect(loggerMock.debug).toHaveBeenCalledWith(
      expect.stringContaining('no-op'),
    );
  });
});

describe('llamaCppModule — classifyError', () => {
  it('classifies ECONNABORTED as TIMEOUT', () => {
    const err = Object.assign(new Error('timeout'), { code: 'ECONNABORTED', isAxiosError: true });
    expect(llamaCppModule.classifyError(err)).toBe(LlamaCppErrorType.TIMEOUT);
  });

  it('classifies AbortError name as TIMEOUT', () => {
    const err = Object.assign(new Error('aborted'), { name: 'AbortError' });
    expect(llamaCppModule.classifyError(err)).toBe(LlamaCppErrorType.TIMEOUT);
  });

  it('classifies HTTP 500 as SERVER_ERROR', () => {
    const err = Object.assign(new Error('server error'), {
      isAxiosError: true,
      response: { status: 500, data: {} },
    });
    expect(llamaCppModule.classifyError(err)).toBe(LlamaCppErrorType.SERVER_ERROR);
  });

  it('classifies context-length message as CONTEXT_LENGTH_EXCEEDED', () => {
    const err = new Error('context length exceeded, reduce input');
    expect(llamaCppModule.classifyError(err)).toBe(LlamaCppErrorType.CONTEXT_LENGTH_EXCEEDED);
  });
});
