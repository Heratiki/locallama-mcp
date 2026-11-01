import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import axios from 'axios';
import type { AxiosResponse } from 'axios';

/**
 * Issue #137: OpenRouter is a remote API and must never send `draft_model`,
 * and the benchmark service may only look for a speculative-decoding draft
 * model for local providers (lm-studio, ollama).
 *
 * This file covers both halves of the fix:
 *  - openRouterModule.callOpenRouterApi must not put draft_model in the body
 *  - benchmarkService.benchmarkFreeModels must only search a draft model for
 *    lm-studio and ollama, and log at debug level for every other provider
 */

interface TestModel {
  id: string;
  name: string;
  provider: string;
  capabilities: { chat: boolean; completion: boolean };
  costPerToken: { prompt: number; completion: number };
  contextWindow: number;
}

jest.unstable_mockModule('../../../dist/config/index.js', () => ({
  config: {
    rootDir: '/tmp/opencode/issue-137-test',
    openRouterApiKey: 'test-key',
    benchmark: {
      resultsPath: '/tmp/opencode/issue-137-test/benchmark-results',
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

const findCompatibleDraftModelMock = jest.fn<(target: TestModel, availableModels: TestModel[]) => TestModel>();

jest.unstable_mockModule('../../../dist/modules/decision-engine/services/speculativeDecoding.js', () => ({
  speculativeDecodingService: {
    findCompatibleDraftModel: findCompatibleDraftModelMock,
  },
}));

const getAvailableModelsMock = jest.fn<() => Promise<TestModel[]>>();
const getFreeModelsMock = jest.fn<() => Promise<TestModel[]>>();

jest.unstable_mockModule('../../../dist/modules/cost-monitor/index.js', () => ({
  costMonitor: {
    getAvailableModels: getAvailableModelsMock,
    getFreeModels: getFreeModelsMock,
  },
}));

const modelsDbServiceMock = {
  initialize: jest.fn<() => Promise<void>>(),
  getDatabase: jest.fn<() => { models: Record<string, unknown> }>(),
  updateModelData: jest.fn<() => Promise<void>>(),
};

jest.unstable_mockModule('../../../dist/modules/decision-engine/services/modelsDb.js', () => ({
  modelsDbService: modelsDbServiceMock,
}));

const saveResultMock = jest.fn<() => Promise<void>>();

jest.unstable_mockModule('../../../dist/modules/benchmark/storage/results.js', () => ({
  saveResult: saveResultMock,
}));

const callLmStudioApiMock = jest.fn<() => Promise<{ success: boolean }>>();

jest.unstable_mockModule('../../../dist/modules/benchmark/api/lm-studio.js', () => ({
  callLmStudioApi: callLmStudioApiMock,
}));

const callOllamaApiMock = jest.fn<() => Promise<{ success: boolean }>>();

jest.unstable_mockModule('../../../dist/modules/benchmark/api/ollama.js', () => ({
  callOllamaApi: callOllamaApiMock,
}));

const executeProviderTaskMock = jest.fn<() => Promise<unknown>>();
const getProviderRegistryMock = jest.fn<() => unknown>();

jest.unstable_mockModule('../../../dist/modules/core/provider/index.js', () => ({
  executeProviderTask: executeProviderTaskMock,
  getProviderRegistry: getProviderRegistryMock,
  isProviderId:
    (modelProvider: string | undefined | null, expectedId: string) =>
      Boolean(modelProvider) && modelProvider === expectedId,
  isProviderLocal:
    (modelProvider: string | undefined | null) =>
      modelProvider === 'local' || modelProvider === 'lm-studio' || modelProvider === 'ollama',
}));

const { openRouterModule } = await import('../../../dist/modules/openrouter/index.js');
const { benchmarkService } = await import('../../../dist/modules/decision-engine/services/benchmarkService.js');

const OPENROUTER_MODEL_ID = 'meta-llama/llama-3.2-11b-instruct:free';
const LMSTUDIO_MODEL_ID = 'lm-studio:llama3';
const OLLAMA_MODEL_ID = 'ollama:llama3.2';

const makeModel = (id: string, provider: string): TestModel => ({
  id,
  name: id,
  provider,
  capabilities: { chat: true, completion: true },
  costPerToken: { prompt: 0, completion: 0 },
  contextWindow: 8192,
});

const draftFor = (provider: string): TestModel => ({
  id: `draft-${provider}`,
  name: `draft-${provider}`,
  provider,
  capabilities: { chat: true, completion: true },
  costPerToken: { prompt: 0, completion: 0 },
  contextWindow: 4096,
});

describe('openRouterModule.callOpenRouterApi draft_model (issue #137)', () => {
  beforeEach(() => {
    jest.restoreAllMocks();
    loggerMock.error.mockClear();
    loggerMock.warn.mockClear();
    loggerMock.info.mockClear();
    loggerMock.debug.mockClear();

    findCompatibleDraftModelMock.mockReset();
    findCompatibleDraftModelMock.mockImplementation((target: TestModel) => draftFor(target.provider));

    openRouterModule.modelTracking = {
      models: {
        [OPENROUTER_MODEL_ID]: {
          id: OPENROUTER_MODEL_ID,
          name: OPENROUTER_MODEL_ID,
          provider: 'openrouter',
          isFree: true,
          contextWindow: 8192,
          capabilities: { chat: true, completion: true, vision: false },
          costPerToken: { prompt: 0, completion: 0 },
          lastUpdated: new Date().toISOString(),
        },
      },
      freeModels: [OPENROUTER_MODEL_ID],
      freeModelHealth: {},
      lastUpdated: new Date().toISOString(),
    };
    openRouterModule.promptingStrategies = {};

    jest.spyOn(openRouterModule, 'saveTrackingData').mockResolvedValue(undefined);
  });

  it('never sends draft_model in the chat completion request body', async () => {
    const postSpy = jest.spyOn(axios, 'post').mockResolvedValue({
      status: 200,
      data: {
        choices: [{ message: { content: 'fn add(a, b) { return a + b; }' } }],
        usage: { prompt_tokens: 3, completion_tokens: 2 },
      },
    } as unknown as AxiosResponse);

    const result = await openRouterModule.callOpenRouterApi(OPENROUTER_MODEL_ID, 'Write a JS add function', 5000);

    expect(result.success).toBe(true);
    expect(postSpy).toHaveBeenCalledTimes(1);

    const requestBody = postSpy.mock.calls[0][1] as Record<string, unknown>;
    expect(requestBody.model).toBe(OPENROUTER_MODEL_ID);
    expect(requestBody).not.toHaveProperty('draft_model');
    expect(findCompatibleDraftModelMock).not.toHaveBeenCalled();
  });
});

describe('benchmarkService.benchmarkFreeModels draft-model gating (issue #137)', () => {
  beforeEach(() => {
    jest.restoreAllMocks();
    loggerMock.error.mockClear();
    loggerMock.warn.mockClear();
    loggerMock.info.mockClear();
    loggerMock.debug.mockClear();

    delete process.env.MAX_MODELS_TO_BENCHMARK;

    findCompatibleDraftModelMock.mockReset();
    findCompatibleDraftModelMock.mockImplementation((target: TestModel) => draftFor(target.provider));

    modelsDbServiceMock.initialize.mockReset();
    modelsDbServiceMock.initialize.mockResolvedValue(undefined);
    modelsDbServiceMock.getDatabase.mockReset();
    modelsDbServiceMock.getDatabase.mockReturnValue({ models: {} });
    modelsDbServiceMock.updateModelData.mockReset();
    modelsDbServiceMock.updateModelData.mockResolvedValue(undefined);

    getAvailableModelsMock.mockReset();
    getAvailableModelsMock.mockResolvedValue([
      makeModel(LMSTUDIO_MODEL_ID, 'lm-studio'),
      makeModel(OLLAMA_MODEL_ID, 'ollama'),
    ]);
    getFreeModelsMock.mockReset();
    getFreeModelsMock.mockResolvedValue([makeModel(OPENROUTER_MODEL_ID, 'openrouter')]);

    saveResultMock.mockReset();
    saveResultMock.mockResolvedValue(undefined);

    callLmStudioApiMock.mockReset();
    callLmStudioApiMock.mockResolvedValue({ success: false });
    callOllamaApiMock.mockReset();
    callOllamaApiMock.mockResolvedValue({ success: false });

    executeProviderTaskMock.mockReset();
    getProviderRegistryMock.mockReset();
    getProviderRegistryMock.mockReturnValue({
      get: (id: string) =>
        id === 'openrouter'
          ? {
              id: 'openrouter',
              executeTask: async () => ({ content: '' }),
            }
          : undefined,
      executeWithConcurrencyLimit: async (_provider: unknown, task: () => Promise<unknown>) => task(),
    });

    jest.spyOn(benchmarkService, 'updateModelPerformanceProfiles').mockResolvedValue(undefined);
    jest.spyOn(benchmarkService, 'generateComprehensiveSummary').mockResolvedValue(undefined);

    jest.useFakeTimers({
      doNotFake: ['setImmediate', 'queueMicrotask', 'nextTick'],
    } as unknown as Parameters<typeof jest.useFakeTimers>[0]);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('searches a draft model only for lm-studio and ollama, not for remote providers', async () => {
    let settled = false;
    const run = benchmarkService.benchmarkFreeModels();
    run.then(
      () => {
        settled = true;
      },
      () => {
        settled = true;
      },
    );

    // Drive virtual time (the 5s/10s benchmark pauses) forward while letting
    // the real event loop flush the on-disk benchmark checks between advances.
    for (let i = 0; i < 300 && !settled; i++) {
      await jest.advanceTimersByTimeAsync(1000);
      await new Promise<void>((resolve) => setImmediate(resolve));
    }

    expect(settled).toBe(true);
    await run;

    // The draft-model search ran for the local providers only.
    expect(findCompatibleDraftModelMock).toHaveBeenCalledTimes(2);
    const searchedIds = findCompatibleDraftModelMock.mock.calls.map(([target]) => target.id);
    expect(searchedIds).toContain(LMSTUDIO_MODEL_ID);
    expect(searchedIds).toContain(OLLAMA_MODEL_ID);
    expect(searchedIds).not.toContain(OPENROUTER_MODEL_ID);

    // Remote providers log at debug level that speculative decoding is off.
    expect(loggerMock.debug).toHaveBeenCalledWith(expect.stringContaining('Speculative decoding disabled'));

    // The local draft models are still wired into the local API calls.
    expect(callLmStudioApiMock).toHaveBeenCalledWith(
      LMSTUDIO_MODEL_ID,
      expect.any(String),
      expect.any(Number),
      'draft-lm-studio',
    );
    expect(callOllamaApiMock).toHaveBeenCalledWith(
      OLLAMA_MODEL_ID,
      expect.any(String),
      expect.any(Number),
      'draft-ollama',
    );
  });
});
