import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

jest.unstable_mockModule('../../../dist/config/index.js', () => ({
  config: { rootDir: tmpdir(), cacheDir: tmpdir(), patchMaxConcurrent: 1, patchTasksEnabled: false, patchRepoRoots: [] },
}));
jest.unstable_mockModule('../../../dist/utils/logger.js', () => ({
  logger: { error: jest.fn(), warn: jest.fn(), info: jest.fn(), debug: jest.fn() },
}));

const db = await import('../../../dist/modules/job-store/db.js');
const store = await import('../../../dist/modules/job-store/patch-store.js');
const { submitPatchTask, PatchRefusal } = await import('../../../dist/modules/patch/dispatcher/index.js');
const { GitWorkspaceBackend } = await import('../../../dist/modules/patch/workspace/index.js');

const exec = promisify(execFile);
const git = async (cwd: string, ...args: string[]) => (await exec('git', args, {
  cwd, env: { ...process.env, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: path.join(root, 'empty-gitconfig'), GIT_TERMINAL_PROMPT: '0' },
})).stdout;

let root: string;
let repo: string;
let allowed: string;
let rootDir: string;

const baseConfig = () => ({
  patchTasksEnabled: true,
  patchRepoRoots: [allowed],
  rootDir,
  scratchDir: path.join(rootDir, 'scratch'),
  openRouterFreeOnly: true,
  patchLocalModels: 2, patchFreeModels: 2, patchPaidModels: 1,
  patchAttemptsPerModel: 3, patchMaxAttempts: 12, patchTaskTimeoutMs: 7_200_000,
  patchMaxOutputTokens: 2000, patchContextTokens: 6000, patchInferenceTimeoutMs: 900_000,
  patchCheckTimeoutMs: 600_000, patchErrorTailTokens: 800, patchWholeFileMaxLines: 200,
  patchPaidCapUsd: 0.25, patchKeepWorkspaceOnFail: false,
});

const localProvider = {
  id: 'fake-local', isLocal: true, costClass: 'local',
  isAvailable: async () => true,
  listModels: async () => [{ id: 'coder-7b' }],
  getCost: () => ({ prompt: 0, completion: 0 }),
};

const refusal = async (p: Promise<unknown>) => {
  try { await p; } catch (error) {
    expect(error).toBeInstanceOf(PatchRefusal);
    return (error as InstanceType<typeof PatchRefusal>).code;
  }
  throw new Error('expected a refusal');
};

function deps(over: Record<string, unknown> = {}) {
  const kick = jest.fn();
  const submitting = new Set<string>();
  const options = { rootDir, scratchDir: path.join(rootDir, 'scratch') };
  const dispatcher = {
    kick,
    submitting,
    cleanupRepo: jest.fn(async (r: string) => {
      // The real dispatcher computes owned ids from the store; none are live here.
      await new GitWorkspaceBackend(r, options).cleanupOrphans(new Set(submitting));
    }),
  };
  return {
    kick, dispatcher,
    deps: {
      config: baseConfig(),
      providers: { list: () => [localProvider] },
      models: { getModel: () => undefined },
      dispatcher,
      createBackend: (r: string) => new GitWorkspaceBackend(r, options),
      ...over,
    },
  };
}

const baseRefs = async () =>
  (await git(repo, 'for-each-ref', '--format=%(refname)', 'refs/locallama/base/')).trim().split('\n').filter(Boolean);

const checks = [{ name: 'test', argv: ['node', '-e', 'process.exit(0)'] }];

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'locallama-patch-task-'));
  await writeFile(path.join(root, 'empty-gitconfig'), '');
  allowed = path.join(root, 'allowed');
  rootDir = path.join(root, 'state');
  repo = path.join(allowed, 'repo');
  await mkdir(repo, { recursive: true });
  await git(repo, 'init', '-b', 'main');
  await git(repo, 'config', 'user.name', 'Patch Test');
  await git(repo, 'config', 'user.email', 'patch@example.invalid');
  await writeFile(path.join(repo, 'a.ts'), 'export const a = 1;\n');
  await git(repo, 'add', '.');
  await git(repo, 'commit', '-m', 'fixture');
  process.env.JOB_DB_PATH = path.join(root, 'jobs.db');
  await db.initJobStore();
});

afterEach(async () => {
  await db.closeJobStore();
  delete process.env.JOB_DB_PATH;
  await rm(root, { recursive: true, force: true });
});

