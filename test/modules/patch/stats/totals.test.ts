import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import type { Database } from 'sqlite';
import type {
  seedPatchJob as seedPatchJobFn, tableCounts as tableCountsFn, patchResult as patchResultFn, utcMs as utcMsFn,
} from './helpers.js';

jest.unstable_mockModule('../../../../dist/config/index.js', () => ({
  config: { rootDir: os.tmpdir(), savingsTokenFactor: 1.0 },
}));
jest.unstable_mockModule('../../../../dist/utils/logger.js', () => ({
  logger: { error: jest.fn(), warn: jest.fn(), info: jest.fn(), debug: jest.fn() },
}));

const db = await import('../../../../dist/modules/job-store/db.js');
const { getSavings } = await import('../../../../dist/modules/patch/stats/index.js');
const helpers = await import(path.resolve('test/modules/patch/stats/helpers.ts')) as {
  seedPatchJob: typeof seedPatchJobFn; tableCounts: typeof tableCountsFn;
  patchResult: typeof patchResultFn; utcMs: typeof utcMsFn;
};
const { seedPatchJob, patchResult, utcMs } = helpers;

let dbPath = '';
let handle: Database;

beforeEach(async () => {
  dbPath = path.join(os.tmpdir(), `stats-totals-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
  process.env.JOB_DB_PATH = dbPath;
  await db.initJobStore();
  handle = db.getDbForPatchStore();
});

afterEach(async () => {
  await db.closeJobStore();
  delete process.env.JOB_DB_PATH;
  for (const f of [dbPath, `${dbPath}-wal`, `${dbPath}-shm`]) if (fs.existsSync(f)) fs.unlinkSync(f);
});

describe('stats totals', () => {
  it('3 finished patch Jobs (2 passed, 1 failed): accepted, pass_rate, cost_usd and tokens by cost_class are the hand-computed sums', async () => {
    // Hand-computed fixture (all Jobs completed on 2026-10-15 UTC):
    //   j1 passed: local attempt 100+50 (check_failed), free attempt 200+100 (passed)  -> accepted tokens 300
    //   j2 passed: paid attempt 300+100 cost 0.05 (passed)                            -> accepted tokens 400
    //   j3 failed: local attempt 10+5, paid attempt 40+10 cost 0.02
    // accepted = 2, pass_rate = 2/3
    // cost_usd = 0 + 0.05 + 0.02 = 0.07
    // tokens.local = 150 + 15 = 165, tokens.free = 300, tokens.paid = 400 + 50 = 450
    // est (factor 1, goal '' and diff '' so agent tokens = 0) = 300 + 400 + 0 = 700
    // avg_elapsed_ms = (1000 + 2000 + 3000) / 3 = 2000
    await seedPatchJob(handle, {
      id: 'j1', completed_at: utcMs('2026-10-15T01:00:00Z'), goal: '',
      result: patchResult({ status: 'passed', elapsed_ms: 1000 }),
      attempts: [
        { n: 1, cost_class: 'local', prompt_tokens: 100, completion_tokens: 50, outcome: 'check_failed' },
        { n: 2, cost_class: 'free', prompt_tokens: 200, completion_tokens: 100, outcome: 'passed' },
      ],
    });
    await seedPatchJob(handle, {
      id: 'j2', completed_at: utcMs('2026-10-15T02:00:00Z'), goal: '',
      result: patchResult({ status: 'passed', elapsed_ms: 2000 }),
      attempts: [
        { n: 1, cost_class: 'paid', prompt_tokens: 300, completion_tokens: 100, cost_usd: 0.05, outcome: 'passed' },
      ],
    });
    await seedPatchJob(handle, {
      id: 'j3', completed_at: utcMs('2026-10-15T03:00:00Z'), goal: '', job_status: 'failed',
      result: patchResult({ status: 'failed', elapsed_ms: 3000 }),
      attempts: [
        { n: 1, cost_class: 'local', prompt_tokens: 10, completion_tokens: 5, outcome: 'check_failed' },
        { n: 2, cost_class: 'paid', prompt_tokens: 40, completion_tokens: 10, cost_usd: 0.02, outcome: 'call_error' },
      ],
    });
    // A non-patch job and an unfinished patch job must not be counted.
    await handle.run(
      `INSERT INTO jobs (id, task_id, status, task_text, created_at, completed_at) VALUES
       ('route1', 't', 'completed', 'x', 1, 2)`
    );
    await seedPatchJob(handle, { id: 'j4', completed_at: utcMs('2026-10-15T04:00:00Z'), job_status: 'in_progress' });
    await handle.run(`UPDATE jobs SET completed_at = NULL WHERE id = 'j4'`);

    const report = await getSavings(handle, { factor: 1 });

    expect(report.group_by).toBe('day');
    expect(report.since).toBeNull();
    expect(report.groups).toHaveLength(1);
    const g = report.groups[0];
    expect(g.key).toBe('2026-10-15');
    expect(g.tasks).toBe(3);
    expect(g.accepted).toBe(2);
    expect(g.pass_rate).toBeCloseTo(2 / 3, 10);
    expect(g.cost_usd).toBeCloseTo(0.07, 10);
    expect(g.tokens).toEqual({ local: 165, free: 300, paid: 450 });
    expect(g.est_frontier_tokens_saved).toBe(700);
    expect(g.avg_elapsed_ms).toBe(2000);
    expect(g.factor).toBe(1);
    const { key: _key, ...totalsShape } = g;
    expect(report.totals).toEqual(totalsShape);
  });
});
