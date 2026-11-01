import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { config, type Config } from '../../../config/index.js';
import { logger } from '../../../utils/logger.js';
import { getProviderRegistry } from '../../core/provider/index.js';
import { getModelRegistry } from '../../core/model/index.js';
import { submitPatchJob } from '../../job-store/index.js';
import { resolveChecks } from '../checks/index.js';
import { validateChecks } from '../checks/validation.js';
import { buildLadder, computeDeadline, type LadderModelScores, type LadderProviders } from '../ladder/index.js';
import { snapshotPatchWorkspace, type PatchRequest, type WorkerSettings } from '../worker/index.js';
import { GitWorkspaceBackend } from '../workspace/index.js';
import type { CheckSpec, PatchState, WorkspaceBackend } from '../types.js';

const exec = promisify(execFile);

export type PatchRefusalCode =
  | 'patch_tasks_disabled'
  | 'invalid_input'
  | 'repo_not_allowed'
  | 'snapshot_failed'
  | 'no_checks'
  | 'ladder_exhausted';

/** A submit-time refusal; the MCP layer returns `{ error: code, message }`. */
export class PatchRefusal extends Error {
  constructor(readonly code: PatchRefusalCode, message: string = code) {
    super(message);
    this.name = 'PatchRefusal';
  }
}

export interface PatchSubmitResult {
  task_id: string;
  job_id: string;
  status: 'queued';
}

type PatchConfig = Pick<Config,
  'patchTasksEnabled' | 'patchRepoRoots' | 'rootDir' | 'scratchDir' | 'openRouterFreeOnly' |
  'patchLocalModels' | 'patchFreeModels' | 'patchPaidModels' | 'patchAttemptsPerModel' | 'patchMaxAttempts' |
  'patchTaskTimeoutMs' | 'patchMaxOutputTokens' | 'patchContextTokens' | 'patchInferenceTimeoutMs' |
  'patchCheckTimeoutMs' | 'patchErrorTailTokens' | 'patchWholeFileMaxLines' | 'patchPaidCapUsd' |
  'patchKeepWorkspaceOnFail'>;

export interface SubmitDeps {
  config: PatchConfig;
  providers: LadderProviders;
  models: LadderModelScores;
  dispatcher: { kick(): void; submitting: Set<string>; cleanupRepo(repoPath: string): Promise<void> };
  createBackend: (repoPath: string) => WorkspaceBackend;
  now: () => number;
}

interface ParsedInput {
  request: Required<PatchRequest>;
  checks?: CheckSpec[];
  maxMinutes?: number;
}

const fail = (message: string): never => { throw new PatchRefusal('invalid_input', message); };

function parseInput(raw: unknown, cfg: PatchConfig): ParsedInput {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) fail('arguments must be an object');
  const a = raw as Record<string, unknown>;
  if (typeof a.goal !== 'string' || !a.goal.trim()) fail('goal must be a nonempty string');
  if (typeof a.repo_path !== 'string' || !path.isAbsolute(a.repo_path) || a.repo_path.includes('\0')) {
    fail('repo_path must be an absolute path');
  }
  const hints = a.file_hints ?? [];
  if (!Array.isArray(hints) || !hints.every(h => typeof h === 'string' && h && !h.includes('\0'))) {
    fail('file_hints must be an array of relative paths');
  }
  let checks: CheckSpec[] | undefined;
  if (a.checks !== undefined) {
    try { validateChecks(a.checks); } catch (error) { fail(`checks: ${(error as Error).message}`); }
    checks = a.checks as CheckSpec[];
  }
  const bool = (name: string): boolean => {
    const v = a[name];
    if (v === undefined) return false;
    if (typeof v !== 'boolean') fail(`${name} must be a boolean`);
    return v as boolean;
  };
  const cap = a.paid_cap_usd ?? cfg.patchPaidCapUsd;
  if (typeof cap !== 'number' || !Number.isFinite(cap) || cap < 0) fail('paid_cap_usd must be a number >= 0');
  let maxMinutes: number | undefined;
  if (a.max_minutes !== undefined) {
    if (typeof a.max_minutes !== 'number' || !Number.isFinite(a.max_minutes) || a.max_minutes <= 0) {
      fail('max_minutes must be a number > 0');
    }
    maxMinutes = a.max_minutes as number;
  }
  return {
    request: {
      goal: a.goal as string, repo_path: a.repo_path as string, file_hints: hints as string[],
      allow_paid: bool('allow_paid'), paid_cap_usd: cap as number, validate: bool('validate'),
    },
    checks,
    maxMinutes,
  };
}

