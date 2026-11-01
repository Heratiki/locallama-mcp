import type { Database } from 'sqlite';
import { config } from '../../../config/index.js';
import { countTokens } from '../../utils/tokenCount.js';

/**
 * G1 savings report (issue #152): one read-only MCP read over jobs.db giving
 * accepted patch tasks, pass rate, dollars spent and estimated frontier tokens
 * saved, per UTC day or per task type.
 *
 * This module NEVER writes: every statement below is a SELECT. Inputs are the
 * patch tables from PRD 01 §5.12 (`jobs` with kind='patch', `patch_state`,
 * `patch_attempts`) plus the `patch_result_v1` JSON in `jobs.result`.
 */

export type SavingsGroupBy = 'day' | 'task_type';

export interface SavingsOptions {
  /** ISO date string or unix ms (number or digit string); null/undefined = all time. */
  since?: string | number | null;
  /** Default 'day' (UTC date of the Job's completed_at). */
  group_by?: SavingsGroupBy;
  /** Overrides SAVINGS_TOKEN_FACTOR (config.savingsTokenFactor); must be > 0. */
  factor?: number;
}

export interface SavingsTokens {
  local: number;
  free: number;
  paid: number;
}

export interface SavingsStats {
  /** Patch Jobs finished (terminal, with completed_at) in the window. */
  tasks: number;
  /** Jobs whose patch_result_v1.status is 'passed' (steward ruling 3 on #152). */
  accepted: number;
  /** accepted / tasks; null when tasks is 0. */
  pass_rate: number | null;
  /** Sum of patch_attempts.cost_usd over every attempt of every finished Job. */
  cost_usd: number;
  /** Sum of prompt + completion tokens by cost_class over every attempt. */
  tokens: SavingsTokens;
  /** Sum over accepted Jobs of estimateSaved(...), floored at 0 per task. */
  est_frontier_tokens_saved: number;
  /** Mean of patch_result_v1.elapsed_ms; null when no finished Job has one. */
  avg_elapsed_ms: number | null;
  /** The factor used for est_frontier_tokens_saved. */
  factor: number;
}

export interface SavingsGroup extends SavingsStats {
  /** UTC day (YYYY-MM-DD) or task_type value ('unspecified' when absent). */
  key: string;
}

export interface SavingsReport {
  group_by: SavingsGroupBy;
  /** Resolved unix ms of the window start; null = all time. */
  since: number | null;
  groups: SavingsGroup[];
  totals: SavingsStats;
}

/** Job statuses that mean "finished"; matches PatchTerminalWrite plus cancelled. */
const FINISHED_STATUSES = ['completed', 'failed', 'cancelled', 'permanently_failed'];

interface JobRow {
  job_id: string;
  job_status: string;
  completed_at: number;
  result: string | null;
  request_json: string | null;
}

interface AttemptRow {
  job_id: string;
  n: number;
  outcome: string | null;
  cost_class: string | null;
  tokens: number;
  cost_usd: number;
}

interface PerJob {
  key: string;
  accepted: boolean;
  cost_usd: number;
  tokens: SavingsTokens;
  saved: number;
  elapsed_ms: number | null;
}

/**
 * Pure savings estimate for one accepted task (roadmap Ruling 6): the accepted
 * attempt's small-model tokens times the factor, minus the agent's request and
 * review tokens, floored at 0 (a task never reports negative savings).
 */
export function estimateSaved(acceptedTokens: number, factor: number, agentTokens: number): number {
  return Math.max(0, Math.round(acceptedTokens * factor - agentTokens));
}

/** Parse the optional `since` input: ISO date/timestamp or unix ms. null = all time. */
export function parseSince(value: unknown): number | null {
  if (value === undefined || value === null) return null;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error('since must be a finite unix ms number');
    return Math.trunc(value);
  }
  if (typeof value === 'string') {
    const text = value.trim();
    if (!text) return null;
    if (/^\d+$/.test(text)) return Number(text);
    const ms = Date.parse(text);
    if (Number.isNaN(ms)) throw new Error(`since must be an ISO date or unix ms, got "${value}"`);
    return ms;
  }
  throw new Error('since must be an ISO date string or a unix ms number');
}

