import { logger } from '../../utils/logger.js';
import type { PatchState } from '../patch/types.js';
import { getDbForPatchStore } from './db.js';
import type { PersistedJob, PersistedTask } from './types.js';

export interface PatchAttemptRow {
  id?: number;
  job_id: string;
  n: number;
  model_id: string | null;
  provider_id: string | null;
  cost_class: string | null;
  prompt_tokens: number | null;
  completion_tokens: number | null;
  cost_usd: number | null;
  edit_blocks: string | null;
  outcome: string | null;
  apply_error: string | null;
  checks_json: string | null;
  duration_ms: number | null;
  started_at: number | null;
  ended_at: number | null;
}

export interface PatchTerminalWrite {
  status: 'completed' | 'failed' | 'cancelled' | 'permanently_failed';
  result?: string | null;
  error?: string | null;
  completed_at?: number;
}

// One shared connection: serialize BEGIN..COMMIT blocks so they cannot interleave.
let txChain: Promise<unknown> = Promise.resolve();

function inTransaction<T>(fn: () => Promise<T>): Promise<T> {
  const run = txChain.then(async () => {
    const db = getDbForPatchStore();
    await db.exec('BEGIN IMMEDIATE');
    try {
      const out = await fn();
      await db.exec('COMMIT');
      return out;
    } catch (error) {
      await db.exec('ROLLBACK');
      throw error;
    }
  });
  txChain = run.catch(() => undefined);
  return run;
}

/** Create Task, one patch Job (kind='patch') and its patch_state row in one transaction. */
export async function submitPatchJob(task: PersistedTask, job: PersistedJob, state: PatchState): Promise<void> {
  const db = getDbForPatchStore();
  await inTransaction(async () => {
    await db.run(
      `INSERT INTO tasks (id, status, job_count, completed_count, failed_count, created_at) VALUES (?, ?, ?, ?, ?, ?)`,
      [task.id, task.status, task.job_count, task.completed_count, task.failed_count, task.created_at]
    );
    await db.run(
      `INSERT INTO jobs (id, task_id, status, provider_id, model_id, task_text, result, error, queue_position,
         is_local, progress_pct, poll_again_after_ms, retry_count, created_at, started_at, completed_at, validation, kind)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'patch')`,
      [job.id, job.task_id, job.status, job.provider_id, job.model_id, job.task_text, job.result, job.error,
        job.queue_position, job.is_local ?? null, job.progress_pct, job.poll_again_after_ms, job.retry_count,
        job.created_at, job.started_at, job.completed_at, job.validation ?? null]
    );
    await db.run(
      `INSERT INTO patch_state (job_id, request_json, base_commit, checks_json, ladder_json, settings_json,
         deadline_at, cursor_model, attempts_used, paid_spent_usd, paid_reserved_usd, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [state.job_id, state.request_json, state.base_commit, state.checks_json, state.ladder_json,
        state.settings_json, state.deadline_at, state.cursor_model, state.attempts_used,
        state.paid_spent_usd, state.paid_reserved_usd, state.updated_at]
    );
  }).catch((error) => {
    logger.error(`Failed to submit patch job ${job.id}:`, error);
    throw error;
  });
}

export async function getPatchState(jobId: string): Promise<PatchState | undefined> {
  return getDbForPatchStore().get<PatchState>('SELECT * FROM patch_state WHERE job_id = ?', [jobId]);
}

/** Written before each model call: the cursor and attempts_used survive a crash. */
export async function recordAttemptStart(
  jobId: string,
  v: { cursor_model: number; attempts_used: number; updated_at?: number }
): Promise<void> {
  await getDbForPatchStore().run(
    `UPDATE patch_state SET cursor_model = ?, attempts_used = ?, updated_at = ? WHERE job_id = ?`,
    [v.cursor_model, v.attempts_used, v.updated_at ?? Date.now(), jobId]
  );
}

export async function updatePatchSpend(
  jobId: string,
  v: { paid_spent_usd: number; paid_reserved_usd: number; updated_at?: number }
): Promise<void> {
  await getDbForPatchStore().run(
    `UPDATE patch_state SET paid_spent_usd = ?, paid_reserved_usd = ?, updated_at = ? WHERE job_id = ?`,
    [v.paid_spent_usd, v.paid_reserved_usd, v.updated_at ?? Date.now(), jobId]
  );
}

/** Conditional terminal write. Returns true only if this call moved the Job to a terminal state. */
export async function finishPatchJob(jobId: string, w: PatchTerminalWrite): Promise<boolean> {
  const r = await getDbForPatchStore().run(
    `UPDATE jobs SET status = ?, result = ?, error = ?, completed_at = ?
     WHERE id = ? AND status NOT IN ('completed','failed','cancelled','permanently_failed')`,
    [w.status, w.result ?? null, w.error ?? null, w.completed_at ?? Date.now(), jobId]
  );
  return (r.changes ?? 0) === 1;
}

/** Atomic claim of one queued patch Job; true = this caller won. */
export async function claimPatchJob(jobId: string, startedAt: number = Date.now()): Promise<boolean> {
  const r = await getDbForPatchStore().run(
    `UPDATE jobs SET status = 'in_progress', started_at = ? WHERE id = ? AND status = 'queued' AND kind = 'patch'`,
    [startedAt, jobId]
  );
  return (r.changes ?? 0) === 1;
}

/** Claim the oldest queued patch Job, or undefined if none. */
export async function claimNextPatchJob(startedAt: number = Date.now()): Promise<PersistedJob | undefined> {
  const db = getDbForPatchStore();
  for (let i = 0; i < 5; i++) {
    const next = await db.get<{ id: string }>(
      `SELECT id FROM jobs WHERE kind = 'patch' AND status = 'queued' ORDER BY created_at ASC, rowid ASC LIMIT 1`
    );
    if (!next) return undefined;
    if (await claimPatchJob(next.id, startedAt)) {
      return db.get<PersistedJob>('SELECT * FROM jobs WHERE id = ?', [next.id]);
    }
  }
  return undefined;
}

/** Requeue every in_progress patch Job; patch_state and retry_count are untouched. */
export async function recoverInProgressPatchJobs(): Promise<number> {
  const r = await getDbForPatchStore().run(
    `UPDATE jobs SET status = 'queued', started_at = NULL WHERE kind = 'patch' AND status = 'in_progress'`
  );
  return r.changes ?? 0;
}

export async function insertPatchAttempt(a: PatchAttemptRow): Promise<void> {
  await getDbForPatchStore().run(
    `INSERT INTO patch_attempts (job_id, n, model_id, provider_id, cost_class, prompt_tokens, completion_tokens,
       cost_usd, edit_blocks, outcome, apply_error, checks_json, duration_ms, started_at, ended_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [a.job_id, a.n, a.model_id, a.provider_id, a.cost_class, a.prompt_tokens, a.completion_tokens, a.cost_usd,
      a.edit_blocks, a.outcome, a.apply_error, a.checks_json, a.duration_ms, a.started_at, a.ended_at]
  );
}

export async function getPatchAttempts(jobId: string): Promise<PatchAttemptRow[]> {
  return getDbForPatchStore().all<PatchAttemptRow[]>(
    'SELECT * FROM patch_attempts WHERE job_id = ? ORDER BY n ASC, id ASC',
    [jobId]
  );
}
