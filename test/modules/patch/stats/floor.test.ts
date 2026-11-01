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
const { getSavings } = await import('../../../../dist/modules/patch/stats/index.js');
const { countTokens } = await import('../../../../dist/modules/utils/tokenCount.js');
const { seedPatchJob, patchResult, utcMs } = await import(path.resolve('test/modules/patch/stats/helpers.ts')) as {
  seedPatchJob: typeof seedPatchJobFn; patchResult: typeof patchResultFn; utcMs: typeof utcMsFn;
};

let dbPath = '';
let handle: Database;

beforeEach(async () => {
  dbPath = path.join(os.tmpdir(), `stats-floor-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
  process.env.JOB_DB_PATH = dbPath;
  await db.initJobStore();
  handle = db.getDbForPatchStore();
});

afterEach(async () => {
  await db.closeJobStore();
  delete process.env.JOB_DB_PATH;
  for (const f of [dbPath, `${dbPath}-wal`, `${dbPath}-shm`]) if (fs.existsSync(f)) fs.unlinkSync(f);
});

describe('stats per-task floor', () => {
  it('a passed Job whose agent tokens exceed the scaled tokens reports 0, not negative', async () => {
    const bigDiff = ' diff'.repeat(500);
    expect(countTokens(bigDiff)).toBe(500);

    await seedPatchJob(handle, {
      id: 'underwater', completed_at: utcMs('2026-10-15T01:00:00Z'), goal: '', task_type: 'floored',
      // accepted tokens 100 * factor 1 - 500 agent tokens = -400 -> floored to 0
      result: patchResult({ status: 'passed', diff: bigDiff }),
      attempts: [{ n: 1, cost_class: 'local', prompt_tokens: 60, completion_tokens: 40, outcome: 'passed' }],
    });
    await seedPatchJob(handle, {
      id: 'positive', completed_at: utcMs('2026-10-15T02:00:00Z'), goal: '', task_type: 'positive',
      result: patchResult({ status: 'passed' }),
      attempts: [{ n: 1, cost_class: 'local', prompt_tokens: 200, completion_tokens: 100, outcome: 'passed' }],
    });

    const byDay = await getSavings(handle, { factor: 1 });
    // The floor is per task, then summed: 0 + 300, never 300 - 400.
    expect(byDay.groups).toHaveLength(1);
    expect(byDay.groups[0].est_frontier_tokens_saved).toBe(300);
    expect(byDay.totals.est_frontier_tokens_saved).toBe(300);

    const byType = await getSavings(handle, { factor: 1, group_by: 'task_type' });
    const floored = byType.groups.find(g => g.key === 'floored');
    const positive = byType.groups.find(g => g.key === 'positive');
    expect(floored?.est_frontier_tokens_saved).toBe(0);
    expect(floored?.accepted).toBe(1);
    expect(positive?.est_frontier_tokens_saved).toBe(300);
  });
});
