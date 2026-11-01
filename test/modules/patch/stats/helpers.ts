/**
 * Shared seeding helpers for the get_savings stats tests (#152 G1).
 *
 * Tests import this file at runtime through an absolute path
 * (`await import(path.resolve('test/modules/patch/stats/helpers.ts'))`),
 * the same pattern `test/config/patch-config.test.ts` uses for `src/config`,
 * because jest does not map `./helpers.js` specifiers to `.ts` files here.
 *
 * All inserts are raw SQL against a freshly initialized temp jobs.db so the
 * helpers never depend on which copy (fresh or cached) of the job-store
 * module a test file loaded.
 */
import type { Database } from 'sqlite';

export interface SeedAttempt {
  n: number;
  cost_class?: string | null;
  prompt_tokens?: number | null;
  completion_tokens?: number | null;
  cost_usd?: number | null;
  outcome?: string | null;
}

export interface SeedJob {
  id: string;
  /** Unix ms; the stats module groups days by the UTC date of this value. */
  completed_at: number;
  created_at?: number;
  /** jobs.status; default 'completed'. */
  job_status?: string;
  /** Raw jobs.result JSON; default a passed patch_result_v1. */
  result?: string | null;
  goal?: string;
  file_hints?: string[];
  task_type?: string;
  attempts?: SeedAttempt[];
}

/** A complete patch_result_v1 envelope (PRD 01 §5.1) as a JSON string. */
export function patchResult(over: Partial<{
  status: 'passed' | 'failed' | 'cancelled';
  reason: string;
  diff: string;
  elapsed_ms: number;
  cost_usd: number;
  tokens: { local: number; free: number; paid: number };
}> = {}): string {
  const status = over.status ?? 'passed';
  return JSON.stringify({
    schema: 'patch_result_v1',
    status,
    reason: over.reason ?? (status === 'passed' ? 'passed' : 'budget_attempts'),
    diff: over.diff ?? '',
    base: 'abc123',
    files_changed: [],
    checks: [],
    attempts: 0,
    models: [],
    tokens: over.tokens ?? { local: 0, free: 0, paid: 0 },
    cost_usd: over.cost_usd ?? 0,
    elapsed_ms: over.elapsed_ms ?? 0,
    diagnosis: null,
  });
}

/** Insert one finished patch Job with its patch_state and patch_attempts rows. */
export async function seedPatchJob(db: Database, o: SeedJob): Promise<void> {
  const request: Record<string, unknown> = {
    goal: o.goal ?? 'goal',
    repo_path: '/repo',
    file_hints: o.file_hints ?? [],
    allow_paid: false,
    paid_cap_usd: 0,
    validate: false,
  };
  if (o.task_type !== undefined) request.task_type = o.task_type;
  await db.run(
    `INSERT INTO jobs (id, task_id, status, task_text, result, error, progress_pct, retry_count,
       created_at, completed_at, kind)
     VALUES (?, ?, ?, ?, ?, NULL, 100, 0, ?, ?, 'patch')`,
    [
      o.id, `task-${o.id}`, o.job_status ?? 'completed', o.goal ?? 'goal',
      o.result !== undefined ? o.result : patchResult({ status: 'passed' }),
      o.created_at ?? o.completed_at - 1000, o.completed_at,
    ]
  );
  await db.run(
    `INSERT INTO patch_state (job_id, request_json, base_commit, checks_json, ladder_json, settings_json,
       deadline_at, cursor_model, attempts_used, paid_spent_usd, paid_reserved_usd, updated_at)
     VALUES (?, ?, 'abc123', '[]', '[]', '{}', 0, 0, 0, 0, 0, 1)`,
    [o.id, JSON.stringify(request)]
  );
  for (const a of o.attempts ?? []) {
    await db.run(
      `INSERT INTO patch_attempts (job_id, n, model_id, provider_id, cost_class, prompt_tokens,
         completion_tokens, cost_usd, edit_blocks, outcome, apply_error, checks_json, duration_ms,
         started_at, ended_at)
       VALUES (?, ?, 'm', 'p', ?, ?, ?, ?, '[]', ?, NULL, '[]', 1, 1, 2)`,
      [o.id, a.n, a.cost_class ?? 'local', a.prompt_tokens ?? 0, a.completion_tokens ?? 0,
        a.cost_usd ?? 0, a.outcome ?? null]
    );
  }
}

/** Row counts of every table get_savings reads; used by the no-writes check. */
export async function tableCounts(db: Database): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  for (const table of ['jobs', 'tasks', 'patch_state', 'patch_attempts']) {
    const row = await db.get<{ c: number }>(`SELECT COUNT(*) AS c FROM ${table}`);
    out[table] = row?.c ?? -1;
  }
  return out;
}

/** Fixed UTC timestamp for deterministic day grouping. */
export const utcMs = (iso: string): number => Date.parse(iso);
