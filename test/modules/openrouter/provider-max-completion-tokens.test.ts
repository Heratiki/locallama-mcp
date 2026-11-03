import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import axios from 'axios';
import type { TaskExecutionOptions } from '../../../src/modules/core/provider/types.js';
import type { LadderEntry, PatchState } from '../../../src/modules/patch/types.js';
import type { WorkerSettings } from '../../../src/modules/patch/worker/contracts.js';

/**
 * #170 fix round (AC5): the OpenRouter provider adapter passes
 * maxCompletionTokens through listModels(), so PatchModelCalls bounds
 * max_tokens by it. HTTP is stubbed (axios.get); no real API calls.
 */

jest.unstable_mockModule('../../../dist/config/index.js', () => ({
  config: {
    rootDir: process.cwd(),
    openRouterApiKey: 'test-key',
    openRouterFreeOnly: true,
    openRouterRateLimitPerMinute: 0,
  },
}));

jest.unstable_mockModule('../../../dist/utils/logger.js', () => ({
  logger: { error: jest.fn(), warn: jest.fn(), info: jest.fn(), debug: jest.fn() },
}));

const { openRouterModule } = await import('../../../dist/modules/openrouter/index.js');
const { openRouterProvider } = await import('../../../dist/modules/openrouter/provider.js');
const { PatchModelCalls } = await import('../../../dist/modules/patch/worker/model-call.js');
const { ProviderRegistry } = await import('../../../dist/modules/core/provider/index.js');

const MAX_COMPLETION = 512;
const prompt = 'alpha beta gamma delta '.repeat(150);

describe('OpenRouter provider passes maxCompletionTokens (#170 AC5)', () => {
  beforeEach(async () => {
    jest.restoreAllMocks();
    openRouterModule.modelTracking = {
      models: {},
      freeModels: [],
      freeModelHealth: {},
      lastUpdated: new Date().toISOString(),
    };
    jest.spyOn(openRouterModule, 'saveTrackingData').mockResolvedValue(undefined);
    jest.spyOn(axios, 'get').mockResolvedValueOnce({
      status: 200,
      headers: {},
      data: {
        data: [
          {
            id: 'free/bounded',
            name: 'Bounded',
            context_length: 131072,
            pricing: { prompt: 0, completion: 0 },
            top_provider: { max_completion_tokens: MAX_COMPLETION },
            features: { chat: true, completion: true, vision: false },
          },
          {
            id: 'free/unbounded',
            name: 'Unbounded',
            context_length: 131072,
            pricing: { prompt: 0, completion: 0 },
            features: { chat: true, completion: true, vision: false },
          },
        ],
      },
    });
    await openRouterModule.updateModels();
  });

  it('listModels() returns maxCompletionTokens for a record that has it', async () => {
    const models = await openRouterProvider.listModels();
    expect(models.find((m) => m.id === 'free/bounded')?.maxCompletionTokens).toBe(MAX_COMPLETION);
    expect(models.find((m) => m.id === 'free/unbounded')?.maxCompletionTokens).toBeUndefined();
  });

  it('PatchModelCalls.execute sends maxTokens <= maxCompletionTokens via the adapter', async () => {
    const seen: TaskExecutionOptions[] = [];
    const adapter = Object.create(openRouterProvider) as typeof openRouterProvider;
    adapter.executeTask = async (model, _p, options = {}) => {
      seen.push(options);
      return { content: 'ok', model };
    };
    const registry = new ProviderRegistry();
    registry.register(adapter);

    const state = { deadline_at: Date.now() + 60000, paid_spent_usd: 0, paid_reserved_usd: 0 } as PatchState;
    const settings = { patchMaxOutputTokens: 2000, patchInferenceTimeoutMs: 5000, patchContextTokens: 32000 } as WorkerSettings;
    const calls = new PatchModelCalls({
      registry, state, settings, capUsd: 10, signal: new AbortController().signal, now: Date.now, persistSpend: async () => {},
    });
    const entry: LadderEntry = {
      model_id: 'free/bounded', provider_id: 'openrouter', cost_class: 'free', prompt_price: 0, completion_price: 0,
    };

    await calls.execute(entry, 'system', prompt);

    expect(seen).toHaveLength(1);
    expect(seen[0].maxTokens).toBeDefined();
    expect(seen[0].maxTokens as number).toBeLessThanOrEqual(MAX_COMPLETION);
  });
});
