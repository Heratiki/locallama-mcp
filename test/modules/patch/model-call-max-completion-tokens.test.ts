import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import type { LLMProvider, TaskExecutionOptions } from '../../../src/modules/core/provider/types.js';
import type { LadderEntry, PatchState } from '../../../src/modules/patch/types.js';
import type { WorkerSettings } from '../../../src/modules/patch/worker/contracts.js';

/**
 * #170: a known max_completion_tokens (top_provider.max_completion_tokens) is
 * an upper bound for local/free entries: max_tokens = min(#167 cap,
 * max_completion_tokens), never below PATCH_MAX_OUTPUT_TOKENS unless
 * max_completion_tokens is itself smaller (then it wins).
 */

jest.unstable_mockModule('../../../dist/utils/logger.js', () => ({ logger: {
  error: jest.fn(), warn: jest.fn(), info: jest.fn(), debug: jest.fn(),
} }));

const { PatchModelCalls } = await import('../../../dist/modules/patch/worker/model-call.js');
const { ProviderRegistry, _setProviderRegistryForTests } = await import('../../../dist/modules/core/provider/index.js');
const { promptTokensOf } = await import('../../../dist/modules/patch/ladder/index.js');

const MAX_OUTPUT = 2000;
const prompt = 'alpha beta gamma delta '.repeat(150);
let registry: InstanceType<typeof ProviderRegistry>;
let seen: TaskExecutionOptions[];
let window: number;
let contextTokens: number;
let maxCompletionTokens: number | undefined;

function provider(id: string, costClass: 'local' | 'free' | 'paid'): LLMProvider {
  return {
    id, displayName: id, costClass, isLocal: costClass === 'local', init: async () => {}, isAvailable: async () => true,
    listModels: async () => [{ id: 'm-1', contextWindow: window, maxCompletionTokens }],
    supportsModel: () => true, getCost: () => ({ prompt: 0, completion: 0 }),
    executeTask: async (model, _prompt, options = {}) => { seen.push(options); return { content: 'ok', model }; },
  };
}

function calls() {
  const state = { deadline_at: Date.now() + 60000, paid_spent_usd: 0, paid_reserved_usd: 0 } as PatchState;
  const settings = { patchMaxOutputTokens: MAX_OUTPUT, patchInferenceTimeoutMs: 5000, patchContextTokens: contextTokens } as WorkerSettings;
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
  window = 131072;
  contextTokens = 32000;
  maxCompletionTokens = undefined;
});
afterEach(() => { _setProviderRegistryForTests(undefined); });

describe('patch model call output cap bounded by max_completion_tokens (#170)', () => {
  it('bounds a free entry with max_completion_tokens=4096 to exactly 4096', async () => {
    maxCompletionTokens = 4096;
    await calls().execute(entry('fre', 'free'), 'system', prompt);
    expect(seen[0].maxTokens).toBeLessThanOrEqual(4096);
    expect(seen[0].maxTokens).toBe(4096);
  });

  it('bounds a local entry the same way', async () => {
    maxCompletionTokens = 4096;
    await calls().execute(entry('loc', 'local'), 'system', prompt);
    expect(seen[0].maxTokens).toBeLessThanOrEqual(4096);
    expect(seen[0].maxTokens).toBe(4096);
  });

  it('uses max_completion_tokens when it is below PATCH_MAX_OUTPUT_TOKENS', async () => {
    maxCompletionTokens = 512;
    await calls().execute(entry('fre', 'free'), 'system', prompt);
    expect(seen[0].maxTokens).toBe(512);
  });

  it('behaves as after #167 when max_completion_tokens is unknown', async () => {
    maxCompletionTokens = undefined;
    await calls().execute(entry('fre', 'free'), 'system', prompt);
    const promptTokens = promptTokensOf('system', prompt);
    expect(seen[0].maxTokens).toBeLessThanOrEqual(32000 - promptTokens);
    expect(seen[0].maxTokens).toBeGreaterThan(MAX_OUTPUT);
  });

  it('keeps PATCH_MAX_OUTPUT_TOKENS for a paid entry regardless of max_completion_tokens', async () => {
    maxCompletionTokens = 4096;
    await calls().execute(entry('pay', 'paid'), 'system', prompt);
    expect(seen[0].maxTokens).toBe(MAX_OUTPUT);
  });
});
