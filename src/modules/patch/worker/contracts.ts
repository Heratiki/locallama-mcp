import { config } from '../../../config/index.js';
import type { PatchResultV1, LadderEntry, EditBlock } from '../types.js';

/** settings_json uses the existing config key names, resolved at submission. */
export interface WorkerSettings {
  patchMaxAttempts: number;
  patchAttemptsPerModel: number;
  patchMaxOutputTokens: number;
  patchContextTokens: number;
  patchInferenceTimeoutMs: number;
  patchCheckTimeoutMs: number;
  patchErrorTailTokens: number;
  patchWholeFileMaxLines: number;
  patchPaidCapUsd: number;
  patchKeepWorkspaceOnFail: boolean;
  openRouterFreeOnly: boolean;
}

export interface PatchRequest {
  goal: string;
  repo_path: string;
  file_hints?: string[];
  allow_paid?: boolean;
  paid_cap_usd?: number;
  validate?: boolean;
}

export interface CallUsage {
  model_id: string;
  provider_id: string;
  cost_class: LadderEntry['cost_class'];
  prompt_tokens: number;
  completion_tokens: number;
  cost_usd: number;
}

export interface PatchValidation {
  model_id: string;
  provider_id: string;
  passed: boolean | null;
  skipped: boolean;
  reason: string;
}

/** Additive validator details; the shared patch_result_v1 fields are unchanged. */
export interface WorkerResult extends PatchResultV1 {
  validation: PatchValidation[];
}

/** Worker-owned encoding in patch_attempts.edit_blocks (also reads legacy arrays). */
export interface AttemptDetails {
  blocks: EditBlock[];
  calls: CallUsage[];
  validation?: PatchValidation;
  diff: string;
  files: string[];
}

export function resolveWorkerSettings(json: string): WorkerSettings {
  const stored = JSON.parse(json) as Partial<WorkerSettings>;
  const settings: WorkerSettings = {
    patchMaxAttempts: stored.patchMaxAttempts ?? config.patchMaxAttempts,
    patchAttemptsPerModel: stored.patchAttemptsPerModel ?? config.patchAttemptsPerModel,
    patchMaxOutputTokens: stored.patchMaxOutputTokens ?? config.patchMaxOutputTokens,
    patchContextTokens: stored.patchContextTokens ?? config.patchContextTokens,
    patchInferenceTimeoutMs: stored.patchInferenceTimeoutMs ?? config.patchInferenceTimeoutMs,
    patchCheckTimeoutMs: stored.patchCheckTimeoutMs ?? config.patchCheckTimeoutMs,
    patchErrorTailTokens: stored.patchErrorTailTokens ?? config.patchErrorTailTokens,
    patchWholeFileMaxLines: stored.patchWholeFileMaxLines ?? config.patchWholeFileMaxLines,
    patchPaidCapUsd: stored.patchPaidCapUsd ?? config.patchPaidCapUsd,
    patchKeepWorkspaceOnFail: stored.patchKeepWorkspaceOnFail ?? config.patchKeepWorkspaceOnFail,
    openRouterFreeOnly: stored.openRouterFreeOnly ?? config.openRouterFreeOnly,
  };
  for (const [key, value] of Object.entries(settings)) {
    if (typeof value === 'boolean') continue;
    if (!Number.isFinite(value) || value < 0) throw new Error(`Invalid patch setting: ${key}`);
    if (key !== 'patchPaidCapUsd' && !Number.isSafeInteger(value)) throw new Error(`Invalid patch setting: ${key}`);
  }
  if (settings.patchAttemptsPerModel === 0 || settings.patchInferenceTimeoutMs === 0 || settings.patchCheckTimeoutMs === 0) {
    throw new Error('Patch attempt and timeout settings must be positive');
  }
  return settings;
}

export class WorkerStop extends Error {
  constructor(readonly reason: 'budget_time' | 'cancelled' | 'paid_cap') { super(reason); }
}

export class InferenceTimeout extends Error {
  constructor() { super('Patch inference timed out'); }
}
