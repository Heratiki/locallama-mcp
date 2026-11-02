import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { chmod, mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { PatchState, LadderEntry } from '../../../src/modules/patch/types.js';
import type { LLMProvider } from '../../../src/modules/core/provider/types.js';

jest.unstable_mockModule('../../../dist/utils/logger.js', () => ({ logger: {
  error: jest.fn(), warn: jest.fn(), info: jest.fn(), debug: jest.fn(),
} }));

const { PatchWorker, snapshotPatchWorkspace } = await import('../../../dist/modules/patch/worker/index.js');
const { GitWorkspaceBackend } = await import('../../../dist/modules/patch/workspace/index.js');
const { ProviderRegistry } = await import('../../../dist/modules/core/provider/registry.js');
const store = await import('../../../dist/modules/job-store/index.js');
const exec = promisify(execFile);

let root: string;
let repo: string;
let prompts: string[];
let originalPath: string | undefined;
const local: LadderEntry = { model_id: 'qwen-1', provider_id: 'fake', cost_class: 'local' };
const reply = (suffix: string) =>
  `a.ts\n<<<<<<< SEARCH\nexport const value = 1;\n=======\nexport const value = 2;${suffix}\n>>>>>>> REPLACE\n`;
const unit = { name: 'unit', argv: [process.execPath, '-e', "if(!require('fs').readFileSync('a.ts','utf8').includes('value = 2')) process.exit(1)"] };

async function git(...args: string[]) { return (await exec('git', args, { cwd: repo })).stdout.trim(); }

async function run(checksConfig: object, seed?: (backend: InstanceType<typeof GitWorkspaceBackend>, base: string) => Promise<void>) {
  const backend = new GitWorkspaceBackend(repo, { rootDir: root });
  const base = await snapshotPatchWorkspace(backend, repo, ['a.ts'], 'job');
  const now = Date.now();
  const state: PatchState = {
    job_id: 'job', request_json: JSON.stringify({ goal: 'set value to 2', repo_path: repo, file_hints: ['a.ts'] }),
    base_commit: base, checks_json: JSON.stringify(checksConfig), ladder_json: JSON.stringify([local]),
    settings_json: JSON.stringify({ patchMaxAttempts: 3, patchAttemptsPerModel: 3, patchMaxOutputTokens: 2000, openRouterFreeOnly: false }),
    deadline_at: now + 60000, cursor_model: 0, attempts_used: 0, paid_spent_usd: 0, paid_reserved_usd: 0, updated_at: now,
  };
  await store.submitPatchJob({ id: 'task', status: 'queued', job_count: 1, completed_count: 0, failed_count: 0, created_at: now }, {
    id: 'job', task_id: 'task', status: 'queued', provider_id: null, model_id: null, task_text: 'patch', result: null, error: null,
    queue_position: null, is_local: null, progress_pct: 0, poll_again_after_ms: null, retry_count: 0, created_at: now, started_at: null, completed_at: null, kind: 'patch',
  }, state);
  expect(await store.claimPatchJob('job')).toBe(true);
  if (seed) await seed(backend, base);
  const registry = new ProviderRegistry();
  const provider: LLMProvider = {
    id: 'fake', displayName: 'fake', costClass: 'local', isLocal: true, init: async () => {}, isAvailable: async () => true,
    listModels: async () => [{ id: 'qwen-1', contextWindow: 8192 }], supportsModel: () => true,
    getCost: () => ({ prompt: 0, completion: 0 }),
    executeTask: async (model, prompt) => {
      prompts.push(prompt);
      return { content: reply(prompts.length === 1 ? '' : ' // ok'), model, promptTokens: 1, completionTokens: 1 };
    },
  };
  registry.register(provider);
  return new PatchWorker({ backend, registry }).run('job');
}

beforeEach(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), 'patch-lint-worker-'));
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
  prompts = [];
  // Fake oxlint: fails until the edited file carries the marker comment.
  const bin = path.join(root, 'bin');
  await mkdir(bin);
  const oxlint = path.join(bin, 'oxlint');
  await writeFile(oxlint, '#!/bin/sh\ngrep -q "// ok" "$@" || { echo "LINT-ERR no-unused-vars in $1"; exit 1; }\n');
  await chmod(oxlint, 0o755);
  originalPath = process.env.PATH;
  process.env.PATH = `${bin}:/usr/bin:/bin`;
});
afterEach(async () => {
  process.env.PATH = originalPath;
  await store.closeJobStore();
  delete process.env.JOB_DB_PATH;
  await rm(root, { recursive: true, force: true });
});

describe('patch worker with lint auto', () => {
  it('feeds the lint failure tail to the next attempt and reports lint_skipped', async () => {
    const result = await run({ checks: [unit], lint: 'auto' });
    expect(result).toMatchObject({ status: 'passed', attempts: 2 });
    expect(prompts[1]).toContain('LINT-ERR no-unused-vars in a.ts');
    expect(result.checks.map((c: { name: string }) => c.name)).toEqual(['unit', 'lint:oxlint']);
    expect((result as unknown as { lint_skipped: { tool: string; reason: string }[] }).lint_skipped)
      .toEqual(expect.arrayContaining([expect.objectContaining({ tool: 'tsc' })]));
  });

  it('without lint the same repo passes on the first attempt with no lint fields', async () => {
    const result = await run({ checks: [unit] });
    expect(result).toMatchObject({ status: 'passed', attempts: 1 });
    expect(result).not.toHaveProperty('lint_skipped');
  });

  // A restart between the durable passing attempt and the terminal write must reuse it.
  const persistPassed = (lintExit: number) => async (backend: InstanceType<typeof GitWorkspaceBackend>, base: string) => {
    const ws = await backend.create(base, 'job');
    await writeFile(path.join(ws.path, 'a.ts'), 'export const value = 2; // ok\n');
    const diff = await backend.diff(ws);
    await store.recordAttemptStart('job', { cursor_model: 0, attempts_used: 1 });
    const check = (name: string, exit_code: number) => ({ name, exit_code, timed_out: false, duration_ms: 1, tail: '' });
    await store.insertPatchAttempt({ job_id: 'job', n: 1, model_id: 'qwen-1', provider_id: 'fake', cost_class: 'local',
      prompt_tokens: 10, completion_tokens: 20, cost_usd: 0,
      edit_blocks: JSON.stringify({ blocks: [], calls: [], files: ['a.ts'], diff }), outcome: 'passed', apply_error: null,
      checks_json: JSON.stringify([check('unit', 0), check('lint:oxlint', lintExit)]),
      duration_ms: 1, started_at: 1, ended_at: 2 });
  };

  it('resumes a persisted passing attempt (explicit + lint checks) with no new model call', async () => {
    const result = await run({ checks: [unit], lint: 'auto' }, persistPassed(0));
    expect(result).toMatchObject({ status: 'passed', attempts: 1 });
    expect(prompts).toHaveLength(0);
  });

  it('does not take the resume shortcut when a persisted lint check failed', async () => {
    const result = await run({ checks: [unit], lint: 'auto' }, persistPassed(1));
    expect(prompts.length).toBeGreaterThan(0);
    expect(result.status).toBe('passed');
  });
});