function inside(root: string, child: string): boolean {
  const rel = path.relative(root, child);
  return rel === '' || (rel !== '..' && !rel.startsWith(`..${path.sep}`) && !path.isAbsolute(rel));
}

/** §6: the real repo path must be inside the real path of a PATCH_REPO_ROOTS entry. No default root. */
async function allowedRepo(repoPath: string, roots: string[]): Promise<string> {
  let real: string;
  try { real = await realpath(repoPath); } catch { throw new PatchRefusal('repo_not_allowed', 'repo_path does not exist'); }
  for (const root of roots) {
    if (!path.isAbsolute(root)) continue;
    let realRoot: string;
    try { realRoot = await realpath(root); } catch { continue; }
    if (inside(realRoot, real)) return real;
  }
  throw new PatchRefusal('repo_not_allowed', 'repo_path is not inside PATCH_REPO_ROOTS');
}

async function git(repo: string, args: string[]): Promise<string> {
  // A host's GIT_DIR/GIT_INDEX_FILE must not redirect reads away from the repo.
  const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('GIT_')));
  const out = await exec('git', ['-C', repo, ...args], { env: { ...env, GIT_TERMINAL_PROMPT: '0' }, encoding: 'utf8', maxBuffer: 4 * 1024 * 1024 });
  return out.stdout;
}

/**
 * Resolve checks against the snapshot commit, never the live tree: materialise
 * only the snapshot's .locallama/checks.json in a temp dir for the loader.
 */