/** UTC day (YYYY-MM-DD) of a unix ms timestamp. */
export function utcDay(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

function round6(n: number): number {
  return Math.round(n * 1e6) / 1e6;
}

/**
 * Agent tokens (steward ruling 2 on #152): countTokens of the request text
 * (goal + file hints from patch_state.request_json) plus countTokens of the
 * returned diff (the agent reads the diff once).
 */
export function agentTokensOf(requestJson: string | null, diff: string): number {
  let text = '';
  if (requestJson) {
    try {
      const request = JSON.parse(requestJson) as { goal?: unknown; file_hints?: unknown };
      const goal = typeof request.goal === 'string' ? request.goal : '';
      const hints = Array.isArray(request.file_hints)
        ? request.file_hints.filter((h): h is string => typeof h === 'string')
        : [];
      text = [goal, ...hints].join('\n');
    } catch {
      text = '';
    }
  }
  return countTokens(text) + countTokens(diff);
}

/** task_type from patch_state.request_json; 'unspecified' when absent (steward ruling 4). */
export function taskTypeOf(requestJson: string | null): string {
  if (requestJson) {
    try {
      const request = JSON.parse(requestJson) as { task_type?: unknown };
      if (typeof request.task_type === 'string' && request.task_type.trim()) return request.task_type;
    } catch {
      // Unparseable request: fall through to the default.
    }
  }
  return 'unspecified';
}

function statsOf(jobs: PerJob[], factor: number): SavingsStats {
  const tasks = jobs.length;
  const accepted = jobs.filter(j => j.accepted).length;
  const elapsed = jobs.map(j => j.elapsed_ms).filter((v): v is number => v !== null);
  return {
    tasks,
    accepted,
    pass_rate: tasks > 0 ? accepted / tasks : null,
    cost_usd: round6(jobs.reduce((s, j) => s + j.cost_usd, 0)),
    tokens: {
      local: jobs.reduce((s, j) => s + j.tokens.local, 0),
      free: jobs.reduce((s, j) => s + j.tokens.free, 0),
      paid: jobs.reduce((s, j) => s + j.tokens.paid, 0),
    },
    est_frontier_tokens_saved: jobs.reduce((s, j) => s + j.saved, 0),
    avg_elapsed_ms: elapsed.length > 0
      ? Math.round(elapsed.reduce((s, v) => s + v, 0) / elapsed.length)
      : null,
    factor,
  };
}

/**
 * Build the savings report. Read-only over jobs.db: `db` comes from
 * getDbForPatchStore() (src/modules/job-store/db.ts).
 */
export async function getSavings(db: Database, opts: SavingsOptions = {}): Promise<SavingsReport> {
  const groupBy = opts.group_by ?? 'day';
  if (groupBy !== 'day' && groupBy !== 'task_type') {
    throw new Error(`group_by must be "day" or "task_type", got "${String(opts.group_by)}"`);
  }
  const since = parseSince(opts.since);
  const factor = opts.factor ?? config.savingsTokenFactor;
  if (typeof factor !== 'number' || !Number.isFinite(factor) || factor <= 0) {
    throw new Error(`SAVINGS_TOKEN_FACTOR must be a finite number > 0, got "${String(factor)}"`);
  }

  const statuses = FINISHED_STATUSES.map(s => `'${s}'`).join(', ');
  const where =
    `j.kind = 'patch' AND j.status IN (${statuses}) AND j.completed_at IS NOT NULL` +
    (since !== null ? ' AND j.completed_at >= ?' : '');
  const params = since !== null ? [since] : [];

  const jobRows = await db.all<JobRow[]>(
    `SELECT j.id AS job_id, j.status AS job_status, j.completed_at AS completed_at,
            j.result AS result, ps.request_json AS request_json
       FROM jobs j
       LEFT JOIN patch_state ps ON ps.job_id = j.id
      WHERE ${where}
      ORDER BY j.completed_at ASC, j.id ASC`,
    params
  );
  const attemptRows = await db.all<AttemptRow[]>(
    `SELECT pa.job_id AS job_id, pa.n AS n, pa.outcome AS outcome, pa.cost_class AS cost_class,
            COALESCE(pa.prompt_tokens, 0) + COALESCE(pa.completion_tokens, 0) AS tokens,
            COALESCE(pa.cost_usd, 0) AS cost_usd
       FROM patch_attempts pa
       JOIN jobs j ON j.id = pa.job_id
      WHERE ${where}
      ORDER BY pa.job_id ASC, pa.n ASC, pa.id ASC`,
    params
  );

  // Per-Job attempt aggregates; rows arrive ordered by n, so the last
  // outcome='passed' row is the accepted attempt.
  const byJob = new Map<string, { tokens: SavingsTokens; cost: number; acceptedTokens: number | null }>();
  for (const a of attemptRows) {
    let entry = byJob.get(a.job_id);
    if (!entry) {
      entry = { tokens: { local: 0, free: 0, paid: 0 }, cost: 0, acceptedTokens: null };
      byJob.set(a.job_id, entry);
    }
    if (a.cost_class === 'local' || a.cost_class === 'free' || a.cost_class === 'paid') {
      entry.tokens[a.cost_class] += a.tokens;
    }
    entry.cost += a.cost_usd;
    if (a.outcome === 'passed') entry.acceptedTokens = a.tokens;
  }

  const jobs: PerJob[] = jobRows.map(row => {
    const agg = byJob.get(row.job_id) ?? { tokens: { local: 0, free: 0, paid: 0 }, cost: 0, acceptedTokens: null };
    let status: string | null = null;
    let diff = '';
    let elapsed: number | null = null;
    if (row.result) {
      try {
        const parsed = JSON.parse(row.result) as { status?: unknown; diff?: unknown; elapsed_ms?: unknown };
        if (typeof parsed.status === 'string') status = parsed.status;
        if (typeof parsed.diff === 'string') diff = parsed.diff;
        if (typeof parsed.elapsed_ms === 'number' && Number.isFinite(parsed.elapsed_ms)) elapsed = parsed.elapsed_ms;
      } catch {
        // Unparseable result: the Job still counts as finished, just not accepted.
      }
    }
    const accepted = status === 'passed';
    return {
      key: groupBy === 'day' ? utcDay(row.completed_at) : taskTypeOf(row.request_json),
      accepted,
      cost_usd: agg.cost,
      tokens: agg.tokens,
      saved: accepted
        ? estimateSaved(agg.acceptedTokens ?? 0, factor, agentTokensOf(row.request_json, diff))
        : 0,
      elapsed_ms: elapsed,
    };
  });

  const grouped = new Map<string, PerJob[]>();
  for (const job of jobs) {
    const list = grouped.get(job.key);
    if (list) list.push(job);
    else grouped.set(job.key, [job]);
  }
  const sortedKeys = [...grouped.keys()].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));

  return {
    group_by: groupBy,
    since,
    groups: sortedKeys.map(key => ({ key, ...statsOf(grouped.get(key)!, factor) })),
    totals: statsOf(jobs, factor),
  };
}
