import { describe, expect, it } from '@jest/globals';
import { buildLadder } from '../../../dist/modules/patch/ladder/build.js';
import {
  errorSignature, sameSignature, stopReason, nextCursor, pickValidator, computeDeadline, hasBudgetNow,
} from '../../../dist/modules/patch/ladder/policy.js';
import { PaidLedger } from '../../../dist/modules/patch/ladder/paid.js';
import type { LadderEntry, CheckResult } from '../../../src/modules/patch/types.js';

type Price = { prompt: number; completion: number };
function fake(id: string, costClass: 'local' | 'free' | 'paid', models: { id: string; price?: Price }[]): any {
  return {
    id, displayName: id, costClass, isLocal: costClass === 'local',
    isAvailable: async () => true,
    listModels: async () => models.map(m => ({ id: m.id, costPerToken: m.price })),
    getCost: (mid: string) => models.find(m => m.id === mid)?.price ?? { prompt: NaN, completion: NaN },
  };
}
const scores = (m: Record<string, number>): any => ({
  getModel: (id: string) => (id in m ? { capabilities: { scores: { code: m[id] } } } : undefined),
});
const base = { localModels: 2, freeModels: 2, paidModels: 1, allowPaid: false, freeOnly: true };
const free = { prompt: 0, completion: 0 };
const cheap = { prompt: 0.000001, completion: 0.000002 };

describe('buildLadder', () => {
  it('includes llama.cpp router models, ranked by code score, top N, deduped', async () => {
    const llama = fake('llama-cpp', 'local', [{ id: 'r-a' }, { id: 'r-b' }, { id: 'r-c' }]);
    const ollama = fake('ollama', 'local', [{ id: 'r-b' }, { id: 'o-x' }]);
    const l = await buildLadder({
      ...base, providers: { list: () => [llama, ollama] }, models: scores({ 'r-c': 0.9, 'r-a': 0.5, 'o-x': 0.1 }),
    });
    expect(l.map(e => e.model_id)).toEqual(['r-c', 'r-a']);
    expect(l[0].provider_id).toBe('llama-cpp');
    const all = await buildLadder({
      ...base, localModels: 10, providers: { list: () => [llama, ollama] }, models: scores({}),
    });
    expect(all.map(e => e.model_id)).toEqual(['r-a', 'r-b', 'r-c', 'o-x']);
  });

  it('free models are cost 0 only, after local, top N', async () => {
    const or = fake('openrouter', 'paid', [
      { id: 'f1:free', price: free }, { id: 'f2:free', price: free }, { id: 'f3:free', price: free },
      { id: 'p1', price: cheap },
    ]);
    const loc = fake('lm', 'local', [{ id: 'l1' }]);
    const l = await buildLadder({ ...base, providers: { list: () => [or, loc] }, models: scores({ 'f3:free': 1 }) });
    expect(l.map(e => `${e.cost_class}:${e.model_id}`)).toEqual(['local:l1', 'free:f3:free', 'free:f1:free']);
  });

  it('no paid model without allow_paid, or with OPENROUTER_FREE_ONLY on', async () => {
    const or = fake('openrouter', 'paid', [{ id: 'p1', price: cheap }]);
    const mk = (o: object) => buildLadder({ ...base, ...o, providers: { list: () => [or] }, models: scores({}) });
    expect(await mk({ allowPaid: false, freeOnly: false })).toEqual([]);
    expect(await mk({ allowPaid: true, freeOnly: true })).toEqual([]);
    const ok = await mk({ allowPaid: true, freeOnly: false });
    expect(ok).toEqual([{ model_id: 'p1', provider_id: 'openrouter', cost_class: 'paid', prompt_price: 1e-6, completion_price: 2e-6 }]);
  });

  it('unknown price is not on the ladder and never counts as free', async () => {
    const or = fake('openrouter', 'paid', [{ id: 'unk' }]);
    const l = await buildLadder({ ...base, allowPaid: true, freeOnly: false, providers: { list: () => [or] }, models: scores({}) });
    expect(l).toEqual([]);
  });

  it('empty ladder when nothing is available', async () => {
    const down = { ...fake('x', 'local', [{ id: 'a' }]), isAvailable: async () => false };
    expect(await buildLadder({ ...base, providers: { list: () => [down] }, models: scores({}) })).toEqual([]);
  });
});

const chk = (name: string, tail: string, code: number | null = 1): CheckResult =>
  ({ name, exit_code: code, timed_out: false, duration_ms: 1, tail });

