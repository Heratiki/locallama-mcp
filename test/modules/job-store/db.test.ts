import { afterEach, describe, expect, it, jest } from '@jest/globals';
import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs';

// We use JOB_DB_PATH env var to point each test to a unique temp file.
// The mock for config is still needed so that the module-level default path
// calculation doesn't blow up, but JOB_DB_PATH takes precedence.
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

// Import after mocks are registered
const { initJobStore, closeJobStore, insertJob, updateJob, getJob, getAllJobs, getActiveJobs, deleteOldJobs } =
  await import('../../../dist/modules/job-store/db.js');

let currentDbPath = '';

/** Make a minimal valid PersistedJob for testing. */
const makeJob = (id: string, status: string = 'queued') => ({
  id,
  task_id: id,
  status: status as import('../../../dist/modules/job-store/types.js').JobStatus,
  provider_id: null,
  model_id: null,
  task_text: `Task for ${id}`,
  result: null,
  error: null,
  queue_position: null,
  progress_pct: 0,
  poll_again_after_ms: null,
  retry_count: 0,
  created_at: Date.now() - 1000, // 1s ago to ensure deleteOldJobs(0) catches it
  started_at: null,
  completed_at: null
});

/** Reset the singleton and delete the temp file after each test. */
afterEach(async () => {
  await closeJobStore();
  if (currentDbPath && fs.existsSync(currentDbPath)) {
    try {
      fs.unlinkSync(currentDbPath);
    } catch {
      // Ignore on Windows if it is still briefly locked
    }
  }
  delete process.env.JOB_DB_PATH;
});

describe('job-store db', () => {
  it('should persist a job and retrieve it after re-initialisation', async () => {
    currentDbPath = path.join(os.tmpdir(), `jobs-persist-${Date.now()}.db`);
    process.env.JOB_DB_PATH = currentDbPath;

    await initJobStore();

    const job = makeJob('persist-test-1');
    await insertJob(job);

    const found = await getJob('persist-test-1');
    expect(found).toBeDefined();
    expect(found?.id).toBe('persist-test-1');
    expect(found?.task_text).toBe('Task for persist-test-1');
    expect(found?.status).toBe('queued');
  });

  it('should correctly transition status: queued → in_progress → completed', async () => {
    currentDbPath = path.join(os.tmpdir(), `jobs-transition-${Date.now()}.db`);
    process.env.JOB_DB_PATH = currentDbPath;

    await initJobStore();

    const job = makeJob('transition-test-1');
    await insertJob(job);

    // Verify queued
    let found = await getJob('transition-test-1');
    expect(found?.status).toBe('queued');

    // Transition to in_progress
    await updateJob({ id: 'transition-test-1', status: 'in_progress', progress_pct: 50 });
    found = await getJob('transition-test-1');
    expect(found?.status).toBe('in_progress');
    expect(found?.progress_pct).toBe(50);

    // Transition to completed
    const completedAt = Date.now();
    await updateJob({ id: 'transition-test-1', status: 'completed', progress_pct: 100, completed_at: completedAt });
    found = await getJob('transition-test-1');
    expect(found?.status).toBe('completed');
    expect(found?.progress_pct).toBe(100);
    expect(found?.completed_at).toBe(completedAt);
  });

  it('should remove completed and cancelled jobs with deleteOldJobs(0) but keep queued and in_progress', async () => {
    currentDbPath = path.join(os.tmpdir(), `jobs-cleanup-${Date.now()}.db`);
    process.env.JOB_DB_PATH = currentDbPath;

    await initJobStore();

    await insertJob(makeJob('job-queued', 'queued'));
    await insertJob(makeJob('job-in-progress', 'in_progress'));
    await insertJob(makeJob('job-completed', 'completed'));
    await insertJob(makeJob('job-cancelled', 'cancelled'));

    // maxAgeMs=0 means "everything created before now" qualifies for deletion
    await deleteOldJobs(0);

    const all = await getAllJobs();
    const ids = all.map(j => j.id);

    expect(ids).toContain('job-queued');
    expect(ids).toContain('job-in-progress');
    expect(ids).not.toContain('job-completed');
    expect(ids).not.toContain('job-cancelled');

    // getActiveJobs returns only queued + in_progress
    const active = await getActiveJobs();
    const activeIds = active.map(j => j.id);
    expect(activeIds).toContain('job-queued');
    expect(activeIds).toContain('job-in-progress');
    expect(activeIds.length).toBe(2);
  });
});
