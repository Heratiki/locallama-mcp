import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { mkdtemp, mkdir, writeFile, readFile, rm, access } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { PatchState, LadderEntry, CheckSpec } from '../../../src/modules/patch/types.js';
import type { LLMProvider, TaskExecutionOptions } from '../../../src/modules/core/provider/types.js';

const spans: { name: string; attributes: Record<string, unknown> }[] = [];
jest.unstable_mockModule('../../../dist/modules/telemetry/index.js', () => ({
  withSpan: async <T>(name: string, attributes: Record<string, unknown>, run: (span: unknown) => Promise<T>) => {
    const record = { name, attributes: { ...attributes } };
    spans.push(record);
    return run({
      setAttribute: (key: string, value: unknown) => { record.attributes[key] = value; },
      setAttributes: (values: Record<string, unknown>) => Object.assign(record.attributes, values),
    });
  },
}));
jest.unstable_mockModule('../../../dist/utils/logger.js', () => ({ logger: {
  error: jest.fn(), warn: jest.fn(), info: jest.fn(), debug: jest.fn(),
} }));

const { PatchWorker, snapshotPatchWorkspace } = await import('../../../dist/modules/patch/worker/index.js');
const { GitWorkspaceBackend } = await import('../../../dist/modules/patch/workspace/index.js');
const { ProviderRegistry } = await import('../../../dist/modules/core/provider/registry.js');
const store = await import('../../../dist/modules/job-store/index.js');
const { config } = await import('../../../dist/config/index.js');
const exec = promisify(execFile);
let root: string;
let repo: string;
let backend: InstanceType<typeof GitWorkspaceBackend>;
let registry: InstanceType<typeof ProviderRegistry>;
let calls: { model: string; prompt: string; options: TaskExecutionOptions }[];
let state: PatchState;
const local = (model_id = 'qwen-1'): LadderEntry => ({ model_id, provider_id: 'fake', cost_class: 'local' });
const paid: LadderEntry = { model_id: 'paid-1', provider_id: 'paid', cost_class: 'paid', prompt_price: 0.00001, completion_price: 0.00002 };
const block = (value = 2) => `a.ts\n<<<<<<< SEARCH\nexport const value = 1;\n=======\nexport const value = ${value};\n>>>>>>> REPLACE\n`;
const check: CheckSpec = { name: 'unit', argv: [process.execPath, '-e', "const f=require('fs'); if(!f.readFileSync('a.ts','utf8').includes('value = 2')) {console.error('expected value TWO');process.exit(1)}"] };
type Reply = (model: string, prompt: string, options: TaskExecutionOptions) => Promise<{ content: string; promptTokens?: number; completionTokens?: number }>;

function provider(id = 'fake', costClass: 'local' | 'free' | 'paid' = 'local', reply: Reply = async () => ({ content: block() })): LLMProvider {
  return {
    id, displayName: id, costClass, isLocal: costClass === 'local', init: async () => {}, isAvailable: async () => true,
    listModels: async () => ['qwen-1', 'qwen-2', 'llama-1', 'paid-1'].map(id => ({ id, contextWindow: 8192 })),
    supportsModel: () => true, getCost: () => ({ prompt: 0.00001, completion: 0.00002 }),
    executeTask: async (model, prompt, options = {}) => {
      calls.push({ model, prompt, options });
      return { ...await reply(model, prompt, options), model };
    },
  };
}
async function git(...args: string[]) { return (await exec('git', args, { cwd: repo })).stdout.trim(); }
async function submit(options: { ladder?: LadderEntry[]; settings?: object; request?: object; checks?: CheckSpec[]; saved?: Partial<PatchState> } = {}) {
  const base = await snapshotPatchWorkspace(backend, repo, ['a.ts'], 'job');
  const now = Date.now();
  state = {
    job_id: 'job', request_json: JSON.stringify({ goal: 'set value to 2', repo_path: repo, file_hints: ['a.ts'], ...options.request }),
    base_commit: base, checks_json: JSON.stringify(options.checks ?? [check]),
    ladder_json: JSON.stringify(options.ladder ?? [local()]),
    settings_json: JSON.stringify({ patchMaxAttempts: 5, patchAttemptsPerModel: 3, patchMaxOutputTokens: 2000, openRouterFreeOnly: false, ...options.settings }),
    deadline_at: now + 60000, cursor_model: 0, attempts_used: 0, paid_spent_usd: 0, paid_reserved_usd: 0, updated_at: now,
    ...options.saved,
  };
  await store.submitPatchJob({ id: 'task', status: 'queued', job_count: 1, completed_count: 0, failed_count: 0, created_at: now }, {
    id: 'job', task_id: 'task', status: 'queued', provider_id: null, model_id: null, task_text: 'patch', result: null, error: null,
    queue_position: null, is_local: null, progress_pct: 0, poll_again_after_ms: null, retry_count: 0, created_at: now, started_at: null, completed_at: null, kind: 'patch',
  }, state);
  expect(await store.claimPatchJob('job')).toBe(true);
}
async function clean() {
  expect(await git('for-each-ref', '--format=%(refname)', 'refs/locallama/base/')).toBe('');
  expect((await git('worktree', 'list', '--porcelain')).match(/^worktree /gm)).toHaveLength(1);
  await expect(access(path.join(root, 'scratch', 'job'))).rejects.toThrow();
}
const worker = () => new PatchWorker({ backend, registry });

