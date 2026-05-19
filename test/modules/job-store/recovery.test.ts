import { afterEach, describe, expect, it, jest } from '@jest/globals';
import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs';

jest.unstable_mockModule('../../../dist/config/index.js', () => ({
  config: {
    rootDir: os.tmpdir()
  }
}));

jest.unstable_mockModule('../../../dist/utils/logger.js', () => ({
  logger: {
    error: jest.fn(),
    warn: jest.fn(),
    info: jest.fn(),
    debug: jest.fn()
  }
}));

const { initJobStore, closeJobStore, insertJob, getJob } =
  await import('../../../dist/modules/job-store/db.js');
const { recoverInProgressJobs } =
  await import('../../../dist/modules/job-store/recovery.js');
const { refreshAlertState, isAlertActive } =
  await import('../../../dist/modules/job-store/alert.js');

let currentDbPath = '';

function uniqueDbPath(): string {
  return path.join(os.tmpdir(), `recovery-test-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
}

function makeJob(id: string, status: string, retryCount: number) {
  const now = Date.now();
  return {
    id,
    task_id: id,
    status,
    provider_id: null,
    model_id: null,
    task_text: 'test task',
    result: null,
    error: null,
    queue_position: null,
    progress_pct: 0,
    poll_again_after_ms: null,
    retry_count: retryCount,
    created_at: now,
    started_at: now,
    completed_at: null,
  };
}

afterEach(async () => {
  await closeJobStore();
  if (currentDbPath && fs.existsSync(currentDbPath)) {
    fs.unlinkSync(currentDbPath);
  }
  currentDbPath = '';
});

describe('recoverInProgressJobs', () => {
  it('re-queues in_progress job with retry_count=0', async () => {
    currentDbPath = uniqueDbPath();
    process.env.JOB_DB_PATH = currentDbPath;
    await initJobStore();
    await insertJob(makeJob('job-1', 'in_progress', 0) as Parameters<typeof insertJob>[0]);

    const result = await recoverInProgressJobs();

    expect(result).toEqual({ recovering: 1, permanentlyFailed: 0 });
    const updated = await getJob('job-1');
    expect(updated?.status).toBe('queued');
    expect(updated?.retry_count).toBe(1);
  });

  it('permanently fails in_progress job with retry_count=1', async () => {
    currentDbPath = uniqueDbPath();
    process.env.JOB_DB_PATH = currentDbPath;
    await initJobStore();
    await insertJob(makeJob('job-2', 'in_progress', 1) as Parameters<typeof insertJob>[0]);

    const result = await recoverInProgressJobs();

    expect(result).toEqual({ recovering: 0, permanentlyFailed: 1 });
    const updated = await getJob('job-2');
    expect(updated?.status).toBe('permanently_failed');
  });
});

describe('isAlertActive after refreshAlertState', () => {
  it('returns false when no failed jobs', async () => {
    currentDbPath = uniqueDbPath();
    process.env.JOB_DB_PATH = currentDbPath;
    await initJobStore();

    await refreshAlertState();

    expect(isAlertActive()).toBe(false);
  });

  it('returns true after inserting a failed job and refreshing', async () => {
    currentDbPath = uniqueDbPath();
    process.env.JOB_DB_PATH = currentDbPath;
    await initJobStore();
    await insertJob(makeJob('job-3', 'failed', 0) as Parameters<typeof insertJob>[0]);

    await refreshAlertState();

    expect(isAlertActive()).toBe(true);
  });
});
