import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import type { Database } from 'sqlite';
import type {
  seedPatchJob as seedPatchJobFn, tableCounts as tableCountsFn, patchResult as patchResultFn, utcMs as utcMsFn,
} from '../patch/stats/helpers.js';

const mockConfig: Record<string, unknown> = {
  rootDir: os.tmpdir(), savingsTokenFactor: 1.0,
  openRouterApiKey: '', patchTasksEnabled: false, patchPaidCapUsd: 0.25,
};

jest.unstable_mockModule('../../../dist/config/index.js', () => ({ config: mockConfig }));
jest.unstable_mockModule('../../../dist/utils/logger.js', () => ({
  logger: { error: jest.fn(), warn: jest.fn(), info: jest.fn(), debug: jest.fn() },
}));
jest.unstable_mockModule('../../../dist/modules/core/provider/index.js', () => ({
  getProviderRegistry: () => ({ has: () => false }),
}));

const { toolDefinitionProvider } = await import('../../../dist/modules/api-integration/tool-definition/index.js');
const db = await import('../../../dist/modules/job-store/db.js');
const { getSavings } = await import('../../../dist/modules/patch/stats/index.js');
const { seedPatchJob, tableCounts, patchResult, utcMs } =
  await import(path.resolve('test/modules/patch/stats/helpers.ts')) as {
    seedPatchJob: typeof seedPatchJobFn; tableCounts: typeof tableCountsFn;
    patchResult: typeof patchResultFn; utcMs: typeof utcMsFn;
  };

const savingsTool = () => toolDefinitionProvider.getAvailableTools().find(t => t.name === 'get_savings');

let dbPath = '';
let handle: Database;

beforeEach(async () => {
  dbPath = path.join(os.tmpdir(), `get-savings-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
  process.env.JOB_DB_PATH = dbPath;
  await db.initJobStore();
  handle = db.getDbForPatchStore();
});

afterEach(async () => {
  await db.closeJobStore();
  delete process.env.JOB_DB_PATH;
  for (const f of [dbPath, `${dbPath}-wal`, `${dbPath}-shm`]) if (fs.existsSync(f)) fs.unlinkSync(f);
});

describe('get_savings tool definition', () => {
  it('is listed even while PATCH_TASKS_ENABLED is off (read-only report)', () => {
    expect(mockConfig.patchTasksEnabled).toBe(false);
    const tool = savingsTool();
    expect(tool).toBeDefined();
    const schema = tool!.inputSchema as { required: string[]; properties: Record<string, { type: string; enum?: string[] }> };
    expect(schema.required).toEqual([]);
    expect(Object.keys(schema.properties).sort()).toEqual(['group_by', 'since']);
    expect(schema.properties.group_by.enum).toEqual(['day', 'task_type']);
    expect(tool!.description).toMatch(/read-only/i);
  });

  it('the dispatch case in src/index.ts routes get_savings to the stats module', () => {
    const source = fs.readFileSync(path.resolve('src/index.ts'), 'utf8');
    expect(source).toMatch(/case 'get_savings':/);
    const dispatch = source.slice(source.indexOf(`case 'get_savings':`));
    expect(dispatch.slice(0, dispatch.indexOf('case ', 10))).toMatch(/modules\/patch\/stats\/index\.js/);
    expect(dispatch.slice(0, dispatch.indexOf('case ', 10))).toMatch(/getSavings\(/);
  });
});

describe('get_savings dispatch behaviour', () => {
  it('returns the savings structure and performs no writes', async () => {
    await seedPatchJob(handle, {
      id: 'ok', completed_at: utcMs('2026-10-15T01:00:00Z'), goal: '', task_type: 'refactor',
      result: patchResult({ status: 'passed', elapsed_ms: 1200 }),
      attempts: [
        { n: 1, cost_class: 'local', prompt_tokens: 100, completion_tokens: 50, outcome: 'check_failed' },
        { n: 2, cost_class: 'free', prompt_tokens: 200, completion_tokens: 100, outcome: 'passed' },
      ],
    });
    await seedPatchJob(handle, {
      id: 'bad', completed_at: utcMs('2026-10-15T02:00:00Z'), goal: '', job_status: 'failed',
      result: patchResult({ status: 'failed', elapsed_ms: 800 }),
      attempts: [{ n: 1, cost_class: 'paid', prompt_tokens: 40, completion_tokens: 10, cost_usd: 0.02, outcome: 'call_error' }],
    });

    const before = await tableCounts(handle);
    // Exactly what the dispatch case in src/index.ts does for `get_savings`.
    const args: Record<string, unknown> = { since: '2026-10-01', group_by: 'task_type' };
    const report = await getSavings(handle, {
      since: args.since as string | undefined,
      group_by: args.group_by as 'day' | 'task_type' | undefined,
    });
    const after = await tableCounts(handle);
    expect(after).toEqual(before);

    expect(Object.keys(report).sort()).toEqual(['group_by', 'groups', 'since', 'totals']);
    expect(report.group_by).toBe('task_type');
    expect(report.since).toBe(utcMs('2026-10-01T00:00:00Z'));
    expect(Object.keys(report.totals).sort()).toEqual([
      'accepted', 'avg_elapsed_ms', 'cost_usd', 'est_frontier_tokens_saved', 'factor', 'pass_rate', 'tasks', 'tokens',
    ]);
    expect(report.totals.tasks).toBe(2);
    expect(report.totals.accepted).toBe(1);
    expect(report.totals.pass_rate).toBeCloseTo(0.5, 10);
    expect(report.totals.cost_usd).toBeCloseTo(0.02, 10);
    expect(report.totals.tokens).toEqual({ local: 150, free: 300, paid: 50 });
    expect(report.totals.est_frontier_tokens_saved).toBe(300);
    expect(report.totals.avg_elapsed_ms).toBe(1000);
    expect(report.totals.factor).toBe(1.0);
    expect(report.groups.map(g => g.key)).toEqual(['refactor', 'unspecified']);
    for (const group of report.groups) {
      expect(Object.keys(group).sort()).toEqual([
        'accepted', 'avg_elapsed_ms', 'cost_usd', 'est_frontier_tokens_saved', 'factor', 'key',
        'pass_rate', 'tasks', 'tokens',
      ]);
    }
  });
});