async function resolveSnapshotChecks(repo: string, base: string, requestChecks?: CheckSpec[]) {
  const file = '.locallama/checks.json';
  const dir = await mkdtemp(path.join(tmpdir(), 'locallama-checks-'));
  try {
    if ((await git(repo, ['ls-tree', '--name-only', base, '--', file])).trim()) {
      await mkdir(path.join(dir, '.locallama'));
      await writeFile(path.join(dir, file), await git(repo, ['cat-file', 'blob', `${base}:${file}`]));
    }
    return await resolveChecks(dir, requestChecks);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

function settingsOf(cfg: PatchConfig): WorkerSettings {
  return {
    patchMaxAttempts: cfg.patchMaxAttempts, patchAttemptsPerModel: cfg.patchAttemptsPerModel,
    patchMaxOutputTokens: cfg.patchMaxOutputTokens, patchContextTokens: cfg.patchContextTokens,
    patchInferenceTimeoutMs: cfg.patchInferenceTimeoutMs, patchCheckTimeoutMs: cfg.patchCheckTimeoutMs,
    patchErrorTailTokens: cfg.patchErrorTailTokens, patchWholeFileMaxLines: cfg.patchWholeFileMaxLines,
    patchPaidCapUsd: cfg.patchPaidCapUsd, patchKeepWorkspaceOnFail: cfg.patchKeepWorkspaceOnFail,
    openRouterFreeOnly: cfg.openRouterFreeOnly,
  };
}

/** Defaults only for what the caller did not supply, so tests never build the real registries. */
async function resolveDeps(o: Partial<SubmitDeps>, cfg: PatchConfig): Promise<SubmitDeps> {
  return {
    config: cfg,
    providers: o.providers ?? getProviderRegistry(),
    models: o.models ?? getModelRegistry(),
    // Lazy: index.js re-exports this file, and getPatchDispatcher lives there.
    dispatcher: o.dispatcher ?? (await import('./index.js')).getPatchDispatcher(),
    createBackend: o.createBackend ?? (repo => new GitWorkspaceBackend(repo, { rootDir: cfg.rootDir, scratchDir: cfg.scratchDir })),
    now: o.now ?? Date.now,
  };
}

/**
 * PRD 01 §4 step 1: check input and §6, snapshot, resolve checks, ladder and
 * budgets, write Task + Job + patch_state in one transaction, return task_id.
 * Every refusal after the snapshot removes the base ref it created.
 */
export async function submitPatchTask(args: unknown, overrides: Partial<SubmitDeps> = {}): Promise<PatchSubmitResult> {
  const cfg = overrides.config ?? config;
  if (!cfg.patchTasksEnabled) throw new PatchRefusal('patch_tasks_disabled', 'PATCH_TASKS_ENABLED is off');
  const input = parseInput(args, cfg);
  const repo = await allowedRepo(input.request.repo_path, cfg.patchRepoRoots);
  // Persist the real path: the worker's backend binds to it, so a later symlink swap cannot redirect the Job.
  input.request.repo_path = repo;
  const deps = await resolveDeps(overrides, cfg);
  const now = deps.now;
  const jobId = randomUUID();
  const taskId = randomUUID();
  deps.dispatcher.submitting.add(jobId);
  let snapshotted = false;
  try {
    let base: string;
    try {
      base = await snapshotPatchWorkspace(deps.createBackend(repo), repo, input.request.file_hints, jobId);
      snapshotted = true;
    } catch (error) {
      throw new PatchRefusal('snapshot_failed', error instanceof Error ? error.message : String(error));
    }
    let checks;
    try {
      checks = await resolveSnapshotChecks(repo, base, input.checks);
    } catch (error) {
      throw new PatchRefusal('invalid_input', error instanceof Error ? error.message : String(error));
    }
    if (!checks.ok) throw new PatchRefusal('no_checks', 'no checks in the request or .locallama/checks.json');
    const ladder = await buildLadder({
      providers: deps.providers, models: deps.models, allowPaid: input.request.allow_paid,
      freeOnly: cfg.openRouterFreeOnly, localModels: cfg.patchLocalModels,
      freeModels: cfg.patchFreeModels, paidModels: cfg.patchPaidModels,
    });
    if (ladder.length === 0) throw new PatchRefusal('ladder_exhausted', 'no model is available for this task');

    const submittedAt = now();
    const state: PatchState = {
      job_id: jobId, request_json: JSON.stringify(input.request), base_commit: base,
      checks_json: JSON.stringify(checks.config), ladder_json: JSON.stringify(ladder),
      settings_json: JSON.stringify(settingsOf(cfg)),
      deadline_at: computeDeadline(submittedAt, cfg.patchTaskTimeoutMs, input.maxMinutes),
      cursor_model: 0, attempts_used: 0, paid_spent_usd: 0, paid_reserved_usd: 0, updated_at: submittedAt,
    };
    await submitPatchJob(
      { id: taskId, status: 'queued', job_count: 1, completed_count: 0, failed_count: 0, created_at: submittedAt },
      {
        id: jobId, task_id: taskId, status: 'queued', provider_id: null, model_id: null, task_text: input.request.goal,
        result: null, error: null, queue_position: null, is_local: null, progress_pct: 0, poll_again_after_ms: null,
        retry_count: 0, created_at: submittedAt, started_at: null, completed_at: null, kind: 'patch',
      },
      state,
    );
    snapshotted = false;
  } catch (error) {
    deps.dispatcher.submitting.delete(jobId);
    if (snapshotted) await deps.dispatcher.cleanupRepo(repo);
    if (!(error instanceof PatchRefusal)) logger.error(`[patch] Submit failed for ${repo}:`, error);
    throw error;
  }
  deps.dispatcher.submitting.delete(jobId);
  deps.dispatcher.kick();
  return { task_id: taskId, job_id: jobId, status: 'queued' };
}
