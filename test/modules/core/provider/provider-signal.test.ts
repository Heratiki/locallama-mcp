/**
 * PRD 01 5.10: an aborted TaskExecutionOptions.signal ends executeTask of each
 * provider adapter with an AbortError; no signal / live signal changes nothing.
 */
import { describe, expect, it, jest } from '@jest/globals';

const loggerMock = { error: jest.fn(), warn: jest.fn(), info: jest.fn(), debug: jest.fn() };
jest.unstable_mockModule('../../../../dist/utils/logger.js', () => ({ logger: loggerMock }));
jest.unstable_mockModule('../../../../dist/config/index.js', () => ({
  config: {
    rootDir: process.cwd(),
    providerTimeoutMs: 120000,
    openRouterFreeOnly: false,
    openRouterRateLimitPerMinute: 1000,
    defaultModelConfig: { temperature: 0.7, maxTokens: 2048 },
  },
}));
jest.unstable_mockModule('../../../../dist/modules/core/provider/local-runtime-lifecycle.js', () => ({
  localProviderLifecycle: { beforeExecution: jest.fn(() => Promise.resolve()) },
  _resetLocalProviderLifecycleForTests: jest.fn(),
}));
jest.unstable_mockModule('../../../../dist/modules/core/prompting/execution-profile.js', () => ({
  buildCodeTaskExecutionOptions: jest.fn(() => ({})),
}));

// Module executeTask mocks: controllable per test. Not abort-aware on purpose.
const execs: Record<string, jest.Mock<(...a: unknown[]) => Promise<string>>> = {
  llamaCpp: jest.fn(),
  lmStudio: jest.fn(),
  ollama: jest.fn(),
  openRouter: jest.fn(),
};
jest.unstable_mockModule('../../../../dist/modules/llama-cpp/index.js', () => ({ llamaCppModule: { executeTask: execs.llamaCpp } }));
jest.unstable_mockModule('../../../../dist/modules/lm-studio/index.js', () => ({ lmStudioModule: { executeTask: execs.lmStudio } }));
jest.unstable_mockModule('../../../../dist/modules/ollama/index.js', () => ({ ollamaModule: { executeTask: execs.ollama } }));
jest.unstable_mockModule('../../../../dist/modules/openrouter/index.js', () => ({ openRouterModule: { executeTask: execs.openRouter } }));

const { llamaCppProvider } = await import('../../../../dist/modules/llama-cpp/provider.js');
const { lmStudioProvider } = await import('../../../../dist/modules/lm-studio/provider.js');
const { ollamaProvider } = await import('../../../../dist/modules/ollama/provider.js');
const { openRouterProvider } = await import('../../../../dist/modules/openrouter/provider.js');

const cases = [
  ['llama-cpp', llamaCppProvider, 'llamaCpp'],
  ['lm-studio', lmStudioProvider, 'lmStudio'],
  ['ollama', ollamaProvider, 'ollama'],
  ['openrouter', openRouterProvider, 'openRouter'],
] as const;

describe.each(cases)('%s provider signal', (_name, provider, key) => {
  it('rejects promptly with AbortError when the signal aborts mid-call', async () => {
    execs[key].mockImplementation(() => new Promise<string>(() => undefined)); // never settles
    const ac = new AbortController();
    const p = provider.executeTask('m', 'task', { signal: ac.signal });
    setTimeout(() => ac.abort(), 10);
    await expect(p).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('rejects with AbortError when the signal is already aborted', async () => {
    execs[key].mockImplementation(() => new Promise<string>(() => undefined));
    const ac = new AbortController();
    ac.abort();
    await expect(provider.executeTask('m', 'task', { signal: ac.signal })).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('returns normally with a live signal and with no signal', async () => {
    execs[key].mockResolvedValue('ok');
    const ac = new AbortController();
    await expect(provider.executeTask('m', 'task', { signal: ac.signal })).resolves.toMatchObject({ content: 'ok' });
    await expect(provider.executeTask('m', 'task')).resolves.toMatchObject({ content: 'ok' });
  });
});
