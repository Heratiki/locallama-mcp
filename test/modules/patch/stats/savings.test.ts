import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import type { Database } from 'sqlite';
import type {
  seedPatchJob as seedPatchJobFn, patchResult as patchResultFn, utcMs as utcMsFn,
} from './helpers.js';

jest.unstable_mockModule('../../../../dist/config/index.js', () => ({
  config: { rootDir: os.tmpdir(), savingsTokenFactor: 1.0 },
}));
jest.unstable_mockModule('../../../../dist/utils/logger.js', () => ({
  logger: { error: jest.fn(), warn: jest.fn(), info: jest.fn(), debug: jest.fn() },
}));

const db = await import('../../../../dist/modules/job-store/db.js');
const { getSavings, estimateSaved } = await import('../../../../dist/modules/patch/stats/index.js');
const { countTokens } = await import('../../../../dist/modules/utils/tokenCount.js');
const { seedPatchJob, patchResult, utcMs } = await import(path.resolve('test/modules/patch/stats/helpers.ts')) as {
  seedPatchJob: typeof seedPatchJobFn; patchResult: typeof patchResultFn; utcMs: typeof utcMsFn;
};

let dbPath = '';
let handle: Database;

beforeEach(async () => {
  dbPath = path.join(os.tmpdir(), `stats-savings-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
  process.env.JOB_DB_PATH = dbPath;
  await db.initJobStore();
  handle = db.getDbForPatchStore();
});

afterEach(async () => {
  await db.closeJobStore();
  delete process.env.JOB_DB_PATH;
  for (const f of [dbPath, `${dbPath}-wal`, `${dbPath}-shm`]) if (fs.existsSync(f)) fs.unlinkSync(f);
});

describe('stats savings estimate', () => {
  it('accepted tokens 1000, factor 2.0, request 100 + diff 200 tokens -> 1700; a failed Job adds 0', async () => {
    const requestText = ' token'.repeat(100);
    const diffText = ' diff'.repeat(200);
    // Guard the fixture: the hand-computed numbers below assume exactly 100/200 tokens.
    expect(countTokens(requestText)).toBe(100);
    expect(countTokens(diffText)).toBe(200);

    await seedPatchJob(handle, {
      id: 'passed1', completed_at: utcMs('2026-10-15T01:00:00Z'), goal: requestText,
      result: patchResult({ status: 'passed', diff: diffText, elapsed_ms: 1000 }),
      attempts: [
        { n: 1, cost_class: 'local', prompt_tokens: 600, completion_tokens: 400, outcome: 'passed' },
      ],
    });
    await seedPatchJob(handle, {
      id: 'failed1', completed_at: utcMs('2026-10-15T02:00:00Z'), goal: requestText, job_status: 'failed',
      result: patchResult({ status: 'failed', elapsed_ms: 500 }),
      attempts: [
        { n: 1, cost_class: 'local', prompt_tokens: 500, completion_tokens: 500, outcome: 'check_failed' },
      ],
    });

    const report = await getSavings(handle, { factor: 2.0 });

    // 1000 * 2.0 - (100 request + 200 diff) = 1700; the failed Job contributes 0.
    expect(report.totals.est_frontier_tokens_saved).toBe(1700);
    expect(report.totals.tasks).toBe(2);
    expect(report.totals.accepted).toBe(1);
    expect(report.totals.factor).toBe(2.0);
    expect(report.groups).toHaveLength(1);
    expect(report.groups[0].est_frontier_tokens_saved).toBe(1700);
  });

  it('estimateSaved is pure: scaled tokens minus agent tokens, floored at 0', () => {
    expect(estimateSaved(1000, 2.0, 300)).toBe(1700);
    expect(estimateSaved(100, 1.0, 500)).toBe(0);
    expect(estimateSaved(0, 1.0, 0)).toBe(0);
  });

  it('only the accepted (outcome=passed) attempt counts toward the saved estimate', async () => {
    await seedPatchJob(handle, {
      id: 'multi', completed_at: utcMs('2026-10-15T01:00:00Z'), goal: '',
      result: patchResult({ status: 'passed' }),
      attempts: [
        { n: 1, cost_class: 'local', prompt_tokens: 900, completion_tokens: 900, outcome: 'check_failed' },
        { n: 2, cost_class: 'free', prompt_tokens: 60, completion_tokens: 40, outcome: 'passed' },
      ],
    });
    const report = await getSavings(handle, { factor: 1 });
    // Only the 100 tokens of the passed attempt count, not the 1800 of the failed one.
    expect(report.totals.est_frontier_tokens_saved).toBe(100);
    // But the token report still sums every attempt by cost_class.
    expect(report.totals.tokens).toEqual({ local: 1800, free: 100, paid: 0 });
  });
});
