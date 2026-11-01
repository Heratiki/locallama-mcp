import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs';
import sqlite3 from 'sqlite3';

jest.unstable_mockModule('../../../dist/config/index.js', () => ({
  config: { rootDir: os.tmpdir() }
}));
jest.unstable_mockModule('../../../dist/utils/logger.js', () => ({
  logger: { error: jest.fn(), warn: jest.fn(), info: jest.fn(), debug: jest.fn() }
}));

const db = await import('../../../dist/modules/job-store/db.js');
const store = await import('../../../dist/modules/job-store/patch-store.js');
const { recoverInProgressJobs } = await import('../../../dist/modules/job-store/recovery.js');

let dbPath = '';

const makeState = (jobId: string, over: Record<string, unknown> = {}) => ({
  job_id: jobId,
  request_json: '{"task":"x"}',
  base_commit: 'abc123',
  checks_json: '[]',
  ladder_json: '[]',
  settings_json: '{}',
  deadline_at: 5000,
  cursor_model: 0,
  attempts_used: 0,
  paid_spent_usd: 0,
  paid_reserved_usd: 0,
  updated_at: 1,
  ...over,
});

const makeJob = (id: string, over: Record<string, unknown> = {}) => ({
  id,
  task_id: `task-${id}`,
  status: 'queued' as const,
  provider_id: null,
  model_id: null,
  task_text: 'patch',
  result: null,
  error: null,
  queue_position: null,
  is_local: null,
  progress_pct: 0,
  poll_again_after_ms: null,
  retry_count: 0,
  created_at: Date.now(),
  started_at: null,
  completed_at: null,
  ...over,
});

const makeTask = (id: string) => ({
  id: `task-${id}`, status: 'queued' as const, job_count: 1, completed_count: 0, failed_count: 0, created_at: 1,
});

const submit = (id: string, createdAt = Date.now()) =>
  store.submitPatchJob(makeTask(id), makeJob(id, { created_at: createdAt }), makeState(id));

