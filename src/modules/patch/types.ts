import type { CostClass } from '../core/provider/types.js';

/** A scratch workspace rooted at path, isolated from the source repository. */
export interface Workspace {
  path: string;
  repoPath: string;
  base: string;
  jobId: string;
  /** Repo-relative dependency links excluded from reset, edits and diff. */
  links: string[];
}

/** Worker-facing seam; a base is an immutable snapshot identifier. */
export interface WorkspaceBackend {
  snapshot(repoPath: string, hints: string[], jobId: string): Promise<string>;
  create(base: string, jobId: string): Promise<Workspace>;
  reset(ws: Workspace): Promise<void>;
  diff(ws: Workspace): Promise<string>;
  dispose(ws: Workspace): Promise<void>;
}

export interface EditBlock {
  /** Path relative to the workspace. */
  path: string;
  search: string;
  replace: string;
  /** Whole-file fallback: replace is the complete file content. */
  whole_file?: boolean;
}

export interface CheckSpec {
  name: string;
  argv: string[];
  timeout_ms?: number;
  append_changed_files?: boolean;
}

export interface CheckResult {
  name: string;
  /** Null when the process exits without a numeric code (for example, a signal). */
  exit_code: number | null;
  timed_out: boolean;
  duration_ms: number;
  tail: string;
}

/** Snapshot's .locallama/checks.json; omitted links use backend defaults. */
export interface ChecksConfig {
  checks: CheckSpec[];
  links?: string[];
  env_allow?: string[];
}

/** Persisted patch_state row. JSON columns contain serialized resolved values. */
export interface PatchState {
  job_id: string;
  request_json: string;
  base_commit: string;
  checks_json: string;
  ladder_json: string;
  settings_json: string;
  /** Unix milliseconds, consistent with the Job store. */
  deadline_at: number;
  cursor_model: number;
  attempts_used: number;
  paid_spent_usd: number;
  paid_reserved_usd: number;
  updated_at: number;
}

/** Prices are USD per token, matching provider getCost(). Paid prices must be known. */
export type LadderEntry = {
  model_id: string;
  provider_id: string;
} & (
  | { cost_class: 'local' | 'free'; prompt_price?: never; completion_price?: never }
  | { cost_class: 'paid'; prompt_price: number; completion_price: number }
);

export type AttemptOutcome =
  | 'apply_error'
  | 'check_failed'
  | 'validator_rejected'
  | 'timed_out'
  | 'call_error';

export interface PatchDiagnosis {
  last_errors: string;
  best_diff: string;
  attempts: {
    model_id: string;
    provider_id: string;
    outcome: AttemptOutcome;
    duration_ms: number;
    /** Research record when this attempt used harness research (#155). */
    research?: ResearchRecord;
  }[];
}

/** Research sources (#155 ruling 1 and 3): local first, SearXNG only when configured. */
export type ResearchSourceKind = 'searxng' | 'repo' | 'deps' | 'pydoc' | 'go doc' | 'man';

export type ResearchSourceStatus = 'ran' | 'skipped' | 'timed_out' | 'error';

/** One source execution within a stuck-event research run. */
export interface ResearchSourceRun {
  source: ResearchSourceKind;
  query: string;
  status: ResearchSourceStatus;
  /** Skip reason ('tool_missing', 'no node_modules', …) or error detail. */
  detail?: string;
  /** Bounded, redacted text that entered the research block. */
  info?: string;
}

/**
 * Harness research record (#155), stored in the using attempt's meta JSON and
 * the task result. All fields are redacted before they are stored or sent.
 */
export interface ResearchRecord {
  schema: 'patch_research_v1';
  /** Stuck rule that fired plus the normalized, redacted error signature. */
  reason: string;
  /** Queries as sent (redacted, capped, deterministic). */
  queries: string[];
  /** Every source that ran, was skipped or timed out. */
  sources: ResearchSourceRun[];
  /** The bounded text block added to the next attempt's prompt. */
  block: string;
  /** Helped note reused through the BM25 notes index, when one matched. */
  reusedNoteId?: number;
  /** New note IDs whose complete info survived assembly and prompt fitting. */
  usedNoteIds?: number[];
}

/** Exact Job result JSON envelope from PRD 01 §5.1. */
export interface PatchResultV1 {
  schema: 'patch_result_v1';
  status: 'passed' | 'failed' | 'cancelled';
  reason:
    | 'passed'
    | 'no_checks'
    | 'budget_attempts'
    | 'budget_time'
    | 'ladder_exhausted'
    | 'paid_cap'
    | 'cancelled'
    | 'snapshot_failed'
    | 'internal_error';
  /** Unified diff; empty unless passed. */
  diff: string;
  base: string;
  files_changed: string[];
  checks: CheckResult[];
  attempts: number;
  models: {
    model_id: string;
    provider_id: string;
    cost_class: CostClass;
    attempts: number;
  }[];
  tokens: { local: number; free: number; paid: number };
  cost_usd: number;
  elapsed_ms: number;
  diagnosis: PatchDiagnosis | null;
  /** Research records used by attempts, in order (#155). Absent when research never ran. */
  research?: ResearchRecord[];
}