describe('patch_task submit', () => {
  it('AC1: valid input returns a task_id in under 1 s and writes Task, Job and patch_state', async () => {
    const { deps: d, kick } = deps();
    const started = Date.now();
    const out = await submitPatchTask({ goal: 'make a 2', repo_path: repo, checks, max_minutes: 5 }, d);
    expect(Date.now() - started).toBeLessThan(1000);
    expect(Object.keys(out).sort()).toEqual(['job_id', 'status', 'task_id']);
    expect(out.status).toBe('queued');
    expect(kick).toHaveBeenCalledTimes(1);
    expect((await db.getTask(out.task_id))?.status).toBe('queued');
    const job = await db.getJob(out.job_id);
    expect(job).toMatchObject({ task_id: out.task_id, status: 'queued', kind: 'patch', task_text: 'make a 2' });
    const state = await store.getPatchState(out.job_id);
    expect(state).toBeDefined();
    expect(await baseRefs()).toEqual([`refs/locallama/base/${out.job_id}`]);
    expect((await git(repo, 'rev-parse', `refs/locallama/base/${out.job_id}`)).trim()).toBe(state!.base_commit);
    expect(JSON.parse(state!.request_json)).toEqual({
      goal: 'make a 2', repo_path: repo, file_hints: [], allow_paid: false, paid_cap_usd: 0.25, validate: false,
    });
    expect(JSON.parse(state!.checks_json)).toMatchObject({ checks });
    expect(JSON.parse(state!.ladder_json)).toEqual([{ model_id: 'coder-7b', provider_id: 'fake-local', cost_class: 'local' }]);
    expect(JSON.parse(state!.settings_json)).toMatchObject({ patchMaxAttempts: 12, patchPaidCapUsd: 0.25, openRouterFreeOnly: true });
    expect(state!.deadline_at - job!.created_at).toBe(5 * 60_000);
    expect(state).toMatchObject({ cursor_model: 0, attempts_used: 0, paid_spent_usd: 0, paid_reserved_usd: 0 });
    expect(d.dispatcher.submitting.size).toBe(0);
  });

  it('AC1: without request checks, .locallama/checks.json is read from the snapshot', async () => {
    await mkdir(path.join(repo, '.locallama'));
    const fileChecks = { checks: [{ name: 'tsc', argv: ['npx', 'tsc'] }], env_allow: ['NODE_OPTIONS'] };
    await writeFile(path.join(repo, '.locallama', 'checks.json'), JSON.stringify(fileChecks));
    await git(repo, 'add', '.');
    await git(repo, 'commit', '-m', 'checks');
    const { deps: d } = deps();
    const out = await submitPatchTask({ goal: 'g', repo_path: repo }, d);
    const state = await store.getPatchState(out.job_id);
    expect(JSON.parse(state!.checks_json)).toEqual(fileChecks);
    expect(state!.deadline_at - (await db.getJob(out.job_id))!.created_at).toBe(7_200_000);
  });

  it('AC1: request checks win over .locallama/checks.json (Ruling 4)', async () => {
    await mkdir(path.join(repo, '.locallama'));
    await writeFile(path.join(repo, '.locallama', 'checks.json'), JSON.stringify({ checks: [{ name: 'tsc', argv: ['npx', 'tsc'] }] }));
    await git(repo, 'add', '.');
    await git(repo, 'commit', '-m', 'checks');
    const { deps: d } = deps();
    const out = await submitPatchTask({ goal: 'g', repo_path: repo, checks }, d);
    expect(JSON.parse((await store.getPatchState(out.job_id))!.checks_json).checks).toEqual(checks);
  });

  it('AC2: no checks from either source is refused with no_checks and leaves no base ref or rows', async () => {
    const { deps: d, kick } = deps();
    expect(await refusal(submitPatchTask({ goal: 'g', repo_path: repo }, d))).toBe('no_checks');
    expect(await refusal(submitPatchTask({ goal: 'g', repo_path: repo, checks: [] }, d))).toBe('no_checks');
    expect(kick).not.toHaveBeenCalled();
    expect(await baseRefs()).toEqual([]);
    expect(await db.getAllJobs()).toEqual([]);
  });

  it('AC2: an explicit empty request list overrides the file and is refused with no_checks', async () => {
    await mkdir(path.join(repo, '.locallama'));
    await writeFile(path.join(repo, '.locallama', 'checks.json'), JSON.stringify({ checks: [{ name: 'tsc', argv: ['npx', 'tsc'] }] }));
    await git(repo, 'add', '.');
    await git(repo, 'commit', '-m', 'checks');
    const { deps: d } = deps();
    expect(await refusal(submitPatchTask({ goal: 'g', repo_path: repo, checks: [] }, d))).toBe('no_checks');
  });

  it('AC3: with PATCH_TASKS_ENABLED off a call fails', async () => {
    const { deps: d } = deps({ config: { ...baseConfig(), patchTasksEnabled: false } });
    expect(await refusal(submitPatchTask({ goal: 'g', repo_path: repo, checks }, d))).toBe('patch_tasks_disabled');
    expect(await baseRefs()).toEqual([]);
  });

  it('AC3: repo_path outside PATCH_REPO_ROOTS is refused, and there is no default root', async () => {
    const outside = path.join(root, 'outside');
    await mkdir(outside);
    await git(outside, 'init', '-b', 'main');
    const { deps: d } = deps();
    expect(await refusal(submitPatchTask({ goal: 'g', repo_path: outside, checks }, d))).toBe('repo_not_allowed');
    const { deps: none } = deps({ config: { ...baseConfig(), patchRepoRoots: [] } });
    expect(await refusal(submitPatchTask({ goal: 'g', repo_path: repo, checks }, none))).toBe('repo_not_allowed');
    // A symlink inside a root that points outside it is judged by its real path.
    await symlink(outside, path.join(allowed, 'link'));
    expect(await refusal(submitPatchTask({ goal: 'g', repo_path: path.join(allowed, 'link'), checks }, d))).toBe('repo_not_allowed');
    // A prefix that is not a path boundary does not count as inside.
    const sibling = `${allowed}-x`;
    await mkdir(sibling);
    expect(await refusal(submitPatchTask({ goal: 'g', repo_path: sibling, checks }, d))).toBe('repo_not_allowed');
    expect(await db.getAllJobs()).toEqual([]);
  });

  it('AC3: input is checked before any snapshot', async () => {
    const { deps: d } = deps();
    expect(await refusal(submitPatchTask({ repo_path: repo, checks }, d))).toBe('invalid_input');
    expect(await refusal(submitPatchTask({ goal: 'g', repo_path: 'relative/repo', checks }, d))).toBe('invalid_input');
    expect(await refusal(submitPatchTask({ goal: 'g', repo_path: repo, checks: [{ name: 'x', argv: [] }] }, d))).toBe('invalid_input');
    expect(await refusal(submitPatchTask({ goal: 'g', repo_path: repo, checks, allow_paid: 'yes' }, d))).toBe('invalid_input');
    expect(await refusal(submitPatchTask({ goal: 'g', repo_path: repo, checks, paid_cap_usd: -1 }, d))).toBe('invalid_input');
    expect(await refusal(submitPatchTask({ goal: 'g', repo_path: repo, checks, max_minutes: 0 }, d))).toBe('invalid_input');
    expect(await refusal(submitPatchTask({ goal: 'g', repo_path: repo, checks, file_hints: [1] }, d))).toBe('invalid_input');
    expect(await baseRefs()).toEqual([]);
  });

  it('a directory inside a root that is not a git repository root is refused with snapshot_failed', async () => {
    const plain = path.join(allowed, 'plain');
    await mkdir(plain);
    const { deps: d } = deps();
    expect(await refusal(submitPatchTask({ goal: 'g', repo_path: plain, checks }, d))).toBe('snapshot_failed');
  });

  it('an empty ladder is refused with ladder_exhausted and leaves no base ref', async () => {
    const { deps: d, kick } = deps({ providers: { list: () => [] } });
    expect(await refusal(submitPatchTask({ goal: 'g', repo_path: repo, checks }, d))).toBe('ladder_exhausted');
    expect(kick).not.toHaveBeenCalled();
    expect(await baseRefs()).toEqual([]);
    expect(await db.getAllJobs()).toEqual([]);
  });

  it('allow_paid and paid_cap_usd are stored as given', async () => {
    const { deps: d } = deps();
    const out = await submitPatchTask({ goal: 'g', repo_path: repo, checks, allow_paid: true, paid_cap_usd: 1.5, validate: true, file_hints: ['a.ts'] }, d);
    expect(JSON.parse((await store.getPatchState(out.job_id))!.request_json)).toMatchObject({
      allow_paid: true, paid_cap_usd: 1.5, validate: true, file_hints: ['a.ts'],
    });
  });
});