beforeEach(() => {
  dbPath = path.join(os.tmpdir(), `patch-store-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
  process.env.JOB_DB_PATH = dbPath;
});

afterEach(async () => {
  await db.closeJobStore();
  delete process.env.JOB_DB_PATH;
  for (const f of [dbPath, `${dbPath}-wal`, `${dbPath}-shm`]) if (fs.existsSync(f)) fs.unlinkSync(f);
});

describe('patch-store', () => {
  it('migrates an old jobs.db additively and route jobs behave as before', async () => {
    const old = new sqlite3.Database(dbPath);
    await new Promise<void>((res, rej) => old.exec(`
      CREATE TABLE jobs (id TEXT PRIMARY KEY, task_id TEXT NOT NULL, status TEXT NOT NULL, provider_id TEXT,
        model_id TEXT, task_text TEXT NOT NULL, result TEXT, error TEXT, queue_position INTEGER, is_local INTEGER,
        progress_pct INTEGER NOT NULL DEFAULT 0, poll_again_after_ms INTEGER, retry_count INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL, started_at INTEGER, completed_at INTEGER);
      CREATE TABLE tasks (id TEXT PRIMARY KEY, status TEXT NOT NULL, job_count INTEGER NOT NULL DEFAULT 0,
        completed_count INTEGER NOT NULL DEFAULT 0, failed_count INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL);
      INSERT INTO jobs (id, task_id, status, task_text, created_at) VALUES ('old1','t','queued','hi',1);
    `, (e) => (e ? rej(e) : res())));
    await new Promise<void>((res) => old.close(() => res()));

    await db.initJobStore();
    const j = await db.getJob('old1');
    expect(j?.id).toBe('old1');
    expect(j?.kind ?? null).toBeNull();
    const raw = await db.getDbOrNull();
    const tables = await raw!.all<{ name: string }[]>(`SELECT name FROM sqlite_master WHERE type='table'`);
    expect(tables.map((t) => t.name)).toEqual(expect.arrayContaining(['patch_state', 'patch_attempts']));
  });

  it('submit writes task, job and patch_state atomically', async () => {
    await db.initJobStore();
    await submit('a');
    expect((await db.getJob('a'))?.kind).toBe('patch');
    expect((await db.getTask('task-a'))?.id).toBe('task-a');
    expect((await store.getPatchState('a'))?.base_commit).toBe('abc123');
  });

  it('submit rolls back everything when the patch_state write fails', async () => {
    await db.initJobStore();
    await expect(
      store.submitPatchJob(makeTask('b'), makeJob('b'), makeState('b', { request_json: null }))
    ).rejects.toThrow();
    expect(await db.getJob('b')).toBeUndefined();
    expect(await db.getTask('task-b')).toBeUndefined();
    expect(await store.getPatchState('b')).toBeUndefined();
  });

  it('a late terminal write after cancelled changes nothing', async () => {
    await db.initJobStore();
    await submit('c');
    expect(await store.finishPatchJob('c', { status: 'cancelled', completed_at: 10 })).toBe(true);
    expect(await store.finishPatchJob('c', { status: 'completed', result: 'late', completed_at: 20 })).toBe(false);
    const j = await db.getJob('c');
    expect(j?.status).toBe('cancelled');
    expect(j?.result).toBeNull();
    expect(j?.completed_at).toBe(10);
  });

  it('claim has exactly one winner and never claims a cancelled job', async () => {
    await db.initJobStore();
    await submit('d');
    const [r1, r2] = await Promise.all([store.claimPatchJob('d'), store.claimPatchJob('d')]);
    expect([r1, r2].filter(Boolean)).toHaveLength(1);
    expect((await db.getJob('d'))?.status).toBe('in_progress');

    await submit('e');
    await store.finishPatchJob('e', { status: 'cancelled', completed_at: 1 });
    expect(await store.claimPatchJob('e')).toBe(false);
    expect(await store.claimNextPatchJob()).toBeUndefined();
  });

  it('claimNextPatchJob takes the oldest queued patch job and skips route jobs', async () => {
    await db.initJobStore();
    await db.insertJob(makeJob('route1', { created_at: 1 }) as never);
    await submit('p2', 200);
    await submit('p1', 100);
    expect((await store.claimNextPatchJob())?.id).toBe('p1');
    expect((await store.claimNextPatchJob())?.id).toBe('p2');
    expect(await store.claimNextPatchJob()).toBeUndefined();
    expect((await db.getJob('route1'))?.status).toBe('queued');
  });

  it('recovery requeues in_progress patch jobs with patch_state unchanged; recoverInProgressJobs skips them', async () => {
    await db.initJobStore();
    await submit('f');
    await store.claimPatchJob('f');
    await store.recordAttemptStart('f', { cursor_model: 2, attempts_used: 3, updated_at: 99 });
    await db.insertJob(makeJob('r', { status: 'in_progress' }) as never);
    const before = await store.getPatchState('f');

    const res = await recoverInProgressJobs();
    expect(res.recovering).toBe(1);
    expect((await db.getJob('f'))?.status).toBe('in_progress');
    expect((await db.getJob('f'))?.retry_count).toBe(0);

    expect(await store.recoverInProgressPatchJobs()).toBe(1);
    const j = await db.getJob('f');
    expect(j?.status).toBe('queued');
    expect(j?.retry_count).toBe(0);
    const after = await store.getPatchState('f');
    expect(after).toEqual(before);
    expect(after).toMatchObject({ base_commit: 'abc123', cursor_model: 2, attempts_used: 3, deadline_at: 5000 });
  });

  it('patch_attempts rows insert and read back all columns', async () => {
    await db.initJobStore();
    await submit('g');
    const row = {
      job_id: 'g', n: 1, model_id: 'm', provider_id: 'p', cost_class: 'paid', prompt_tokens: 10,
      completion_tokens: 20, cost_usd: 0.5, edit_blocks: '[{"path":"a"}]', outcome: 'apply_error',
      apply_error: 'no match', checks_json: '[]', duration_ms: 42, started_at: 1, ended_at: 2,
    };
    await store.insertPatchAttempt(row);
    const rows = await store.getPatchAttempts('g');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject(row);
    expect(typeof rows[0].id).toBe('number');
  });
});
