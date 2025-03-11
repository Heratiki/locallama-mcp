import { jobTracker } from '../../../../src/modules/decision-engine/services/jobTracker.js';
import { apiHandlers } from '../../../../src/modules/decision-engine/services/apiHandlers.js';

describe('Job Tracker', () => {
  beforeEach(() => {
    // Reset jobs before each test
    jobTracker['activeJobs'].clear();
  });

  test('creates and tracks a new job', () => {
    const jobId = jobTracker.createJob('test_123', 'Test task');
    const job = jobTracker.getJob(jobId);
    expect(job).toBeDefined();
    expect(job?.status).toBe('Queued');
    expect(job?.progress).toBe('Pending');
  });

  test('updates job progress', () => {
    const jobId = jobTracker.createJob('test_123', 'Test task');
    jobTracker.updateJobProgress(jobId, 50, 60000);
    const job = jobTracker.getJob(jobId);
    expect(job?.status).toBe('In Progress');
    expect(job?.progress).toBe('50%');
    expect(job?.estimated_time_remaining).toBe('1 minutes');
  });

  test('completes a job', () => {
    const jobId = jobTracker.createJob('test_123', 'Test task');
    jobTracker.completeJob(jobId);
    const job = jobTracker.getJob(jobId);
    expect(job?.status).toBe('Completed');
    expect(job?.progress).toBe('100%');
  });

  test('cancels a job', () => {
    const jobId = jobTracker.createJob('test_123', 'Test task');
    jobTracker.cancelJob(jobId);
    const job = jobTracker.getJob(jobId);
    expect(job?.status).toBe('Cancelled');
  });

  test('cleans up completed jobs', () => {
    const jobId1 = jobTracker.createJob('test_123', 'Test task 1');
    const jobId2 = jobTracker.createJob('test_456', 'Test task 2');
    
    jobTracker.completeJob(jobId1);
    
    // Set job1's start time to over an hour ago
    const job1 = jobTracker.getJob(jobId1);
    if (job1) {
      job1.startTime = Date.now() - 3700000;
    }
    
    jobTracker.cleanupCompletedJobs();
    
    expect(jobTracker.getJob(jobId1)).toBeUndefined();
    expect(jobTracker.getJob(jobId2)).toBeDefined();
  });
});

describe('API Handlers', () => {
  beforeEach(() => {
    jobTracker['activeJobs'].clear();
  });

  test('routes task and creates job', async () => {
    const result = await apiHandlers.routeTask({
      task: 'Test coding task',
      context_length: 1000,
      expected_output_length: 500,
      complexity: 0.5,
      priority: 'cost'
    });

    expect(result.job_id).toBeDefined();
    expect(result.status).toBe('Queued');
    expect(result.eta).toBeDefined();

    const job = jobTracker.getJob(result.job_id);
    expect(job).toBeDefined();
    expect(job?.task).toBe('Test coding task');
  });

  test('gets cost estimate', async () => {
    const estimate = await apiHandlers.getCostEstimate({
      context_length: 1000,
      expected_output_length: 500,
      complexity: 0.5
    });

    expect(estimate.local_model).toBe('$0 (Free)');
    expect(estimate.openrouter_paid).toBeDefined();
  });

  test('gets active jobs', async () => {
    jobTracker.createJob('test_123', 'Test task 1');
    jobTracker.createJob('test_456', 'Test task 2');

    const activeJobs = apiHandlers.getActiveJobs();
    expect(activeJobs.jobs).toHaveLength(2);
    expect(activeJobs.jobs[0].status).toBe('Queued');
  });

  test('gets job progress', () => {
    const jobId = jobTracker.createJob('test_123', 'Test task');
    jobTracker.updateJobProgress(jobId, 75, 30000);

    const progress = apiHandlers.getJobProgress(jobId);
    expect(progress.progress).toBe('75%');
    expect(progress.status).toBe('In Progress');
  });

  test('cancels job', () => {
    const jobId = jobTracker.createJob('test_123', 'Test task');
    const result = apiHandlers.cancelJob(jobId);
    expect(result.status).toBe('Cancelled');

    const job = jobTracker.getJob(jobId);
    expect(job?.status).toBe('Cancelled');
  });
});