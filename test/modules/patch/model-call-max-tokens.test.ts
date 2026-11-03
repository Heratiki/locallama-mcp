import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import type { LLMProvider, TaskExecutionOptions } from '../../../src/modules/core/provider/types.js';
import type { LadderEntry, PatchState } from '../../../src/modules/patch/types.js';
import type { WorkerSettings } from '../../../src/modules/patch/worker/contracts.js';

jest.unstable_mockModule('../../../dist/utils/logger.js', () => ({ logger: {
  error: jest.fn(), warn: jest.fn(), info: jest.fn(), debug: jest.fn(),
} }));

const { PatchModelCalls } = await import('../../../dist/modules/patch/worker/model-call.js');
const { ProviderRegistry, _setProviderRegistryForTests } = await import('../../../dist/modules/core/provider/index.js');
const { ContextWindowError } = await import('../../../dist/modules/utils/contextWindow.js');
const { promptTokensOf } = await import('../../../dist/modules/patch/ladder/index.js');

const MAX_OUTPUT = 2000;
const prompt = 'alpha beta gamma delta '.repeat(150);
let registry: InstanceType<typeof ProviderRegistry>;
let seen: TaskExecutionOptions[];
let window: number;

function provider(id: string, costClass: 'local' | 'free' | 'paid'): LLMProvider {
  return {
    id, displayName: id, costClass, isLocal: costClass === 'local', init: async () => {}, isAvailable: async () => true,
    listModels: async () => [{ id: 'm-1', contextWindow: window }],
    supportsModel: () => true, getCost: () => ({ prompt: 0, completion: 0 }),
    executeTask: async (model, _prompt, options = {}) => { seen.push(options); return { content: 'ok', model }; },
  };
}

function calls() {
  const state = { deadline_at: Date.now() + 60000, paid_spent_usd: 0, paid_reserved_usd: 0 } as PatchState;
  const settings = { patchMaxOutputTokens: MAX_OUTPUT, patchInferenceTimeoutMs: 5000, patchContextTokens: 8192 } as WorkerSettings;
  return new PatchModelCalls({
    registry, state, settings, capUsd: 10, signal: new AbortController().signal, now: Date.now, persistSpend: async () => {},
  });
}
const entry = (id: string, cost_class: LadderEntry['cost_class']): LadderEntry =>
  ({ model_id: 'm-1', provider_id: id, cost_class, prompt_price: 0.000001, completion_price: 0.000002 });

beforeEach(() => {
  registry = new ProviderRegistry();
  registry.register(provider('loc', 'local'));
  registry.register(provider('fre', 'free'));
  registry.register(provider('pay', 'paid'));
  seen = [];
  window = 8192;
});
afterEach(() => { _setProviderRegistryForTests(undefined); });

describe('patch model call output cap (#167)', () => {
  it.each(['local', 'free'] as const)('sizes max_tokens from the free context for a %s entry', async (cost) => {
    const id = cost === 'local' ? 'loc' : 'fre';
    await calls().execute(entry(id, cost), 'system', prompt);
    const promptTokens = promptTokensOf('system', prompt);
    expect(promptTokens).toBeGreaterThan(400);
    expect(seen[0].maxTokens).toBeGreaterThan(MAX_OUTPUT);
    expect(seen[0].maxTokens).toBeLessThanOrEqual(8192 - promptTokens);
  });

  it('keeps PATCH_MAX_OUTPUT_TOKENS for a paid entry', async () => {
    await calls().execute(entry('pay', 'paid'), 'system', prompt);
    expect(seen[0].maxTokens).toBe(MAX_OUTPUT);
  });

  it('uses PATCH_MAX_OUTPUT_TOKENS as the minimum when the free context is small', async () => {
    const promptTokens = promptTokensOf('system', prompt);
    window = promptTokens + MAX_OUTPUT + 10;
    await calls().execute(entry('loc', 'local'), 'system', prompt);
    expect(seen[0].maxTokens).toBe(MAX_OUTPUT);
  });

  it('still throws ContextWindowError when the window cannot hold the prompt plus PATCH_MAX_OUTPUT_TOKENS', async () => {
    window = promptTokensOf('system', prompt) + MAX_OUTPUT - 1;
    await expect(calls().execute(entry('loc', 'local'), 'system', prompt)).rejects.toBeInstanceOf(ContextWindowError);
    expect(seen).toHaveLength(0);
  });
});
