import type { CheckResult } from '../types.js';
import { errorSignature } from '../ladder/policy.js';
import { normalizeSignatureText } from './redact.js';

/** What detectStuck needs from one persisted attempt row. */
export interface StuckAttempt {
  outcome: string | null;
  applyError: string | null;
  checks: CheckResult[];
}

export interface StuckResult {
  /** Stuck rule that fired: 'apply_error_repeated' or 'same_check:<name>'. */
  reason: string;
  /** Normalized error signature of the last attempt (paths, lines, hex, times stripped). */
  signature: string;
  /** Raw error text of the last attempt; query building redacts it before use. */
  errorText: string;
}

const failedCheck = (checks: CheckResult[]): CheckResult | undefined =>
  checks.find(c => c.timed_out || c.exit_code !== 0);

function signatureOf(attempt: StuckAttempt): string | null {
  const check = errorSignature(attempt.checks);
  if (check) return check;
  if (attempt.applyError) return `${attempt.outcome}\n${attempt.applyError.split('\n')[0]}`;
  return attempt.outcome ?? null;
}

function errorTextOf(attempt: StuckAttempt): string {
  const failed = failedCheck(attempt.checks);
  return [failed ? `${failed.name}\n${failed.tail}` : '', attempt.applyError ?? '']
    .filter(Boolean).join('\n');
}

/**
 * Stuck detection (#155 ruling 2, criterion 2): stuck when two consecutive
 * attempts have the same failing check name and the same normalized error
 * signature, or an edit block fails to apply twice in a row. One failure, or
 * two different errors, is not stuck.
 */
export function detectStuck(attempts: StuckAttempt[]): StuckResult | null {
  if (attempts.length < 2) return null;
  const prev = attempts[attempts.length - 2];
  const last = attempts[attempts.length - 1];
  const lastSig = signatureOf(last);
  if (!lastSig) return null;
  const errorText = errorTextOf(last);
  if (prev.outcome === 'apply_error' && last.outcome === 'apply_error') {
    return { reason: 'apply_error_repeated', signature: normalizeSignatureText(lastSig), errorText };
  }
  const prevSig = signatureOf(prev);
  const prevCheck = failedCheck(prev.checks)?.name;
  const lastCheck = failedCheck(last.checks)?.name;
  if (prevSig && prevCheck && lastCheck && prevCheck === lastCheck &&
      normalizeSignatureText(prevSig) === normalizeSignatureText(lastSig)) {
    return { reason: `same_check:${lastCheck}`, signature: normalizeSignatureText(lastSig), errorText };
  }
  return null;
}
