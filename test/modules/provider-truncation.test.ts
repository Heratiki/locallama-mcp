/**
 * #167: every provider the patch ladder calls maps its "length" stop reason to
 * `truncated: true`; a normal stop or a missing stop reason gives `false`.
 */
import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import axios from 'axios';

jest.unstable_mockModule('../../dist/config/index.js', () => ({
  config: {
    rootDir: process.cwd(),
    llamaCppEndpoint: 'http://localhost:8080',
    lmStudioEndpoint: 'http://localhost:1234/v1',
    ollamaEndpoint: 'http://localhost:11434/api',
    openRouterApiKey: 'test-key',
    openRouterFreeOnly: false,
    openRouterRateLimitPerMinute: 0,
    providerTimeoutMs: 120000,
    ollamaTimeout: 120000,
    defaultModelConfig: { temperature: 0.1, maxTokens: 256, topP: 0.95, frequencyPenalty: 0, presencePenalty: 0 },
  },
}));

jest.unstable_mockModule('../../dist/utils/logger.js', () => ({
  logger: { error: jest.fn(), warn: jest.fn(), info: jest.fn(), debug: jest.fn() },
}));

jest.unstable_mockModule('../../dist/modules/core/provider/local-runtime-lifecycle.js', () => ({
  localProviderLifecycle: { beforeExecution: jest.fn(() => Promise.resolve()) },
  _resetLocalProviderLifecycleForTests: jest.fn(),
}));

jest.unstable_mockModule('../../dist/modules/core/prompting/execution-profile.js', () => ({
  buildCodeTaskExecutionOptions: jest.fn(() => ({})),
}));

const { llamaCppProvider } = await import('../../dist/modules/llama-cpp/provider.js');
const { lmStudioProvider } = await import('../../dist/modules/lm-studio/provider.js');
const { ollamaProvider } = await import('../../dist/modules/ollama/provider.js');
const { openRouterProvider } = await import('../../dist/modules/openrouter/provider.js');
const { lmStudioModule } = await import('../../dist/modules/lm-studio/index.js');
const { ollamaModule } = await import('../../dist/modules/ollama/index.js');
const { openRouterModule } = await import('../../dist/modules/openrouter/index.js');

const usage = { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 };
const openAi = (finish?: string) => ({
  status: 200, headers: {},
  data: { choices: [{ index: 0, message: { role: 'assistant', content: 'body' }, ...(finish === undefined ? {} : { finish_reason: finish }) }], usage },
});
const openAiEmpty = (finish?: string) => ({
  status: 200, headers: {},
  data: { choices: [{ index: 0, message: { role: 'assistant', content: '' }, ...(finish === undefined ? {} : { finish_reason: finish }) }], usage },
});
const ollama = (done?: string) => ({
  status: 200, headers: {},
  data: { message: { role: 'assistant', content: 'body' }, done: true, ...(done === undefined ? {} : { done_reason: done }) },
});
const ollamaEmpty = (done?: string) => ({
  status: 200, headers: {},
  data: { message: { role: 'assistant', content: '' }, done: true, ...(done === undefined ? {} : { done_reason: done }) },
});

const cases = [
  { name: 'llama.cpp', run: () => llamaCppProvider.executeTask('m', 'task'), reply: openAi },
  { name: 'LM Studio', run: () => lmStudioProvider.executeTask('m', 'task'), reply: openAi },
  { name: 'Ollama', run: () => ollamaProvider.executeTask('m', 'task'), reply: ollama },
  { name: 'OpenRouter', run: () => openRouterProvider.executeTask('m/free', 'task'), reply: openAi },
];

const emptyCases = [
  { name: 'llama.cpp', run: () => llamaCppProvider.executeTask('m', 'task'), reply: openAiEmpty },
  { name: 'LM Studio', run: () => lmStudioProvider.executeTask('m', 'task'), reply: openAiEmpty },
  { name: 'Ollama', run: () => ollamaProvider.executeTask('m', 'task'), reply: ollamaEmpty },
];

describe('provider stop reason maps to truncated (#167)', () => {
  beforeEach(() => {
    jest.restoreAllMocks();
    const now = new Date().toISOString();
    const model = (id: string, provider: string) => ({
      id, name: id, provider, contextWindow: 8192, capabilities: { chat: true, completion: true },
      costPerToken: { prompt: 0, completion: 0 }, lastUpdated: now, version: '1',
      promptingStrategy: { systemPrompt: 'sys', useChat: true },
    });
    lmStudioModule.modelTracking = { lastUpdated: now, models: { m: model('m', 'lm-studio') } } as never;
    ollamaModule.modelTracking = { lastUpdated: now, models: { m: model('m', 'ollama') } } as never;
    openRouterModule.modelTracking = { lastUpdated: now, models: { 'm/free': { ...model('m/free', 'openrouter'), isFree: true } }, freeModels: ['m/free'], freeModelHealth: {} } as never;
    jest.spyOn(openRouterModule, 'saveTrackingData').mockResolvedValue(undefined);
  });

  for (const c of cases) {
    describe(c.name, () => {
      it('gives truncated: true for the "length" stop reason', async () => {
        jest.spyOn(axios, 'post').mockResolvedValueOnce(c.reply('length'));
        const result = await c.run();
        expect(result.content).toBe('body');
        expect(result.truncated).toBe(true);
      });

      it('gives truncated: false for a normal stop', async () => {
        jest.spyOn(axios, 'post').mockResolvedValueOnce(c.reply('stop'));
        expect((await c.run()).truncated).toBe(false);
      });

      it('gives truncated: false when the response has no stop reason', async () => {
        jest.spyOn(axios, 'post').mockResolvedValueOnce(c.reply(undefined));
        expect((await c.run()).truncated).toBe(false);
      });
    });
  }
});

describe('empty visible content with a "length" stop is truncation, not an error (#169)', () => {
  beforeEach(() => {
    jest.restoreAllMocks();
    const now = new Date().toISOString();
    const model = (id: string, provider: string) => ({
      id, name: id, provider, contextWindow: 8192, capabilities: { chat: true, completion: true },
      costPerToken: { prompt: 0, completion: 0 }, lastUpdated: now, version: '1',
      promptingStrategy: { systemPrompt: 'sys', useChat: true },
    });
    lmStudioModule.modelTracking = { lastUpdated: now, models: { m: model('m', 'lm-studio') } } as never;
    ollamaModule.modelTracking = { lastUpdated: now, models: { m: model('m', 'ollama') } } as never;
  });

  for (const c of emptyCases) {
    describe(c.name, () => {
      it('returns success with empty content and truncated: true for the "length" stop reason', async () => {
        jest.spyOn(axios, 'post').mockResolvedValueOnce(c.reply('length'));
        const result = await c.run();
        expect(result.content).toBe('');
        expect(result.truncated).toBe(true);
      });

      it('still throws for empty content with a normal stop', async () => {
        jest.spyOn(axios, 'post').mockResolvedValueOnce(c.reply('stop'));
        await expect(c.run()).rejects.toThrow();
      });
    });
  }
});
