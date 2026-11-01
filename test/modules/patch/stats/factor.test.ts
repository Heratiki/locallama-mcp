import { afterAll, afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import type { Database } from 'sqlite';
import type {
  seedPatchJob as seedPatchJobFn, patchResult as patchResultFn, utcMs as utcMsFn,
} from './helpers.js';

const { seedPatchJob, patchResult, utcMs } = await import(path.resolve('test/modules/patch/stats/helpers.ts')) as {
  seedPatchJob: typeof seedPatchJobFn; patchResult: typeof patchResultFn; utcMs: typeof utcMsFn;
};

type DbModule = typeof import('../../../../dist/modules/job-store/db.js');
type StatsModule = typeof import('../../../../dist/modules/patch/stats/index.js');
type ConfigModule = typeof import('../../../../dist/config/index.js');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'stats-factor-'));
const savedEnv: Record<string, string | undefined> = {
  SAVINGS_TOKEN_FACTOR: process.env.SAVINGS_TOKEN_FACTOR,
  JOB_DB_PATH: process.env.JOB_DB_PATH,
  LOCALLAMA_ROOT_DIR: process.env.LOCALLAMA_ROOT_DIR,
};
let dbPath = '';
let dbMod: DbModule | null = null;
let counter = 0;

beforeEach(() => {
  jest.resetModules();
  delete process.env.SAVINGS_TOKEN_FACTOR;
  process.env.LOCALLAMA_ROOT_DIR = root;
  dbPath = path.join(root, `jobs-${counter++}.db`);
  process.env.JOB_DB_PATH = dbPath;
});

afterEach(async () => {
  if (dbMod) {
    await dbMod.closeJobStore();
    dbMod = null;
  }
});

afterAll(() => {
  for (const [key, value] of Object.entries(savedEnv)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  fs.rmSync(root, { recursive: true, force: true });
});

/** Fresh module registry so SAVINGS_TOKEN_FACTOR is re-read from process.env. */
async function fresh(): Promise<{ config: ConfigModule['config']; db: Database; stats: StatsModule }> {
  const { config } = await import('../../../../dist/config/index.js');
  dbMod = await import('../../../../dist/modules/job-store/db.js');
  const stats = await import('../../../../dist/modules/patch/stats/index.js');
  await dbMod.initJobStore();
  return { config, db: dbMod.getDbForPatchStore(), stats };
}

async function seedPassed(db: Database): Promise<void> {
  await seedPatchJob(db, {
    id: 'p1', completed_at: utcMs('2026-10-15T01:00:00Z'), goal: '',
    result: patchResult({ status: 'passed' }),
    attempts: [{ n: 1, cost_class: 'local', prompt_tokens: 300, completion_tokens: 0, outcome: 'passed' }],
  });
}

describe('SAVINGS_TOKEN_FACTOR', () => {
  it('defaults to 1.0 and drives the estimate when the env var is unset', async () => {
    const { config, db, stats } = await fresh();
    expect(config.savingsTokenFactor).toBe(1.0);
    await seedPassed(db);
    const report = await stats.getSavings(db, {});
    expect(report.totals.factor).toBe(1.0);
    expect(report.totals.est_frontier_tokens_saved).toBe(300);
  });

  it('SAVINGS_TOKEN_FACTOR=2.5 in the env changes the result', async () => {
    process.env.SAVINGS_TOKEN_FACTOR = '2.5';
    const { config, db, stats } = await fresh();
    expect(config.savingsTokenFactor).toBe(2.5);
    await seedPassed(db);
    const report = await stats.getSavings(db, {});
    expect(report.totals.factor).toBe(2.5);
    expect(report.totals.est_frontier_tokens_saved).toBe(750);
  });

  it('an invalid SAVINGS_TOKEN_FACTOR fails loudly at config read', async () => {
    for (const bad of ['abc', '0', '-1', 'Infinity']) {
      jest.resetModules();
      process.env.SAVINGS_TOKEN_FACTOR = bad;
      await expect(import('../../../../dist/config/index.js')).rejects.toThrow(/SAVINGS_TOKEN_FACTOR/);
    }
  });
});