beforeEach(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), 'patch-worker-'));
  repo = path.join(root, 'repo');
  await mkdir(repo);
  await git('init', '-q');
  await git('config', 'user.name', 'Test');
  await git('config', 'user.email', 'test@example.com');
  await writeFile(path.join(repo, 'a.ts'), 'export const value = 1;\n');
  await git('add', 'a.ts');
  await git('commit', '-qm', 'base');
  process.env.JOB_DB_PATH = path.join(root, 'jobs.db');
  await store.initJobStore();
  backend = new GitWorkspaceBackend(repo, { rootDir: root });
  registry = new ProviderRegistry();
  calls = [];
  spans.length = 0;
  registry.register(provider());
});
afterEach(async () => {
  await store.closeJobStore();
  delete process.env.JOB_DB_PATH;
  await rm(root, { recursive: true, force: true });
});

describe('patch worker', () => {
  it('returns an applicable diff including a new file, persists telemetry, and removes workspace/ref', async () => {
    registry.register(provider('fake', 'local', async () => ({ content: block() + 'new.ts\n<<<<<<< SEARCH\n=======\nexport const added = true;\n>>>>>>> REPLACE\n' })));
    const scheduled = jest.spyOn(registry, 'executeWithConcurrencyLimit');
    await submit();
    const result = await worker().run('job');
    expect(result).toMatchObject({ schema: 'patch_result_v1', status: 'passed', reason: 'passed', attempts: 1, diagnosis: null, cost_usd: 0 });
    expect(result.files_changed.sort()).toEqual(['a.ts', 'new.ts']);
    expect(result.tokens.local).toBeGreaterThan(0);
    expect(spans.map(s => s.name)).toEqual(expect.arrayContaining(['patch.snapshot', 'patch.worktree.create', 'patch.attempt', 'patch.check', 'patch.diff']));
    expect(spans.find(s => s.name === 'patch.task')!.attributes).toMatchObject({ 'patch.outcome': 'passed', 'patch.attempts': 1, 'patch.cost_usd': 0 });
    expect(scheduled).toHaveBeenCalledTimes(1);
    expect(calls[0].options).toMatchObject({ maxTokens: 2000, timeoutMs: 900000, signal: expect.any(AbortSignal) });
    expect(calls[0].options.systemPrompt).toContain('SEARCH');
    expect((await store.getPatchAttempts('job'))[0]).toMatchObject({ n: 1, outcome: 'passed' });
    expect(JSON.parse((await store.getJob('job'))!.result!)).toEqual(result);
    await clean();
    expect(await readFile(path.join(repo, 'a.ts'), 'utf8')).toBe('export const value = 1;\n');
    const diffPath = path.join(root, 'result.diff');
    await writeFile(diffPath, result.diff);
    await git('apply', diffPath);
    expect(await readFile(path.join(repo, 'a.ts'), 'utf8')).toContain('value = 2');
    expect(await readFile(path.join(repo, 'new.ts'), 'utf8')).toContain('added = true');
  });

  it('persists attempts before execution and feeds only the last failure and blocks back against base', async () => {
    registry.register(provider('fake', 'local', async () => {
      const s = await store.getPatchState('job');
      expect(s!.attempts_used).toBe(calls.length);
      return { content: block(calls.length === 1 ? 3 : 2) };
    }));
    await submit();
    const result = await worker().run('job');
    expect(result.status).toBe('passed');
    expect(result.attempts).toBe(2);
    expect(calls[1].prompt).toContain('expected value TWO');
    expect(calls[1].prompt).toContain('value = 3');
    expect(calls[1].prompt).toContain('export const value = 1');
    await clean();
  });

  it('moves to the next model early on a repeated check signature', async () => {
    registry.register(provider('fake', 'local', async model => ({ content: block(model === 'llama-1' ? 2 : 3) })));
    await submit({ ladder: [local(), local('llama-1')] });
    expect((await worker().run('job')).status).toBe('passed');
    expect(calls.map(c => c.model)).toEqual(['qwen-1', 'qwen-1', 'llama-1']);
  });

  it.each([
    ['budget_attempts', { patchMaxAttempts: 1 }, [local()]],
    ['ladder_exhausted', { patchAttemptsPerModel: 1 }, [local()]],
  ])('stops with %s and the best diff on check failure', async (reason, settings, ladder) => {
    registry.register(provider('fake', 'local', async () => ({ content: block(3) })));
    await submit({ settings, ladder });
    const result = await worker().run('job');
    expect(result.reason).toBe(reason);
    expect(result.diff).toBe('');
    expect(result.diagnosis!.best_diff).toContain('value = 3');
    expect(result.diagnosis!.last_errors).toContain('expected value TWO');
    expect(result.diagnosis!.attempts[0].outcome).toBe('check_failed');
    expect((await store.getJob('job'))!.status).toBe('failed');
    await clean();
  });

  it('forwards parse and apply errors to the next prompt', async () => {
    registry.register(provider('fake', 'local', async () => ({ content: calls.length === 1 ? 'bad output' : calls.length === 2 ? block().replace('value = 1', 'value = 99') : block() })));
    await submit();
    expect((await worker().run('job')).status).toBe('passed');
    expect(calls[1].prompt).toContain('No edit blocks');
    expect(calls[2].prompt).toContain('SEARCH text not found');
  });

  it('passes PATCH_WHOLE_FILE_MAX_LINES from config to the applier', async () => {
    const old = config.patchWholeFileMaxLines;
    config.patchWholeFileMaxLines = 1;
    try {
      registry.register(provider('fake', 'local', async () => ({ content: 'a.ts\n```ts\nexport const value = 2;\n```\n' })));
      await submit({ settings: { patchMaxAttempts: 1 } });
      const result = await worker().run('job');
      expect(result.diagnosis!.last_errors).toContain('whole-file output refused');
      expect(result.diagnosis!.attempts[0].outcome).toBe('apply_error');
    } finally { config.patchWholeFileMaxLines = old; }
  });

  it('uses BM25 from the snapshot for unhinted files', async () => {
    await writeFile(path.join(repo, 'helper.ts'), 'export function specialHelper() { return 42; }\n');
    await git('add', 'helper.ts');
    await git('commit', '-qm', 'helper');
    await submit({ request: { goal: 'specialHelper', file_hints: [] } });
    await worker().run('job');
    expect(calls[0].prompt).toContain('specialHelper()');
    expect(calls[0].prompt).toContain('## Related: helper.ts');
  });

  it('skips free models with no rate budget and forbids paid calls without opt-in', async () => {
    registry.register({ ...provider('free', 'free'), hasRateLimitBudget: () => false });
    registry.register(provider('paid', 'paid'));
    await submit({ ladder: [{ model_id: 'free', provider_id: 'free', cost_class: 'free' }, paid] });
    expect((await worker().run('job')).reason).toBe('ladder_exhausted');
    expect(calls).toHaveLength(0);
    await clean();
  });

  it.each([true, false])('keeps paid spend within cap (usage=%s), reserving before the call', async usage => {
    registry.register(provider('paid', 'paid', async () => {
      expect((await store.getPatchState('job'))!.paid_reserved_usd).toBeGreaterThan(0);
      return { content: block(3), ...(usage ? { promptTokens: 100, completionTokens: 1000 } : {}) };
    }));
    await submit({ ladder: [paid], request: { allow_paid: true, paid_cap_usd: 0.048 }, settings: { patchPaidCapUsd: 0.048 } });
    const result = await worker().run('job');
    expect(result.reason).toBe('paid_cap');
    expect(result.cost_usd).toBeGreaterThan(0);
    expect(result.cost_usd).toBeLessThanOrEqual(0.048);
    expect((await store.getPatchState('job'))!.paid_reserved_usd).toBe(0);
    await clean();
  });

  it('refuses a paid reservation that would exceed cap without using an attempt', async () => {
    registry.register(provider('paid', 'paid'));
    await submit({ ladder: [paid], request: { allow_paid: true, paid_cap_usd: 0.00001 } });
    const result = await worker().run('job');
    expect(result.reason).toBe('paid_cap');
    expect(result.attempts).toBe(0);
    expect(calls).toHaveLength(0);
  });

  it.each([
    ['YES\nLooks correct', true, false],
    ['uncertain', null, true],
    ['', null, true],
  ])('records validator verdict %j after checks', async (verdict, passed, skipped) => {
    registry.register(provider('fake', 'local', async model => ({ content: model === 'llama-1' ? verdict : block() })));
    await submit({ ladder: [local(), local('llama-1')], request: { validate: true } });
    const result = await worker().run('job');
    expect(result.status).toBe('passed');
    expect(calls.map(c => c.model)).toEqual(['qwen-1', 'llama-1']);
    expect(calls[1].prompt).toContain('diff --git');
    expect(result.validation[0]).toMatchObject({ passed, skipped, model_id: 'llama-1' });
    expect(JSON.parse((await store.getPatchAttempts('job'))[0].edit_blocks!).validation).toMatchObject({ passed, skipped });
  });

  it('validator rejection becomes the next attempt error', async () => {
    registry.register(provider('fake', 'local', async (_m, prompt) => ({ content: prompt.includes('Answer only YES or NO') ? (calls.length === 2 ? 'NO\nmissing edge case' : 'YES') : block() })));
    await submit({ request: { validate: true } });
    expect((await worker().run('job')).status).toBe('passed');
    expect(calls[2].prompt).toContain('missing edge case');
    expect((await store.getPatchAttempts('job'))[0].outcome).toBe('validator_rejected');
  });

  it('validator calls share the paid ledger and stop on paid_cap', async () => {
    registry.register(provider('paid', 'paid'));
    await submit({ ladder: [paid], request: { allow_paid: true, paid_cap_usd: 0.06, validate: true } });
    expect((await worker().run('job')).reason).toBe('paid_cap');
    expect(calls).toHaveLength(1);
    expect((await store.getPatchState('job'))!.paid_reserved_usd).toBe(0);
  });

  it('recovers from an interrupted call using the stored cursor, base, count and deadline', async () => {
    await submit({ ladder: [local(), local('llama-1')], settings: { patchAttemptsPerModel: 1 }, saved: { cursor_model: 1, attempts_used: 1 } });
    await writeFile(path.join(repo, 'a.ts'), 'source changed after submit\n');
    const before = (await store.getPatchState('job'))!;
    // The consumed interrupted attempt belongs to the persisted current model.
    const result = await worker().run('job');
    expect(result.reason).toBe('ladder_exhausted');
    expect(result.base).toBe(before.base_commit);
    expect(result.attempts).toBe(1);
    expect(calls).toHaveLength(0);
    expect((await store.getPatchState('job'))!.deadline_at).toBe(before.deadline_at);
    expect((await store.getPatchAttempts('job'))[0].outcome).toBe('call_error');
    await clean();
  });

  it('resumes a partially used model on the original snapshot, never snapshots the changed repo', async () => {
    await submit({ saved: { attempts_used: 1 } });
    await writeFile(path.join(repo, 'a.ts'), 'changed source\n');
    const snapshot = jest.spyOn(backend, 'snapshot');
    const result = await worker().run('job');
    expect(result.status).toBe('passed');
    expect(result.attempts).toBe(2);
    expect(calls[0].prompt).toContain('export const value = 1');
    expect(snapshot).not.toHaveBeenCalled();
    expect(await readFile(path.join(repo, 'a.ts'), 'utf8')).toBe('changed source\n');
    await clean();
  });

  it('ends immediately on expired deadline and cleans an existing recovery workspace', async () => {
    await submit({ saved: { deadline_at: Date.now() - 10 } });
    await backend.create(state.base_commit, 'job');
    expect((await worker().run('job')).reason).toBe('budget_time');
    expect(calls).toHaveLength(0);
    await clean();
  });

  it('charges a recovered reservation conservatively before reserving more', async () => {
    registry.register(provider('paid', 'paid'));
    await submit({ ladder: [paid], request: { allow_paid: true, paid_cap_usd: 0.06 }, saved: { paid_reserved_usd: 0.05, attempts_used: 1 } });
    const result = await worker().run('job');
    expect(result.reason).toBe('paid_cap');
    expect(result.cost_usd).toBeCloseTo(0.05);
    expect(calls).toHaveLength(0);
  });

  it('times out inference and passes an abort signal to the provider', async () => {
    registry.register(provider('fake', 'local', async (_m, _p, options) => new Promise((_resolve, reject) => {
      options.signal!.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
    })));
    await submit({ settings: { patchInferenceTimeoutMs: 30, patchMaxAttempts: 1 } });
    const result = await worker().run('job');
    expect(result.reason).toBe('budget_attempts');
    expect(result.diagnosis!.attempts[0].outcome).toBe('timed_out');
    expect(calls[0].options.signal!.aborted).toBe(true);
    await clean();
  });

  it('deadline aborts an active model call with budget_time', async () => {
    registry.register(provider('fake', 'local', async () => new Promise(() => {})));
    await submit({ saved: { deadline_at: Date.now() + 250 } });
    expect((await worker().run('job')).reason).toBe('budget_time');
    expect(calls[0].options.signal!.aborted).toBe(true);
    await clean();
  });

  it('cancel discards an unabortable model result and cannot overwrite the cancelled row', async () => {
    let entered!: () => void;
    const ready = new Promise<void>(resolve => { entered = resolve; });
    let finish!: (r: { content: string }) => void;
    registry.register(provider('fake', 'local', async () => { entered(); return new Promise(resolve => { finish = resolve; }); }));
    await submit();
    const w = worker();
    const running = w.run('job');
    await ready;
    await store.cancelJobsForTask('task');
    expect(w.cancel('job')).toBe(true);
    const result = await running;
    expect(result.status).toBe('cancelled');
    finish({ content: block() });
    expect((await store.getJob('job'))!.status).toBe('cancelled');
    expect(await store.finishPatchJob('job', { status: 'completed', result: 'late' })).toBe(false);
    await clean();
  });

  it('cancel waits for the check process group to exit before workspace disposal', async () => {
    const pidFile = path.join(root, 'pid');
    await submit({ checks: [{ name: 'long', argv: [process.execPath, '-e', `require('fs').writeFileSync(${JSON.stringify(pidFile)}, String(process.pid)); setInterval(()=>{}, 1000);`] }] });
    const dispose = jest.spyOn(backend, 'dispose').mockImplementation(async ws => {
      const pid = Number(await readFile(pidFile, 'utf8'));
      expect(() => process.kill(-pid, 0)).toThrow();
      await GitWorkspaceBackend.prototype.dispose.call(backend, ws);
    });
    const w = worker();
    const running = w.run('job');
    for (let i = 0; i < 200; i++) {
      try { await access(pidFile); break; } catch { await new Promise(resolve => setTimeout(resolve, 10)); }
    }
    await access(pidFile);
    w.cancel('job');
    const result = await running;
    expect(result.reason).toBe('cancelled');
    expect((await store.getJob('job'))!.status).toBe('cancelled');
    expect(dispose).toHaveBeenCalledTimes(1);
    await clean();
  });

  it('keeps a failed workspace when configured', async () => {
    registry.register(provider('fake', 'local', async () => ({ content: block(3) })));
    await submit({ settings: { patchKeepWorkspaceOnFail: true, patchMaxAttempts: 1 } });
    expect((await worker().run('job')).status).toBe('failed');
    await access(path.join(root, 'scratch', 'job'));
    expect(await git('for-each-ref', '--format=%(refname)', 'refs/locallama/base/')).toContain('/job');
  });

  it('uses all attempts on a model before advancing when failures differ', async () => {
    registry.register(provider('fake', 'local', async model => ({ content: block(model === 'llama-1' ? 2 : calls.length + 3) })));
    await submit({ ladder: [local(), local('llama-1')], checks: [{ name: 'different', argv: [process.execPath, '-e', "const v=require('fs').readFileSync('a.ts','utf8'); if(!v.includes('value = 2')) {console.error(v);process.exit(1)}"] }] });
    expect((await worker().run('job')).status).toBe('passed');
    expect(calls.map(c => c.model)).toEqual(['qwen-1', 'qwen-1', 'qwen-1', 'llama-1']);
  });

  it('diagnoses the diff with most checks passed, rather than the last diff', async () => {
    registry.register(provider('fake', 'local', async () => ({ content: block(calls.length + 2) })));
    await submit({ settings: { patchMaxAttempts: 2 }, checks: [
      { name: 'first', argv: [process.execPath, '-e', "if(!require('fs').readFileSync('a.ts','utf8').includes('value = 3')) {console.error('first failed');process.exit(1)}"] },
      check,
    ] });
    const result = await worker().run('job');
    expect(result.diagnosis!.best_diff).toContain('+export const value = 3');
    expect(result.diagnosis!.best_diff).not.toContain('+export const value = 4');
    expect(result.diagnosis!.last_errors).toContain('first failed');
    expect(result.checks).toHaveLength(1);
    await clean();
  });

  it('reports provider errors and moves on without automatic Job retries', async () => {
    registry.register(provider('fake', 'local', async () => { throw new Error('provider unavailable'); }));
    await submit({ settings: { patchMaxAttempts: 1 } });
    const result = await worker().run('job');
    expect(result.diagnosis!.attempts[0].outcome).toBe('call_error');
    expect(result.diagnosis!.last_errors).toContain('provider unavailable');
    expect((await store.getJob('job'))!.retry_count).toBe(0);
    await clean();
  });

  it('guards the context window including the output allowance before calling a model', async () => {
    registry.register({ ...provider(), listModels: async () => [{ id: 'qwen-1', contextWindow: 32 }] });
    await submit({ settings: { patchMaxAttempts: 1 } });
    const result = await worker().run('job');
    expect(result.reason).toBe('budget_attempts');
    expect(result.diagnosis!.last_errors).toContain('context window');
    expect(calls).toHaveLength(0);
    expect(result.attempts).toBe(1);
    expect(result.models).toEqual([{ model_id: 'qwen-1', provider_id: 'fake', cost_class: 'local', attempts: 1 }]);
  });

  it('records a timed-out check and never runs subsequent checks or validator', async () => {
    await submit({ settings: { patchMaxAttempts: 1 }, request: { validate: true }, checks: [
      { name: 'timeout', argv: [process.execPath, '-e', 'setInterval(()=>{}, 1000)'], timeout_ms: 50 },
      { name: 'never', argv: [process.execPath, '-e', 'process.exit(0)'] },
    ] });
    const result = await worker().run('job');
    expect(result.checks).toHaveLength(1);
    expect(result.checks[0].timed_out).toBe(true);
    expect(result.diagnosis!.attempts[0].outcome).toBe('timed_out');
    expect(calls).toHaveLength(1);
    await clean();
  });

  it('skips an unavailable validator and keeps the checked result', async () => {
    await submit({ request: { validate: true }, ladder: [local(), { model_id: 'llama-1', provider_id: 'missing', cost_class: 'free' }] });
    const result = await worker().run('job');
    expect(result.status).toBe('passed');
    expect(result.validation[0]).toMatchObject({ passed: null, skipped: true });
    expect(calls).toHaveLength(1);
  });

  it('skips a free validator without rate budget and never falls back to paid without opt-in', async () => {
    registry.register({ ...provider('free', 'free'), hasRateLimitBudget: () => false });
    await submit({ request: { validate: true }, ladder: [local(), { model_id: 'llama-1', provider_id: 'free', cost_class: 'free' }, paid] });
    const result = await worker().run('job');
    expect(result.status).toBe('passed');
    expect(result.validation[0]).toMatchObject({ skipped: true, reason: 'Validator has no rate budget' });
    expect(calls).toHaveLength(1);
  });

  it('respects OPENROUTER_FREE_ONLY even with paid opt-in', async () => {
    registry.register(provider('paid', 'paid'));
    await submit({ request: { allow_paid: true }, ladder: [paid], settings: { openRouterFreeOnly: true } });
    expect((await worker().run('job')).reason).toBe('ladder_exhausted');
    expect(calls).toHaveLength(0);
  });

  it('restores failure feedback and usage from the database after closing and reopening it', async () => {
    await submit();
    await store.recordAttemptStart('job', { cursor_model: 0, attempts_used: 1 });
    await store.insertPatchAttempt({ job_id: 'job', n: 1, model_id: 'qwen-1', provider_id: 'fake', cost_class: 'local',
      prompt_tokens: 17, completion_tokens: 9, cost_usd: 0, edit_blocks: JSON.stringify([{ path: 'a.ts', search: 'export const value = 1;\n', replace: 'export const value = 3;\n' }]),
      outcome: 'check_failed', apply_error: 'restored error', checks_json: JSON.stringify([{ name: 'unit', exit_code: 1, timed_out: false, duration_ms: 1, tail: 'restored tail' }]),
      duration_ms: 2, started_at: 1, ended_at: 3 });
    await store.closeJobStore();
    await store.initJobStore();
    const result = await worker().run('job');
    expect(result.status).toBe('passed');
    expect(result.attempts).toBe(2);
    expect(result.tokens.local).toBeGreaterThan(26);
    expect(calls[0].prompt).toContain('restored tail');
    expect(calls[0].prompt).toContain('restored error');
    expect(calls[0].prompt).toContain('value = 3');
    expect((await store.getPatchState('job'))!.deadline_at).toBe(state.deadline_at);
    await clean();
  });

  it('cancels a queued registry call before it can execute or spend its reservation', async () => {
    const p = provider('paid', 'paid');
    registry.register(p);
    let unblock!: () => void;
    const blocker = registry.executeWithConcurrencyLimit(p, () => new Promise<void>(resolve => { unblock = resolve; }));
    await submit({ request: { allow_paid: true }, ladder: [paid] });
    const w = worker();
    const running = w.run('job');
    for (let i = 0; i < 200; i++) {
      if ((await store.getPatchState('job'))!.attempts_used === 1) break;
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    expect((await store.getPatchState('job'))!.attempts_used).toBe(1);
    expect((await store.getPatchState('job'))!.paid_reserved_usd).toBeGreaterThan(0);
    w.cancel('job');
    expect((await running).reason).toBe('cancelled');
    unblock();
    await blocker;
    await new Promise(resolve => setImmediate(resolve));
    expect(calls).toHaveLength(0);
    expect((await store.getPatchState('job'))).toMatchObject({ paid_spent_usd: 0, paid_reserved_usd: 0 });
    await clean();
  });

  it('deadline kills an active check and leaves no worktree or base ref', async () => {
    const pidFile = path.join(root, 'deadline-pid');
    await submit({ saved: { deadline_at: Date.now() + 750 }, checks: [{ name: 'deadline', argv: [process.execPath, '-e', `require('fs').writeFileSync(${JSON.stringify(pidFile)}, String(process.pid)); setInterval(()=>{}, 1000);`] }] });
    const result = await worker().run('job');
    const pid = Number(await readFile(pidFile, 'utf8'));
    expect(result.reason).toBe('budget_time');
    expect(() => process.kill(-pid, 0)).toThrow();
    await clean();
  });

  it('handles a cancelled row before run without invoking any model', async () => {
    await submit();
    await store.cancelJobsForTask('task');
    const result = await worker().run('job');
    expect(result.reason).toBe('cancelled');
    expect(calls).toHaveLength(0);
    await clean();
  });

  it('completes a durable passed attempt after restart without using another attempt', async () => {
    await submit();
    const ws = await backend.create(state.base_commit, 'job');
    await writeFile(path.join(ws.path, 'a.ts'), 'export const value = 2;\n');
    const diff = await backend.diff(ws);
    await store.recordAttemptStart('job', { cursor_model: 0, attempts_used: 1 });
    await store.insertPatchAttempt({ job_id: 'job', n: 1, model_id: 'qwen-1', provider_id: 'fake', cost_class: 'local',
      prompt_tokens: 10, completion_tokens: 20, cost_usd: 0,
      edit_blocks: JSON.stringify({ blocks: [], calls: [], files: ['a.ts'], diff }), outcome: 'passed', apply_error: null,
      checks_json: JSON.stringify([{ name: 'unit', exit_code: 0, timed_out: false, duration_ms: 1, tail: '' }]),
      duration_ms: 1, started_at: 1, ended_at: 2 });
    const result = await worker().run('job');
    expect(result.status).toBe('passed');
    expect(result.diff).toBe(diff);
    expect(result.attempts).toBe(1);
    expect(result.tokens.local).toBe(30);
    expect(calls).toHaveLength(0);
    await clean();
  });

  it('does not start a different provider while a timed-out call is still running', async () => {
    let active = false;
    let finished = false;
    registry.register(provider('fake', 'local', async () => {
      active = true;
      await new Promise(resolve => setTimeout(resolve, 100));
      active = false;
      finished = true;
      return { content: block() };
    }));
    registry.register(provider('free', 'free', async () => {
      expect(finished).toBe(true);
      expect(active).toBe(false);
      return { content: block() };
    }));
    await submit({ ladder: [local(), { model_id: 'llama-1', provider_id: 'free', cost_class: 'free' }], settings: { patchInferenceTimeoutMs: 30, patchAttemptsPerModel: 1 } });
    const result = await worker().run('job');
    expect(result.status).toBe('passed');
    expect(calls.map(c => c.model)).toEqual(['qwen-1', 'llama-1']);
    expect((await store.getPatchAttempts('job'))[0].outcome).toBe('timed_out');
    expect(result.tokens.free).toBeGreaterThan(0);
    await clean();
  });

  it('cancels promptly while provider discovery is pending', async () => {
    let discover!: () => void;
    const discovering = new Promise<void>(resolve => { discover = resolve; });
    registry.register({ ...provider(), listModels: async () => { discover(); return new Promise(() => {}); } });
    await submit();
    const w = worker();
    const running = w.run('job');
    await discovering;
    w.cancel('job');
    expect((await running).reason).toBe('cancelled');
    expect(calls).toHaveLength(0);
    await clean();
  });

  it('passes the resolved check env allow-list and changed files without mutating the snapshot context', async () => {
    await mkdir(path.join(repo, '.locallama'));
    await writeFile(path.join(repo, '.locallama', 'checks.json'), JSON.stringify({ checks: [check], links: [], env_allow: ['PATCH_WORKER_ALLOWED'] }));
    await git('add', '.locallama/checks.json');
    await git('commit', '-qm', 'checks');
    process.env.PATCH_WORKER_ALLOWED = 'allowed';
    try {
      await submit({ checks: [{ name: 'args-env', append_changed_files: true, argv: [process.execPath, '-e', "if(process.env.PATCH_WORKER_ALLOWED !== 'allowed' || process.argv[1] !== 'a.ts') process.exit(1)"] }] });
      expect((await worker().run('job')).status).toBe('passed');
      await clean();
    } finally { delete process.env.PATCH_WORKER_ALLOWED; }
  });

  it('cancel kills check descendants before removing the workspace', async () => {
    const leaderFile = path.join(root, 'leader');
    const childFile = path.join(root, 'child');
    const childCode = `require('fs').writeFileSync(${JSON.stringify(childFile)}, String(process.pid)); setInterval(()=>{}, 1000);`;
    await submit({ checks: [{ name: 'group', argv: [process.execPath, '-e', `
      const child = require('child_process').spawn(process.execPath, ['-e', ${JSON.stringify(childCode)}], {stdio:'ignore'});
      const timer = setInterval(()=>{}, 1000);
      // Keep the leader alive long enough to reap its child after group TERM.
      process.on('SIGTERM', () => { child.once('exit', () => { clearInterval(timer); process.exit(0); }); });
      require('fs').writeFileSync(${JSON.stringify(leaderFile)}, String(process.pid));
    `] }] });
    const w = worker();
    const running = w.run('job');
    try {
      for (let i = 0; i < 200; i++) {
        try { await access(childFile); break; } catch { await new Promise(resolve => setTimeout(resolve, 10)); }
      }
      const leader = Number(await readFile(leaderFile, 'utf8'));
      const child = Number(await readFile(childFile, 'utf8'));
      const dispose = jest.spyOn(backend, 'dispose').mockImplementation(async ws => {
        expect(() => process.kill(-leader, 0)).toThrow();
        expect(() => process.kill(child, 0)).toThrow();
        await GitWorkspaceBackend.prototype.dispose.call(backend, ws);
      });
      w.cancel('job');
      expect((await running).status).toBe('cancelled');
      expect(dispose).toHaveBeenCalledTimes(1);
      await clean();
    } finally { w.cancel('job'); await running; }
  });
});
