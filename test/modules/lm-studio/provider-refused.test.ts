import { afterAll, beforeAll, describe, expect, it, jest } from '@jest/globals';
import http from 'node:http';
import type { AddressInfo } from 'node:net';

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

const { lmStudioModule } = await import('../../../dist/modules/lm-studio/index.js');
const { lmStudioProvider } = await import('../../../dist/modules/lm-studio/provider.js');

function seed(): void {
  lmStudioModule.modelTracking = {
    lastUpdated: new Date().toISOString(),
    models: {
      'qwen-x': {
        id: 'qwen-x', name: 'Qwen X', provider: 'lm-studio', contextWindow: 8192,
        capabilities: { chat: true, completion: true, contextWindow: 8192 },
        costPerToken: { prompt: 0, completion: 0 },
        promptingStrategy: { systemPrompt: 's', useChat: true },
        lastUpdated: new Date().toISOString(),
      },
    },
  } as any;
}

function listen(handler: http.RequestListener): Promise<http.Server> {
  return new Promise((res) => { const s = http.createServer(handler); s.listen(0, '127.0.0.1', () => res(s)); });
}

describe('LM Studio provider with a dead or live server (#156)', () => {
  let refusedPort = 0;
  let upServer: http.Server;
  let hangServer: http.Server;
  let errServer: http.Server;

  beforeAll(async () => {
    const tmp = await listen(() => undefined);
    refusedPort = (tmp.address() as AddressInfo).port;
    await new Promise((r) => tmp.close(r));
    upServer = await listen((_q, r) => { r.setHeader('content-type', 'application/json'); r.end(JSON.stringify({ data: [{ id: 'qwen-x' }] })); });
    hangServer = await listen(() => undefined); // never answers: timeout
    errServer = await listen((_q, r) => { r.statusCode = 500; r.end('boom'); });
  });
  afterAll(async () => {
    for (const s of [upServer, hangServer, errServer]) { s.closeAllConnections?.(); await new Promise((r) => s.close(r)); }
  });

  const use = (port: number) => { cfg.lmStudioEndpoint = `http://127.0.0.1:${port}/v1`; seed(); };

  it('refused connection: not available and no models listed', async () => {
    use(refusedPort);
    expect(await lmStudioProvider.isAvailable()).toBe(false);
    expect(await lmStudioProvider.listModels()).toEqual([]);
    expect(lmStudioModule.modelTracking.models['qwen-x']).toBeDefined(); // stored data kept
  });

  it('server up: models listed as before', async () => {
    use((upServer.address() as AddressInfo).port);
    expect(await lmStudioProvider.isAvailable()).toBe(true);
    expect((await lmStudioProvider.listModels()).map((m) => m.id)).toEqual(['lm-studio:qwen-x']);
  });

  it('non-refusal error (HTTP 500) keeps today behaviour', async () => {
    use((errServer.address() as AddressInfo).port);
    expect(await lmStudioProvider.isAvailable()).toBe(true);
    expect((await lmStudioProvider.listModels()).length).toBe(1);
  });

  it('timeout keeps today behaviour', async () => {
    use((hangServer.address() as AddressInfo).port);
    expect(await lmStudioProvider.isAvailable()).toBe(true);
    expect((await lmStudioProvider.listModels()).length).toBe(1);
  }, 15000);
});
