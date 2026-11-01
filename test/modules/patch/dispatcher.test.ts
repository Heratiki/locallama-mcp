import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, mkdir, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

jest.unstable_mockModule('../../../dist/config/index.js', () => ({
  config: { rootDir: tmpdir(), cacheDir: tmpdir(), patchMaxConcurrent: 1, patchTasksEnabled: true, patchRepoRoots: [] },
}));
jest.unstable_mockModule('../../../dist/utils/logger.js', () => ({
  logger: { error: jest.fn(), warn: jest.fn(), info: jest.fn(), debug: jest.fn() },
}));

const db = await import('../../../dist/modules/job-store/db.js');
const store = await import('../../../dist/modules/job-store/patch-store.js');
const { PatchDispatcher } = await import('../../../dist/modules/patch/dispatcher/index.js');
const { GitWorkspaceBackend } = await import('../../../dist/modules/patch/workspace/index.js');

const exec = promisify(execFile);
const git = async (cwd: string, ...args: string[]) => (await exec('git', args, {
  cwd, env: { ...process.env, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: path.join(root, 'empty-gitconfig'), GIT_TERMINAL_PROMPT: '0' },
})).stdout;

let root: string;

const deferred = () => {
  let resolve!: () => void;
  const promise = new Promise<void>(r => { resolve = r; });
  return { promise, resolve };
};

const makeState = (jobId: string, repo: string, over: Record<string, unknown> = {}) => ({
  job_id: jobId,
  request_json: JSON.stringify({ goal: 'g', repo_path: repo }),
  base_commit: 'abc123',
  checks_json: '[]',
  ladder_json: '[]',
  settings_json: '{}',
  deadline_at: 9_999_999,
  cursor_model: 0,
  attempts_used: 0,
  paid_spent_usd: 0,
  paid_reserved_usd: 0,
  updated_at: 1,
  ...over,
});

async function submit(id: string, createdAt: number, repo = '/repo', state: Record<string, unknown> = {}) {
  await store.submitPatchJob(
    { id: `task-${id}`, status: 'queued', job_count: 1, completed_count: 0, failed_count: 0, created_at: createdAt },
    {
      id, task_id: `task-${id}`, status: 'queued', provider_id: null, model_id: null, task_text: 'g', result: null,
      error: null, queue_position: null, is_local: null, progress_pct: 0, poll_again_after_ms: null, retry_count: 0,
      created_at: createdAt, started_at: null, completed_at: null,
    },
    makeState(id, repo, state),
  );
}

/** A fake worker: each run waits until the test releases it, then writes a terminal row. */
function fakeWorkers() {
  const gates = new Map<string, ReturnType<typeof deferred>>();
  const runs: string[] = [];
  const cancels: string[] = [];
  const createWorker = jest.fn((_repo: string) => ({
    async run(jobId: string) {
      runs.push(jobId);
      const gate = deferred();
      gates.set(jobId, gate);
      await gate.promise;
      await store.finishPatchJob(jobId, { status: 'completed', result: '{}' });
      return {};
    },
    cancel(jobId: string) {
      cancels.push(jobId);
      gates.get(jobId)?.resolve();
      return gates.has(jobId);
    },
  }));
  const release = (jobId: string) => gates.get(jobId)?.resolve();
  return { createWorker, runs, cancels, release, gates };
}

const until = async (cond: () => boolean | Promise<boolean>) => {
  for (let i = 0; i < 200; i++) {
    if (await cond()) return;
    await new Promise(r => setTimeout(r, 10));
  }
  throw new Error('condition not reached');
};

const cleanupNoop = () => ({ cleanupOrphans: jest.fn(async () => undefined) });

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'locallama-dispatcher-'));
  await writeFile(path.join(root, 'empty-gitconfig'), '');
  process.env.JOB_DB_PATH = path.join(root, 'jobs.db');
  await db.initJobStore();
});

afterEach(async () => {
  await db.closeJobStore();
  delete process.env.JOB_DB_PATH;
  await rm(root, { recursive: true, force: true });
});

