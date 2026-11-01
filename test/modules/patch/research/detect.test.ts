import { describe, expect, it } from '@jest/globals';
import { detectStuck } from '../../../../dist/modules/patch/research/detect.js';
import type { CheckResult } from '../../../../src/modules/patch/types.js';

const check = (name: string, tail: string): CheckResult => ({
  name, exit_code: 1, timed_out: false, duration_ms: 1, tail,
});

describe('detectStuck (#155 criterion 2)', () => {
  it('is stuck when two consecutive attempts repeat the same failing check and normalized signature', () => {
    const attempts = [
      { outcome: 'check_failed', applyError: null, checks: [check('tsc', `src/a.ts(10,5): error TS2339: Property 'foo' does not exist on type 'Bar'.`)] },
      { outcome: 'check_failed', applyError: null, checks: [check('tsc', `src/a.ts(11,5): error TS2339: Property 'foo' does not exist on type 'Bar'.`)] },
    ];
    const stuck = detectStuck(attempts);
    expect(stuck).not.toBeNull();
    expect(stuck!.reason).toBe('same_check:tsc');
    expect(stuck!.signature).toContain('TS2339');
  });

  it('normalizes paths, line numbers, hex and timestamps before comparing', () => {
    const attempts = [
      { outcome: 'check_failed', applyError: null, checks: [check('unit', '/home/heratiki/repo/src/a.ts:12:1 boom 2026-11-01T10:00:00Z deadbeefdeadbeef')] },
      { outcome: 'check_failed', applyError: null, checks: [check('unit', '/home/heratiki/repo/src/other.ts:99:8 boom 2026-11-02T11:30:00Z cafebabecafebabe')] },
    ];
    expect(detectStuck(attempts)).not.toBeNull();
  });

  it('is not stuck with a single failure', () => {
    const attempts = [
      { outcome: 'passed', applyError: null, checks: [] },
      { outcome: 'check_failed', applyError: null, checks: [check('tsc', 'error TS2339')] },
    ];
    expect(detectStuck(attempts)).toBeNull();
  });

  it('is not stuck when the two errors differ', () => {
    const attempts = [
      { outcome: 'check_failed', applyError: null, checks: [check('unit', 'expected value THREE')] },
      { outcome: 'check_failed', applyError: null, checks: [check('unit', 'expected value FOUR')] },
    ];
    expect(detectStuck(attempts)).toBeNull();
  });

  it('is not stuck when the failing check names differ', () => {
    const attempts = [
      { outcome: 'check_failed', applyError: null, checks: [check('tsc', 'error TS2339: nope')] },
      { outcome: 'check_failed', applyError: null, checks: [check('lint', 'error TS2339: nope')] },
    ];
    expect(detectStuck(attempts)).toBeNull();
  });

  it('is stuck when an edit block fails to apply twice in a row', () => {
    const attempts = [
      { outcome: 'apply_error', applyError: 'a.ts\nSEARCH text not found', checks: [] },
      { outcome: 'apply_error', applyError: 'b.ts\nmatches 2 places', checks: [] },
    ];
    const stuck = detectStuck(attempts);
    expect(stuck).not.toBeNull();
    expect(stuck!.reason).toBe('apply_error_repeated');
    expect(stuck!.errorText).toContain('matches 2 places');
  });

  it('is not stuck when an apply error follows a check failure', () => {
    const attempts = [
      { outcome: 'check_failed', applyError: null, checks: [check('tsc', 'error TS2339')] },
      { outcome: 'apply_error', applyError: 'a.ts\nSEARCH text not found', checks: [] },
    ];
    expect(detectStuck(attempts)).toBeNull();
  });

  it('uses only the last two attempts', () => {
    const attempts = [
      { outcome: 'check_failed', applyError: null, checks: [check('unit', 'same error')] },
      { outcome: 'passed', applyError: null, checks: [] },
      { outcome: 'check_failed', applyError: null, checks: [check('unit', 'same error')] },
    ];
    expect(detectStuck(attempts)).toBeNull();
  });
});
