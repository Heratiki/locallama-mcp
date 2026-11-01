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
const { seedPatchJob, patchResult, utcMs } = await import(path.resolve('test/modules/patch/stats/helpers.ts')) as {
  seedPatchJob: typeof seedPatchJobFn; patchResult: typeof patchResultFn; utcMs: typeof utcMsFn;
};

let dbPath = '';
let handle: Database;

beforeEach(async () => {
  dbPath = path.join(os.tmpdir(), `stats-group-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
  process.env.JOB_DB_PATH = dbPath;
  await db.initJobStore();
  handle = db.getDbForPatchStore();
});

afterEach(async () => {
  await db.closeJobStore();
  delete process.env.JOB_DB_PATH;
  for (const f of [dbPath, `${dbPath}-wal`, `${dbPath}-shm`]) if (fs.existsSync(f)) fs.unlinkSync(f);
});

describe('stats group_by', () => {
  it('group_by=day splits Jobs completed on two UTC dates at the midnight boundary', async () => {
    await seedPatchJob(handle, {
      id: 'late', completed_at: utcMs('2026-10-30T23:59:59Z'), goal: '',
      result: patchResult({ status: 'passed', elapsed_ms: 100 }),
      attempts: [{ n: 1, cost_class: 'local', prompt_tokens: 10, completion_tokens: 0, outcome: 'passed' }],
    });
    await seedPatchJob(handle, {
      id: 'early', completed_at: utcMs('2026-10-31T00:00:00Z'), goal: '',
      result: patchResult({ status: 'passed', elapsed_ms: 300 }),
      attempts: [{ n: 1, cost_class: 'local', prompt_tokens: 20, completion_tokens: 0, outcome: 'passed' }],
    });

    const report = await getSavings(handle, { factor: 1 });
    expect(report.group_by).toBe('day');
    expect(report.groups.map(g => g.key)).toEqual(['2026-10-30', '2026-10-31']);
    expect(report.groups.map(g => g.tasks)).toEqual([1, 1]);
    expect(report.groups[0].est_frontier_tokens_saved).toBe(10);
    expect(report.groups[1].est_frontier_tokens_saved).toBe(20);
    expect(report.groups[0].avg_elapsed_ms).toBe(100);
    expect(report.groups[1].avg_elapsed_ms).toBe(300);
    expect(report.totals.tasks).toBe(2);
    expect(report.totals.avg_elapsed_ms).toBe(200);
  });

  it('group_by=task_type groups by the stored task_type and defaults to "unspecified" (steward ruling 4)', async () => {
    await seedPatchJob(handle, {
      id: 'r1', completed_at: utcMs('2026-10-15T01:00:00Z'), goal: '', task_type: 'refactor',
      attempts: [{ n: 1, cost_class: 'local', prompt_tokens: 10, completion_tokens: 0, outcome: 'passed' }],
    });
    await seedPatchJob(handle, {
      id: 'b1', completed_at: utcMs('2026-10-15T02:00:00Z'), goal: '', task_type: 'bugfix', job_status: 'failed',
      result: patchResult({ status: 'failed' }),
      attempts: [{ n: 1, cost_class: 'local', prompt_tokens: 10, completion_tokens: 0, outcome: 'check_failed' }],
    });
    await seedPatchJob(handle, {
      id: 'u1', completed_at: utcMs('2026-10-15T03:00:00Z'), goal: '',
      attempts: [{ n: 1, cost_class: 'local', prompt_tokens: 10, completion_tokens: 0, outcome: 'passed' }],
    });

    const report = await getSavings(handle, { factor: 1, group_by: 'task_type' });
    expect(report.group_by).toBe('task_type');
    expect(report.groups.map(g => g.key)).toEqual(['bugfix', 'refactor', 'unspecified']);
    expect(report.groups.map(g => g.tasks)).toEqual([1, 1, 1]);
    const bugfix = report.groups[0];
    expect(bugfix.accepted).toBe(0);
    expect(bugfix.pass_rate).toBe(0);
    expect(bugfix.est_frontier_tokens_saved).toBe(0);
    expect(report.groups[1].accepted).toBe(1);
    expect(report.groups[1].pass_rate).toBe(1);
    expect(report.totals.tasks).toBe(3);
  });

  it('an unknown group_by is refused', async () => {
    await expect(getSavings(handle, { group_by: 'week' as never })).rejects.toThrow(/group_by/);
  });
});