describe('PatchDispatcher', () => {
  it('AC9: claims the oldest queued patch Job first and runs one worker at a time', async () => {
    await submit('job-b', 2000);
    await submit('job-a', 1000);
    await submit('job-c', 3000);
    const w = fakeWorkers();
    const dispatcher = new PatchDispatcher({ createWorker: w.createWorker, createBackend: cleanupNoop, maxConcurrent: 1 });
    dispatcher.kick();
    await until(() => w.runs.length === 1);
    expect(w.runs).toEqual(['job-a']);
    expect((await db.getJob('job-b'))?.status).toBe('queued');
    expect((await db.getJob('job-c'))?.status).toBe('queued');
    w.release('job-a');
    await until(() => w.runs.length === 2);
    expect(w.runs).toEqual(['job-a', 'job-b']);
    expect((await db.getJob('job-c'))?.status).toBe('queued');
    w.release('job-b');
    await until(() => w.runs.length === 3);
    w.release('job-c');
    await dispatcher.idle();
    expect(w.runs).toEqual(['job-a', 'job-b', 'job-c']);
    expect((await db.getJob('job-c'))?.status).toBe('completed');
  });

  it('AC9: honours PATCH_MAX_CONCURRENT above 1', async () => {
    await submit('job-a', 1000);
    await submit('job-b', 2000);
    await submit('job-c', 3000);
    const w = fakeWorkers();
    const dispatcher = new PatchDispatcher({ createWorker: w.createWorker, createBackend: cleanupNoop, maxConcurrent: 2 });
    dispatcher.kick();
    await until(() => w.runs.length === 2);
    await new Promise(r => setTimeout(r, 30));
    expect(w.runs).toEqual(['job-a', 'job-b']);
    w.release('job-a');
    w.release('job-b');
    await until(() => w.runs.length === 3);
    w.release('job-c');
    await dispatcher.idle();
  });

  it('AC9: a repeated kick while busy does not double-claim', async () => {
    await submit('job-a', 1000);
    const w = fakeWorkers();
    const dispatcher = new PatchDispatcher({ createWorker: w.createWorker, createBackend: cleanupNoop, maxConcurrent: 1 });
    dispatcher.kick();
    dispatcher.kick();
    dispatcher.kick();
    await until(() => w.runs.length === 1);
    w.release('job-a');
    await dispatcher.idle();
    expect(w.runs).toEqual(['job-a']);
  });

  it('AC9: a worker that throws ends the Job failed with a patch_result_v1 internal_error', async () => {
    await submit('job-x', 1000);
    const dispatcher = new PatchDispatcher({
      createWorker: () => ({ run: async () => { throw new Error('boom'); }, cancel: () => false }),
      createBackend: cleanupNoop,
    });
    dispatcher.kick();
    await until(async () => (await db.getJob('job-x'))?.status === 'failed');
    await dispatcher.idle();
    const job = await db.getJob('job-x');
    expect(job?.error).toBe('internal_error');
    const result = JSON.parse(job!.result!);
    expect(result).toMatchObject({ schema: 'patch_result_v1', status: 'failed', reason: 'internal_error', diff: '', base: 'abc123' });
  });

  it('AC6: a queued patch Job that is cancelled is never claimed', async () => {
    await submit('job-q', 1000);
    await db.cancelJobsForTask('task-job-q');
    const w = fakeWorkers();
    const dispatcher = new PatchDispatcher({ createWorker: w.createWorker, createBackend: cleanupNoop });
    dispatcher.kick();
    await dispatcher.idle();
    expect(w.runs).toEqual([]);
    expect((await db.getJob('job-q'))?.status).toBe('cancelled');
  });

  it('AC6: cancel() aborts the running worker and the Job stays cancelled', async () => {
    await submit('job-r', 1000);
    const w = fakeWorkers();
    const dispatcher = new PatchDispatcher({ createWorker: w.createWorker, createBackend: cleanupNoop });
    dispatcher.kick();
    await until(() => w.runs.length === 1);
    expect((await db.getJob('job-r'))?.status).toBe('in_progress');
    // cancel_task writes the row first, then aborts the controller.
    await db.cancelJobsForTask('task-job-r');
    expect(dispatcher.cancel('job-r')).toBe(true);
    await dispatcher.idle();
    expect(w.cancels).toEqual(['job-r']);
    // The worker's late terminal write cannot overwrite the cancel.
    expect((await db.getJob('job-r'))?.status).toBe('cancelled');
    expect(dispatcher.cancel('job-r')).toBe(false);
    expect(dispatcher.cancel('unknown')).toBe(false);
  });

  it('AC5: after a restart mid-task the Job is requeued and resumed from stored state, recovery before dispatch', async () => {
    await submit('job-m', 1000, '/repo', { base_commit: 'base-1', deadline_at: 123_456, cursor_model: 1, attempts_used: 2 });
    expect(await store.claimNextPatchJob()).toBeDefined();
    await store.recordAttemptStart('job-m', { cursor_model: 1, attempts_used: 2, updated_at: 50 });
    const before = await store.getPatchState('job-m');
    // "Restart": a new dispatcher instance over the same persisted store.
    const order: string[] = [];
    let seen: unknown;
    const dispatcher = new PatchDispatcher({
      createWorker: () => ({
        async run(jobId: string) {
          order.push(`run:${jobId}`);
          seen = { job: await db.getJob(jobId), state: await store.getPatchState(jobId) };
          await store.finishPatchJob(jobId, { status: 'completed', result: '{}' });
          return {};
        },
        cancel: () => false,
      }),
      createBackend: (repo: string) => ({
        cleanupOrphans: async (owned: ReadonlySet<string>) => { order.push(`cleanup:${repo}:${[...owned].join(',')}`); },
      }),
    });
    const summary = await dispatcher.start();
    await dispatcher.idle();
    expect(summary.requeued).toBe(1);
    expect(order).toEqual(['cleanup:/repo:job-m', 'run:job-m']);
    const { job, state } = seen as { job: { status: string }; state: Record<string, unknown> };
    expect(job.status).toBe('in_progress');
    expect(state).toEqual(before);
    expect(state).toMatchObject({ base_commit: 'base-1', deadline_at: 123_456, cursor_model: 1, attempts_used: 2 });
  });

  it('AC7: start-up cleanup leaves no scratch worktree or base ref that no live patch Job owns', async () => {
    const repo = path.join(root, 'repo');
    const rootDir = path.join(root, 'state');
    await mkdir(repo);
    await git(repo, 'init', '-b', 'main');
    await git(repo, 'config', 'user.name', 'Dispatcher Test');
    await git(repo, 'config', 'user.email', 'dispatcher@example.invalid');
    await writeFile(path.join(repo, 'a.txt'), 'a\n');
    await git(repo, 'add', '.');
    await git(repo, 'commit', '-m', 'fixture');
    const options = { rootDir };
    const backend = new GitWorkspaceBackend(repo, options);
    // A crashed terminal Job left its worktree and ref; an orphan ref has no row at all.
    const doneBase = await backend.snapshot(repo, [], 'done-job');
    await backend.create(doneBase, 'done-job');
    await backend.snapshot(repo, [], 'orphan-job');
    const liveBase = await backend.snapshot(repo, [], 'live-job');
    await submit('done-job', 1000, repo, { base_commit: doneBase });
    await store.finishPatchJob('done-job', { status: 'failed', result: '{}' });
    await submit('live-job', 2000, repo, { base_commit: liveBase });
    const runs: string[] = [];
    const dispatcher = new PatchDispatcher({
      createBackend: (r: string) => new GitWorkspaceBackend(r, options),
      createWorker: () => ({
        async run(jobId: string) { runs.push(jobId); await store.finishPatchJob(jobId, { status: 'completed', result: '{}' }); return {}; },
        cancel: () => false,
      }),
    });
    await dispatcher.start();
    await dispatcher.idle();
    expect(runs).toEqual(['live-job']);
    const refs = (await git(repo, 'for-each-ref', '--format=%(refname)', 'refs/locallama/base/')).trim().split('\n').filter(Boolean);
    expect(refs).toEqual(['refs/locallama/base/live-job']);
    const scratch = path.join(rootDir, 'scratch');
    const entries = (await readdir(scratch)).filter(name => !name.startsWith('.'));
    expect(entries).toEqual([]);
    expect(await git(repo, 'worktree', 'list', '--porcelain')).not.toContain('done-job');
  });

  it('AC7: a repository that no longer exists does not stop recovery or dispatch', async () => {
    await submit('job-gone', 1000, path.join(root, 'missing-repo'));
    const w = fakeWorkers();
    const dispatcher = new PatchDispatcher({
      createWorker: w.createWorker,
      createBackend: () => ({ cleanupOrphans: async () => { throw new Error('not a repo'); } }),
    });
    await dispatcher.start();
    await until(() => w.runs.length === 1);
    w.release('job-gone');
    await dispatcher.idle();
    expect(w.runs).toEqual(['job-gone']);
  });
});
