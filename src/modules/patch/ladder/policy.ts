import type { CheckResult, LadderEntry } from '../types.js';

/** Check name + first error line of a failed check; null when nothing failed. */
export function errorSignature(checks: CheckResult[]): string | null {
  const failed = checks.find(c => c.timed_out || c.exit_code !== 0);
  if (!failed) return null;
  const first = failed.tail.split(/\r?\n/).map(l => l.trim()).find(l => l !== '') ?? '';
  return `${failed.name}\n${first}`;
}

/** Move on early when this attempt repeats the last attempt's signature. */
export function sameSignature(prev: string | null | undefined, cur: string | null | undefined): boolean {
  return prev != null && cur != null && prev === cur;
}

export type StopReason = 'budget_attempts' | 'budget_time' | 'ladder_exhausted' | 'cancelled';

export interface StopInput {
  attemptsUsed: number;
  maxAttempts: number;
  now: number;
  deadlineAt: number;
  cursorModel: number;
  ladderLength: number;
  cancelled: boolean;
}

/** Stop reason before the next attempt, or null to go on (pass and paid cap are decided elsewhere). */
export function stopReason(i: StopInput): StopReason | null {
  if (i.cancelled) return 'cancelled';
  if (i.now >= i.deadlineAt) return 'budget_time';
  if (i.attemptsUsed >= i.maxAttempts) return 'budget_attempts';
  if (i.cursorModel >= i.ladderLength) return 'ladder_exhausted';
  return null;
}

/** Deadline in unix ms: submit time + max_minutes, else + the task timeout. */
export function computeDeadline(submitMs: number, taskTimeoutMs: number, maxMinutes?: number): number {
  return submitMs + (maxMinutes && maxMinutes > 0 ? maxMinutes * 60_000 : taskTimeoutMs);
}

/** Cursor advance after an attempt: next model when its attempts are used up or the signature repeated. */
export function nextCursor(
  cursor: number, attemptsOnModel: number, attemptsPerModel: number, repeated: boolean,
): { cursor: number; attemptsOnModel: number } {
  if (repeated || attemptsOnModel >= attemptsPerModel) return { cursor: cursor + 1, attemptsOnModel: 0 };
  return { cursor, attemptsOnModel };
}

/** Family guess from the model id: leading letters of the last path segment. */
export function defaultFamily(modelId: string): string {
  const base = (modelId.split('/').pop() ?? modelId).toLowerCase();
  return base.match(/^[a-z]+/)?.[0] ?? base;
}

/**
 * Validator pick (PRD 5.9): the next ladder model after `cursor` of a different
 * family when one exists, else the same model.
 */
export function pickValidator(
  ladder: LadderEntry[],
  cursor: number,
  familyOf: (e: LadderEntry) => string | undefined = e => defaultFamily(e.model_id),
): LadderEntry {
  const current = ladder[cursor];
  const fam = familyOf(current);
  for (let i = cursor + 1; i < ladder.length; i++) {
    const f = familyOf(ladder[i]);
    if (f !== undefined && fam !== undefined && f !== fam) return ladder[i];
  }
  return current;
}

/** A free provider with no rate budget now is skipped at call time (no wait). */
export function hasBudgetNow(provider: { hasRateLimitBudget?: () => boolean }): boolean {
  return provider.hasRateLimitBudget ? provider.hasRateLimitBudget() : true;
}
