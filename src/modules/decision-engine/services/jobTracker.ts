import { logger } from '../../../utils/logger.js';
import { v4 as uuidv4 } from 'uuid';

export interface Job {
  id: string;
  task: string;
  status: 'Queued' | 'In Progress' | 'Completed' | 'Cancelled' | 'Failed';
  progress: string;
  estimated_time_remaining: string;
  startTime?: number;
  model?: string;
}

/**
 * JobTracker - Manages and tracks the status of all tasks in the system
 */
class JobTracker {
  private activeJobs: Map<string, Job> = new Map();
  private static instance: JobTracker;

  private constructor() {}

  static getInstance(): JobTracker {
    if (!JobTracker.instance) {
      JobTracker.instance = new JobTracker();
    }
    return JobTracker.instance;
  }

  /**
   * Create a new job in the system
   */
  createJob(id: string, task: string, model?: string): string {
    this.activeJobs.set(id, {
      id,
      task,
      status: 'Queued',
      progress: 'Pending',
      estimated_time_remaining: 'N/A',
      startTime: Date.now(),
      model
    });
    logger.debug(`Created new job ${id} for task: ${task}`);
    return id;
  }

  /**
   * Update the progress of an existing job
   */
  updateJobProgress(id: string, progress: number, estimatedTimeRemaining?: number): void {
    const job = this.activeJobs.get(id);
    if (job) {
      job.status = 'In Progress';
      job.progress = `${Math.round(progress)}%`;
      job.estimated_time_remaining = estimatedTimeRemaining ? 
        `${Math.round(estimatedTimeRemaining / 60000)} minutes` : 
        'Calculating...';
      this.activeJobs.set(id, job);
      logger.debug(`Updated job ${id} progress: ${job.progress}`);
    }
  }

  /**
   * Mark a job as completed
   */
  completeJob(id: string): void {
    const job = this.activeJobs.get(id);
    if (job) {
      job.status = 'Completed';
      job.progress = '100%';
      job.estimated_time_remaining = '0';
      this.activeJobs.set(id, job);
      logger.debug(`Completed job ${id}`);
    }
  }

  /**
   * Cancel an active job
   */
  cancelJob(id: string): void {
    const job = this.activeJobs.get(id);
    if (job) {
      job.status = 'Cancelled';
      job.estimated_time_remaining = 'N/A';
      this.activeJobs.set(id, job);
      logger.debug(`Cancelled job ${id}`);
    }
  }

  /**
   * Mark a job as failed with optional error message
   */
  failJob(id: string, error?: string): void {
    const job = this.activeJobs.get(id);
    if (job) {
      job.status = 'Failed';
      job.estimated_time_remaining = 'N/A';
      this.activeJobs.set(id, job);
      logger.error(`Job ${id} failed: ${error || 'Unknown error'}`);
    }
  }

  /**
   * Get a specific job by ID
   */
  getJob(id: string): Job | undefined {
    return this.activeJobs.get(id);
  }

  /**
   * Get all active (non-completed, non-cancelled) jobs
   */
  getActiveJobs(): Job[] {
    return Array.from(this.activeJobs.values()).filter(
      job => job.status !== 'Completed' && job.status !== 'Cancelled'
    );
  }

  /**
   * Get all jobs in the system
   */
  getAllJobs(): Job[] {
    return Array.from(this.activeJobs.values());
  }

  /**
   * Clean up completed and cancelled jobs older than specified age
   */
  cleanupCompletedJobs(maxAgeMs: number = 3600000): void {
    const now = Date.now();
    for (const [id, job] of this.activeJobs.entries()) {
      if (
        (job.status === 'Completed' || job.status === 'Cancelled') &&
        job.startTime &&
        (now - job.startTime) > maxAgeMs
      ) {
        this.activeJobs.delete(id);
      }
    }
  }
}

export const jobTracker = JobTracker.getInstance();