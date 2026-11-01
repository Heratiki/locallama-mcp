import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import type { LLMProvider } from '../../../src/modules/core/provider/types.js';
import type { LadderEntry, PatchState } from '../../../src/modules/patch/types.js';
import type { WorkerSettings } from '../../../src/modules/patch/worker/contracts.js';

jest.unstable_mockModule('../../../dist/utils/logger.js', () => ({ logger: {
  error: jest.fn(), warn: jest.fn(), info: jest.fn(), debug: jest.fn(),
} }));

const { PatchModelCalls } = await import('../../../dist/modules/patch/worker/model-call.js');
const { InferenceTimeout, WorkerStop } = await import('../../../dist/modules/patch/worker/contracts.js');
const { ProviderRegistry, _setProviderRegistryForTests } = await import('../../../dist/modules/core/provider/index.js');
const { buildLadder } = await import('../../../dist/modules/patch/ladder/index.js');

const entry: LadderEntry = { model_id: 'm-1', provider_id: 'brk', cost_class: 'local' };
type Run = (signal?: AbortSignal) => Promise<{ content: string }>;

let registry: InstanceType<typeof ProviderRegistry>;
let controller: AbortController;
let run: Run;

function provider(): LLMProvider {
  return {
    id: 'brk', displayName: 'brk', costClass: 'local', isLocal: true, init: async () => {}, isAvailable: async () => true,
    listModels: async () => [{ id: 'm-1', contextWindow: 8192 }],
    supportsModel: () => true, getCost: () => ({ prompt: 0, completion: 0 }),
    executeTask: async (model, _prompt, options = {}) => ({ ...(await run(options.signal)), model }),
  };
}

function calls(timeoutMs = 5000) {
  const now = Date.now();
  const state = { deadline_at: now + 60000, paid_spent_usd: 0, paid_reserved_usd: 0 } as PatchState;
  const settings = { patchMaxOutputTokens: 100, patchInferenceTimeoutMs: timeoutMs, patchContextTokens: 8192 } as WorkerSettings;
  return new PatchModelCalls({
    registry, state, settings, capUsd: 0, signal: controller.signal, now: Date.now, persistSpend: async () => {},
  });
}

beforeEach(() => {
  registry = new ProviderRegistry();
  registry.register(provider());
  controller = new AbortController();
  run = async () => ({ content: 'ok' });
});
afterEach(() => { _setProviderRegistryForTests(undefined); });

describe('patch model calls feed the provider circuit breaker (#157)', () => {
  it('records success with the provider id after a good response', async () => {
    const ok = jest.spyOn(registry, 'recordProviderSuccess');
    const bad = jest.spyOn(registry, 'recordProviderFailure');
    await calls().execute(entry, 'sys', 'prompt');
    expect(ok).toHaveBeenCalledWith('brk');
    expect(bad).not.toHaveBeenCalled();
  });

  it('records failure after a provider error', async () => {
    run = async () => { throw new Error('connect ECONNREFUSED 127.0.0.1:1234'); };
    const ok = jest.spyOn(registry, 'recordProviderSuccess');
    const bad = jest.spyOn(registry, 'recordProviderFailure');
    await expect(calls().execute(entry, 'sys', 'prompt')).rejects.toThrow('ECONNREFUSED');
    expect(bad).toHaveBeenCalledWith('brk');
    expect(ok).not.toHaveBeenCalled();
  });

  it('records failure after an inference timeout', async () => {
    run = () => new Promise(() => {});
    const bad = jest.spyOn(registry, 'recordProviderFailure');
    await expect(calls(20).execute(entry, 'sys', 'prompt')).rejects.toBeInstanceOf(InferenceTimeout);
    expect(bad).toHaveBeenCalledWith('brk');
  });

  it('records nothing when the job is aborted', async () => {
    let started!: () => void;
    const begun = new Promise<void>(resolve => { started = resolve; });
    run = () => { started(); return new Promise(() => {}); };
    const ok = jest.spyOn(registry, 'recordProviderSuccess');
    const bad = jest.spyOn(registry, 'recordProviderFailure');
    const pending = calls().execute(entry, 'sys', 'prompt');
    await begun;
    controller.abort(new WorkerStop('cancelled'));
    await expect(pending).rejects.toBeInstanceOf(WorkerStop);
    expect(ok).not.toHaveBeenCalled();
    expect(bad).not.toHaveBeenCalled();
  });

  it('opens the circuit after 3 failed calls and buildLadder drops the provider', async () => {
    _setProviderRegistryForTests(registry);
    const models = { getModel: () => undefined };
    const opts = { providers: registry, models, allowPaid: false, freeOnly: false, localModels: 2, freeModels: 0, paidModels: 0 };
    expect((await buildLadder(opts)).map(e => e.provider_id)).toEqual(['brk']);
    run = async () => { throw new Error('connect ECONNREFUSED'); };
    for (let i = 0; i < 3; i += 1) await expect(calls().execute(entry, 'sys', 'prompt')).rejects.toThrow('ECONNREFUSED');
    expect(registry.isAvailable('brk')).toBe(false);
    expect(await buildLadder(opts)).toEqual([]);
  });
});
