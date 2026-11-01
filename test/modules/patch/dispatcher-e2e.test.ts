import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { LLMProvider, TaskExecutionOptions } from '../../../src/modules/core/provider/types.js';

// Submit -> dispatcher -> real PatchWorker -> terminal row, on a temp git repo
// with a fake provider. No server, no real model.
jest.unstable_mockModule('../../../dist/utils/logger.js', () => ({
  logger: { error: jest.fn(), warn: jest.fn(), info: jest.fn(), debug: jest.fn() },
}));

const store = await import('../../../dist/modules/job-store/index.js');
const { PatchDispatcher, submitPatchTask } = await import('../../../dist/modules/patch/dispatcher/index.js');
const { PatchWorker } = await import('../../../dist/modules/patch/worker/index.js');
const { GitWorkspaceBackend } = await import('../../../dist/modules/patch/workspace/index.js');
const { ProviderRegistry } = await import('../../../dist/modules/core/provider/registry.js');
const { config } = await import('../../../dist/config/index.js');

const exec = promisify(execFile);
let root: string;
let repo: string;
let registry: InstanceType<typeof ProviderRegistry>;
let calls: number;

const git = async (...args: string[]) => (await exec('git', args, {
  cwd: repo, env: { ...process.env, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: path.join(root, 'empty-gitconfig'), GIT_TERMINAL_PROMPT: '0' },
})).stdout.trim();

const block = `a.ts\n<<<<<<< SEARCH\nexport const value = 1;\n=======\nexport const value = 2;\n>>>>>>> REPLACE\n`;
const checks = [{ name: 'unit', argv: [process.execPath, '-e',
  "if(!require('fs').readFileSync('a.ts','utf8').includes('value = 2')){console.error('expected 2');process.exit(1)}"] }];

type Reply = (options: TaskExecutionOptions) => Promise<{ content: string }>;
function provider(reply: Reply): LLMProvider {
  return {
    id: 'fake', displayName: 'fake', costClass: 'local', isLocal: true, init: async () => {}, isAvailable: async () => true,
    listModels: async () => [{ id: 'coder-1', contextWindow: 8192 }],
    supportsModel: () => true, getCost: () => ({ prompt: 0, completion: 0 }),
    executeTask: async (model, _prompt, options = {}) => { calls++; return { ...await reply(options), model }; },
  };
}

function rig() {
  const options = { rootDir: root, scratchDir: path.join(root, 'scratch') };
  const dispatcher = new PatchDispatcher({
    maxConcurrent: 1,
    createBackend: r => new GitWorkspaceBackend(r, options),
    createWorker: r => new PatchWorker({ backend: new GitWorkspaceBackend(r, options), registry }),
  });
  const deps = {
    config: { ...config, patchTasksEnabled: true, patchRepoRoots: [root], ...options, patchMaxAttempts: 4, patchAttemptsPerModel: 3 },
    providers: registry,
    models: { getModel: () => undefined },
    dispatcher,
    createBackend: (r: string) => new GitWorkspaceBackend(r, options),
  };
  return { dispatcher, deps };
}

const clean = async () => {
  expect(await git('for-each-ref', '--format=%(refname)', 'refs/locallama/base/')).toBe('');
  expect((await git('worktree', 'list', '--porcelain')).match(/^worktree /gm)).toHaveLength(1);
};

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'locallama-dispatch-e2e-'));
  await writeFile(path.join(root, 'empty-gitconfig'), '');
  repo = path.join(root, 'repo');
  await mkdir(repo);
  await git('init', '-q', '-b', 'main');
  await git('config', 'user.name', 'E2E');
  await git('config', 'user.email', 'e2e@example.invalid');
  await writeFile(path.join(repo, 'a.ts'), 'export const value = 1;\n');
  await git('add', 'a.ts');
  await git('commit', '-qm', 'base');
  process.env.JOB_DB_PATH = path.join(root, 'jobs.db');
  await store.initJobStore();
  registry = new ProviderRegistry();
  calls = 0;
});

afterEach(async () => {
  await store.closeJobStore();
  delete process.env.JOB_DB_PATH;
  await rm(root, { recursive: true, force: true });
});

describe('patch_task end to end through the dispatcher', () => {
  it('AC9: a submitted task runs to a passing patch_result_v1 whose diff applies with git apply', async () => {
    registry.register(provider(async () => ({ content: block })));
    const { dispatcher, deps } = rig();
    const out = await submitPatchTask({ goal: 'set value to 2', repo_path: repo, checks, file_hints: ['a.ts'] }, deps);
    await dispatcher.idle();
    const job = await store.getJob(out.job_id);
    expect(job?.status).toBe('completed');
    const result = JSON.parse(job!.result!);
    expect(result).toMatchObject({ schema: 'patch_result_v1', status: 'passed', reason: 'passed', files_changed: ['a.ts'], attempts: 1 });
    await clean();
    const patch = path.join(root, 'out.patch');
    await writeFile(patch, result.diff);
    await git('apply', '--check', patch);
  });

  it('AC6: cancel on a running patch Job aborts the worker and the Job ends cancelled', async () => {
    let entered!: () => void;
    const inCall = new Promise<void>(r => { entered = r; });
    registry.register(provider(options => new Promise((_resolve, reject) => {
      entered();
      options.signal!.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
    })));
    const { dispatcher, deps } = rig();
    const out = await submitPatchTask({ goal: 'g', repo_path: repo, checks }, deps);
    await inCall;
    expect((await store.getJob(out.job_id))?.status).toBe('in_progress');
    await store.cancelJobsForTask(out.task_id);
    expect(dispatcher.cancel(out.job_id)).toBe(true);
    await dispatcher.idle();
    expect((await store.getJob(out.job_id))?.status).toBe('cancelled');
    await clean();
  });

  it('AC5: after a restart mid-task the Job resumes from the stored base, cursor and attempt count; the deadline does not move', async () => {
    registry.register(provider(async () => ({ content: block })));
    const first = rig();
    // Block the first dispatcher so the Job is only claimed, as when the process died mid-call.
    const out = await submitPatchTask({ goal: 'g', repo_path: repo, checks }, {
      ...first.deps,
      dispatcher: { kick: () => {}, submitting: first.dispatcher.submitting, cleanupRepo: (r: string) => first.dispatcher.cleanupRepo(r) },
    });
    expect((await store.claimNextPatchJob())?.id).toBe(out.job_id);
    await store.recordAttemptStart(out.job_id, { cursor_model: 0, attempts_used: 1 });
    const before = await store.getPatchState(out.job_id);
    // Change the live repo: the resumed Job must use the snapshot, not this.
    await writeFile(path.join(repo, 'a.ts'), 'export const value = 7;\n');

    const restarted = rig();
    const summary = await restarted.dispatcher.start();
    await restarted.dispatcher.idle();
    expect(summary.requeued).toBe(1);
    const job = await store.getJob(out.job_id);
    expect(job?.status).toBe('completed');
    const result = JSON.parse(job!.result!);
    expect(result.base).toBe(before!.base_commit);
    expect(result.attempts).toBe(2);
    expect(calls).toBe(1);
    const after = await store.getPatchState(out.job_id);
    expect(after!.deadline_at).toBe(before!.deadline_at);
    expect(after!.base_commit).toBe(before!.base_commit);
    await clean();
  });
});
