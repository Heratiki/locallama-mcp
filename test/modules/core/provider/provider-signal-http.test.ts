/**
 * PRD 01 5.10: an aborted signal passed to a module executeTask cancels the
 * in-flight HTTP request (the fake server sees the connection close).
 */
import { afterAll, beforeAll, describe, expect, it, jest } from '@jest/globals';
import axios from 'axios';
import http from 'node:http';
import type { AddressInfo } from 'node:net';

const { config } = await import('../../../../dist/config/index.js');
const { llamaCppModule } = await import('../../../../dist/modules/llama-cpp/index.js');
const { lmStudioModule } = await import('../../../../dist/modules/lm-studio/index.js');
const { ollamaModule } = await import('../../../../dist/modules/ollama/index.js');
const { openRouterModule } = await import('../../../../dist/modules/openrouter/index.js');

let server: http.Server;
let closed = 0;
let received = 0;

beforeAll(async () => {
  // Never answers: the request stays in flight until the client drops it.
  server = http.createServer((req, res) => {
    received++;
    req.on('data', () => undefined);
    res.on('close', () => { if (!res.writableEnded) closed++; });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const c = config as unknown as Record<string, unknown>;
  c.llamaCppEndpoint = base;
  c.lmStudioEndpoint = `${base}/v1`;
  c.ollamaEndpoint = base;
  c.openRouterApiKey = 'test-key';
  c.providerTimeoutMs = 20000;
  c.ollamaTimeout = 20000;
  // Seed minimal tracking entries so the modules reach the HTTP call.
  const seed = (m: unknown): void => {
    ((m as { modelTracking: { models: Record<string, unknown> } }).modelTracking.models)['m'] = {
      id: 'm', name: 'm', capabilities: {}, costPerToken: { prompt: 0, completion: 0 },
    };
  };
  seed(ollamaModule);
  seed(openRouterModule);
  seed(lmStudioModule);
});

afterAll(async () => {
  server.closeAllConnections();
  http.globalAgent.destroy(); // axios keep-alive sockets
  await new Promise<void>((r) => server.close(() => r()));
});

async function waitFor(cond: () => boolean, ms = 3000): Promise<void> {
  const t0 = Date.now();
  while (!cond() && Date.now() - t0 < ms) await new Promise((r) => setTimeout(r, 10));
}

const cases: Array<[string, (s: AbortSignal) => Promise<unknown>]> = [
  ['llama-cpp', (s) => llamaCppModule.executeTask('m', 't', { signal: s })],
  ['lm-studio', (s) => lmStudioModule.executeTask('m', 't', { signal: s })],
  ['ollama', (s) => ollamaModule.executeTask('m', 't', { signal: s })],
];

describe.each(cases)('%s executeTask signal', (_n, run) => {
  it('closes the HTTP connection when the signal aborts', async () => {
    closed = 0;
    received = 0;
    const ac = new AbortController();
    const p = run(ac.signal).catch((e) => e);
    await waitFor(() => received > 0);
    expect(received).toBeGreaterThan(0);
    ac.abort();
    await waitFor(() => closed > 0);
    expect(closed).toBeGreaterThan(0);
    const err = (await p) as Error;
    expect(err.name).toBe('AbortError'); // a caller abort is not reported as a timeout
  });
});

// OpenRouter's URL is hardcoded, so observe the axios config instead of a socket.
describe('openrouter executeTask signal', () => {
  it('hands axios a signal that aborts when the caller signal aborts', async () => {
    let seen: AbortSignal | undefined;
    const spy = jest.spyOn(axios, 'post').mockImplementation((_u, _b, cfg) => {
      seen = cfg?.signal as AbortSignal;
      return new Promise((_res, rej) => {
        seen.addEventListener('abort', () => rej(Object.assign(new Error('canceled'), { code: 'ERR_CANCELED', isAxiosError: true })));
      });
    });
    const ac = new AbortController();
    const p = openRouterModule.executeTask('m', 't', { signal: ac.signal }).catch((e) => e);
    await waitFor(() => seen !== undefined);
    expect(seen).toBeDefined();
    expect(seen?.aborted).toBe(false);
    ac.abort();
    expect(seen?.aborted).toBe(true);
    const err = (await p) as Error;
    spy.mockRestore();
    expect(err.name).toBe('AbortError'); // not InferenceTimeoutError
  });
});
