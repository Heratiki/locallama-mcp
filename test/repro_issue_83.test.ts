import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import { 
  initJobStore, 
  closeJobStore, 
  insertTask, 
  updateJob as dbUpdateJob
} from '../dist/modules/job-store/db.js';
import { JobTracker } from '../dist/modules/decision-engine/services/jobTracker.js';
import { Router } from '../dist/modules/api-integration/routing/index.js';
import * as fs from 'fs';
import * as path from 'path';
import { v4 as uuidv4 } from 'uuid';

describe('Issue #83 Regression: get_task_status staleness', () => {
  const DB_PATH = path.join(process.cwd(), 'data', 'test-jobs-83.db');
  let router: Router;

  beforeEach(async () => {
    if (fs.existsSync(DB_PATH)) fs.unlinkSync(DB_PATH);
    process.env.JOB_DB_PATH = DB_PATH;
    await initJobStore();
    router = new Router();
  });

  afterEach(async () => {
    await closeJobStore();
    if (fs.existsSync(DB_PATH)) fs.unlinkSync(DB_PATH);
    delete process.env.JOB_DB_PATH;
  });

  it('should reflect terminal job state immediately in getTaskStatus', async () => {
    const taskId = uuidv4();
    const now = Date.now();

    // 1. Setup task and job in DB as in_progress
    await insertTask({
      id: taskId,
      status: 'in_progress',
      job_count: 1,
      completed_count: 0,
      failed_count: 0,
      created_at: now
    });

    await dbUpdateJob({
      id: taskId,
      status: 'in_progress',
      progress_pct: 1,
      poll_again_after_ms: 15000,
      queue_position: 1
    } as any); 
    // Note: we need to insert the job first if updateJob fails on missing row.
    // In our real flow, createJob (which calls insertJob) happens first.
    
    const tracker = await JobTracker.getInstance();
    await tracker.createJob(taskId, 'test task');
    await dbUpdateJob({
      id: taskId,
      status: 'in_progress',
      progress_pct: 1,
      poll_again_after_ms: 15000,
      queue_position: 1
    } as any);

    // 2. Verify getTaskStatus says in_progress
    let status = await router.getTaskStatus(taskId);
    expect(status.status).toBe('in_progress');
    expect(status.poll_again_after_ms).toBe(15000);

    // 3. Complete the job via tracker
    await tracker.completeJob(taskId, ['result']);

    // 4. Verify getTaskStatus says completed immediately
    status = await router.getTaskStatus(taskId);
    expect(status.status).toBe('completed');
    expect(status.poll_again_after_ms).toBe(0);
    expect(status.jobs[0].progress_pct).toBe(100);
  });
});
