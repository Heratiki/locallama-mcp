import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import axios from 'axios';

/**
 * #170: OpenRouter lists top_provider.max_completion_tokens — the largest
 * completion the serving provider accepts. Store it on the model record so the
 * patch output cap can bound max_tokens by it.
 */

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

function modelsResponse(models: Record<string, unknown>[]) {
  return { status: 200, headers: {}, data: { data: models } };
}

const baseModel = {
  id: 'free/model',
  name: 'Free Model',
  context_length: 128000,
  pricing: { prompt: 0, completion: 0 },
  features: { chat: true, completion: true, vision: false },
};

describe('openRouterModule stores top_provider.max_completion_tokens (#170)', () => {
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

  it('stores top_provider.max_completion_tokens on the model record', async () => {
    jest.spyOn(axios, 'get').mockResolvedValueOnce(modelsResponse([{
      ...baseModel,
      top_provider: { max_completion_tokens: 4096 },
    }]));

    await openRouterModule.updateModels();

    expect(openRouterModule.modelTracking.models['free/model'].maxCompletionTokens).toBe(4096);
  });

  it('leaves maxCompletionTokens undefined when the API omits top_provider', async () => {
    jest.spyOn(axios, 'get').mockResolvedValueOnce(modelsResponse([{ ...baseModel }]));

    await openRouterModule.updateModels();

    expect(openRouterModule.modelTracking.models['free/model'].maxCompletionTokens).toBeUndefined();
  });
});