describe('attempt policy', () => {
  it('signature is check name + first error line; same signature moves on early', () => {
    const a = errorSignature([chk('tsc', '\nerror TS1: x\nmore')]);
    const b = errorSignature([chk('tsc', 'error TS1: x\nother')]);
    const c = errorSignature([chk('tsc', 'error TS2: y')]);
    expect(a).toBe(b);
    expect(sameSignature(a, b)).toBe(true);
    expect(sameSignature(a, c)).toBe(false);
    expect(sameSignature(null, a)).toBe(false);
    expect(errorSignature([chk('t', '', 0)])).toBeNull();
    expect(nextCursor(0, 1, 3, true)).toEqual({ cursor: 1, attemptsOnModel: 0 });
    expect(nextCursor(0, 1, 3, false)).toEqual({ cursor: 0, attemptsOnModel: 1 });
    expect(nextCursor(0, 3, 3, false)).toEqual({ cursor: 1, attemptsOnModel: 0 });
  });

  it('stop conditions and empty ladder', () => {
    const i = { attemptsUsed: 0, maxAttempts: 12, now: 10, deadlineAt: 100, cursorModel: 0, ladderLength: 2, cancelled: false };
    expect(stopReason(i)).toBeNull();
    expect(stopReason({ ...i, ladderLength: 0 })).toBe('ladder_exhausted');
    expect(stopReason({ ...i, cursorModel: 2 })).toBe('ladder_exhausted');
    expect(stopReason({ ...i, attemptsUsed: 12 })).toBe('budget_attempts');
    expect(stopReason({ ...i, now: 100 })).toBe('budget_time');
    expect(stopReason({ ...i, cancelled: true })).toBe('cancelled');
    expect(computeDeadline(1000, 5000)).toBe(6000);
    expect(computeDeadline(1000, 5000, 2)).toBe(121000);
  });

  it('free provider without rate budget is skipped', () => {
    expect(hasBudgetNow({ hasRateLimitBudget: () => false })).toBe(false);
    expect(hasBudgetNow({})).toBe(true);
  });

  it('validator is the next model of a different family, else the same', () => {
    const e = (m: string): LadderEntry => ({ model_id: m, provider_id: 'p', cost_class: 'local' });
    const lad = [e('qwen-1'), e('qwen-2'), e('llama-3')];
    expect(pickValidator(lad, 0).model_id).toBe('llama-3');
    expect(pickValidator(lad, 2).model_id).toBe('llama-3');
    expect(pickValidator([e('qwen-1'), e('qwen-2')], 0).model_id).toBe('qwen-1');
  });
});

describe('PaidLedger', () => {
  const paid: LadderEntry = { model_id: 'p', provider_id: 'or', cost_class: 'paid', prompt_price: 1e-5, completion_price: 2e-5 };
  const cap = 0.1;

  function run(usage: ((n: number) => { promptTokens?: number; completionTokens?: number } | undefined)) {
    const state = { paid_spent_usd: 0, paid_reserved_usd: 0 };
    const writes: number[] = [];
    const ledger = new PaidLedger(state, cap, 2000, s => writes.push(s.paid_reserved_usd));
    let calls = 0;
    let stopped = false;
    for (let i = 0; i < 50; i++) {
      const r = ledger.reserve(paid, 1000);
      if (!r.ok) { stopped = true; break; }
      expect(state.paid_reserved_usd).toBe(r.amount);
      expect(writes[writes.length - 1]).toBe(r.amount);
      ledger.settle(paid, r.amount, usage(i));
      calls++;
      expect(state.paid_spent_usd).toBeLessThanOrEqual(cap);
      expect(state.paid_reserved_usd).toBe(0);
    }
    return { state, calls, stopped };
  }

  it('reports usage: spent never exceeds the cap and stops with paid_cap', () => {
    const o = run(() => ({ promptTokens: 1000, completionTokens: 500 }));
    expect(o.stopped).toBe(true);
    expect(o.state.paid_spent_usd).toBeLessThanOrEqual(cap);
    expect(o.state.paid_spent_usd).toBeCloseTo(o.calls * 0.02, 10);
  });

  it('no usage: the reservation is charged', () => {
    const o = run(() => undefined);
    expect(o.stopped).toBe(true);
    expect(o.state.paid_spent_usd).toBeCloseTo(o.calls * 0.05, 10);
    expect(o.state.paid_spent_usd).toBeLessThanOrEqual(cap);
  });

  it('usage above the reservation is clamped', () => {
    const o = run(() => ({ promptTokens: 1e6, completionTokens: 1e6 }));
    expect(o.state.paid_spent_usd).toBeLessThanOrEqual(cap);
  });

  it('unknown price is refused, never zero', () => {
    const state = { paid_spent_usd: 0, paid_reserved_usd: 0 };
    const ledger = new PaidLedger(state, cap, 2000);
    const bad = { model_id: 'x', provider_id: 'o', cost_class: 'paid', prompt_price: NaN, completion_price: 0 } as LadderEntry;
    expect(ledger.reserve(bad, 10)).toEqual({ ok: false, reason: 'paid_cap' });
    const notPaid: LadderEntry = { model_id: 'x', provider_id: 'o', cost_class: 'free' };
    expect(ledger.reserve(notPaid, 10).ok).toBe(false);
    expect(state.paid_spent_usd).toBe(0);
  });
});
