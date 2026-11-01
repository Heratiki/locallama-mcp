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
const { getSavings, parseSince } = await import('../../../../dist/modules/patch/stats/index.js');
const { seedPatchJob, patchResult, utcMs } = await import(path.resolve('test/modules/patch/stats/helpers.ts')) as {
  seedPatchJob: typeof seedPatchJobFn; patchResult: typeof patchResultFn; utcMs: typeof utcMsFn;
};

let dbPath = '';
let handle: Database;

beforeEach(async () => {
  dbPath = path.join(os.tmpdir(), `stats-since-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
  process.env.JOB_DB_PATH = dbPath;
  await db.initJobStore();
  handle = db.getDbForPatchStore();
});

afterEach(async () => {
  await db.closeJobStore();
  delete process.env.JOB_DB_PATH;
  for (const f of [dbPath, `${dbPath}-wal`, `${dbPath}-shm`]) if (fs.existsSync(f)) fs.unlinkSync(f);
});

async function seedThreeDays(): Promise<void> {
  await seedPatchJob(handle, {
    id: 'd1', completed_at: utcMs('2026-10-01T00:00:00Z'), goal: '',
    result: patchResult({ status: 'passed', elapsed_ms: 100 }),
    attempts: [{ n: 1, cost_class: 'local', prompt_tokens: 100, completion_tokens: 0, cost_usd: 0, outcome: 'passed' }],
  });
  await seedPatchJob(handle, {
    id: 'd2', completed_at: utcMs('2026-10-02T12:00:00Z'), goal: '',
    result: patchResult({ status: 'passed', elapsed_ms: 200 }),
    attempts: [{ n: 1, cost_class: 'paid', prompt_tokens: 100, completion_tokens: 0, cost_usd: 0.01, outcome: 'passed' }],
  });
  await seedPatchJob(handle, {
    id: 'd3', completed_at: utcMs('2026-10-03T00:00:00Z'), goal: '', job_status: 'failed',
    result: patchResult({ status: 'failed', elapsed_ms: 300 }),
    attempts: [{ n: 1, cost_class: 'local', prompt_tokens: 100, completion_tokens: 0, outcome: 'check_failed' }],
  });
}

describe('stats since window', () => {
  it('an ISO date since excludes earlier Jobs', async () => {
    await seedThreeDays();
    const report = await getSavings(handle, { factor: 1, since: '2026-10-02' });
    expect(report.since).toBe(utcMs('2026-10-02T00:00:00Z'));
    expect(report.groups.map(g => g.key)).toEqual(['2026-10-02', '2026-10-03']);
    expect(report.totals.tasks).toBe(2);
    expect(report.totals.accepted).toBe(1);
    expect(report.totals.pass_rate).toBeCloseTo(0.5, 10);
    expect(report.totals.cost_usd).toBeCloseTo(0.01, 10);
    expect(report.totals.est_frontier_tokens_saved).toBe(100);
  });

  it('a unix ms since is accepted and behaves the same', async () => {
    await seedThreeDays();
    const report = await getSavings(handle, { factor: 1, since: utcMs('2026-10-02T12:00:00Z') });
    expect(report.since).toBe(utcMs('2026-10-02T12:00:00Z'));
    expect(report.totals.tasks).toBe(2);
    const asString = await getSavings(handle, { factor: 1, since: String(utcMs('2026-10-02T12:00:00Z')) });
    expect(asString.totals.tasks).toBe(2);
  });

  it('without since every finished Job counts', async () => {
    await seedThreeDays();
    const report = await getSavings(handle, { factor: 1 });
    expect(report.since).toBeNull();
    expect(report.totals.tasks).toBe(3);
  });

  it('an empty window returns zeros and pass_rate null', async () => {
    await seedThreeDays();
    const report = await getSavings(handle, { factor: 1, since: '2026-10-04' });
    expect(report.groups).toEqual([]);
    expect(report.totals).toEqual({
      tasks: 0,
      accepted: 0,
      pass_rate: null,
      cost_usd: 0,
      tokens: { local: 0, free: 0, paid: 0 },
      est_frontier_tokens_saved: 0,
      avg_elapsed_ms: null,
      factor: 1,
    });
  });

  it('an unparseable since is refused', async () => {
    await expect(getSavings(handle, { since: 'not-a-date' })).rejects.toThrow(/since/);
    expect(() => parseSince('not-a-date')).toThrow(/since/);
    expect(() => parseSince(Number.NaN)).toThrow(/since/);
    expect(parseSince(undefined)).toBeNull();
    expect(parseSince('1767225600000')).toBe(1767225600000);
  });
});
