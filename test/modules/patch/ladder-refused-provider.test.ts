import { describe, expect, it, jest } from '@jest/globals';
import http from 'node:http';
import type { AddressInfo } from 'node:net';

// Real LM Studio provider pointed at a dead port + a working llama-cpp mock.
const cfg = {
  rootDir: process.cwd(),
  lmStudioEndpoint: 'http://127.0.0.1:1/v1',
  providerTimeoutMs: 120000,
  defaultModelConfig: { temperature: 0.1, maxTokens: 256, topP: 0.95, frequencyPenalty: 0, presencePenalty: 0 },
};
jest.unstable_mockModule('../../../dist/config/index.js', () => ({ config: cfg }));
jest.unstable_mockModule('../../../dist/utils/logger.js', () => ({
  logger: { error: jest.fn(), warn: jest.fn(), info: jest.fn(), debug: jest.fn() },
}));
jest.unstable_mockModule('../../../dist/modules/core/provider/index.js', () => ({
  getProviderRegistry: () => ({ isAvailable: () => true }),
}));

const { lmStudioModule } = await import('../../../dist/modules/lm-studio/index.js');
const { lmStudioProvider } = await import('../../../dist/modules/lm-studio/provider.js');
const { buildLadder } = await import('../../../dist/modules/patch/ladder/build.js');

describe('buildLadder with a refused LM Studio (#156)', () => {
  it('local tier holds only llama-cpp models', async () => {
    const tmp = http.createServer();
    await new Promise<void>((r) => tmp.listen(0, '127.0.0.1', () => r()));
    const port = (tmp.address() as AddressInfo).port;
    await new Promise((r) => tmp.close(r));
    cfg.lmStudioEndpoint = `http://127.0.0.1:${port}/v1`;
    lmStudioModule.modelTracking = {
      lastUpdated: new Date().toISOString(),
      models: {
        'qwen2.5-coder-32b-instruct': {
          id: 'qwen2.5-coder-32b-instruct', name: 'Qwen', provider: 'lm-studio', contextWindow: 8192,
          capabilities: { chat: true, completion: true, contextWindow: 8192 },
          costPerToken: { prompt: 0, completion: 0 }, promptingStrategy: { systemPrompt: 's', useChat: true },
          lastUpdated: new Date().toISOString(),
        },
      },
    } as any;
    const llama: any = {
      id: 'llama-cpp', displayName: 'llama', costClass: 'local', isLocal: true,
      isAvailable: async () => true,
      listModels: async () => [{ id: 'router-a' }, { id: 'router-b' }],
      getCost: () => ({ prompt: 0, completion: 0 }),
    };
    const ladder = await buildLadder({
      providers: { list: () => [lmStudioProvider as any, llama] },
      models: { getModel: (id: string) => (id.includes('qwen2.5') ? { capabilities: { scores: { code: 0.99 } } } : undefined) } as any,
      allowPaid: false, freeOnly: true, localModels: 4, freeModels: 0, paidModels: 0,
    });
    const local = ladder.filter((e) => e.cost_class === 'local');
    expect(local.length).toBeGreaterThan(0);
    expect(local.every((e) => e.provider_id === 'llama-cpp')).toBe(true);
  });
});
