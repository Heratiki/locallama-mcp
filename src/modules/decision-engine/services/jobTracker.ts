import { logger } from '../../../utils/logger.js';
import { WebSocketServer } from 'ws';
import { broadcastJobs } from '../../websocket-server/ws-server.js';
import net from 'net';
import EventEmitter from 'events';

// Job status enum for better type safety
export enum JobStatus {
  QUEUED = 'Queued',
  IN_PROGRESS = 'In Progress',
  COMPLETED = 'Completed',
  CANCELLED = 'Cancelled',
  FAILED = 'Failed'
}

// Type for external interface compatibility
export type JobStatusString =
  | 'Queued'
  | 'In Progress'
  | 'Completed'
  | 'Cancelled'
  | 'Failed';

// Assert function for type safety
export function isJobStatus(status: string): status is JobStatusString {
  return Object.values(JobStatus).includes(status as JobStatus);
}

export interface Job {
  id: string;
  task: string;
  status: JobStatus;
  progress: string;
  estimated_time_remaining: string;
  startTime: number;
  model?: string;
  error?: string;
}

/**
 * JobTracker - Manages and tracks the status of all tasks in the system
 */
class JobTracker extends EventEmitter {
  private activeJobs: Map<string, Job> = new Map();
  private static instance: JobTracker;
  private initialized = false;
  private wss: WebSocketServer | null = null;
  private readonly BASE_PORT = 8080;
  private readonly MAX_PORT = 8180;

  private constructor() {
    super();
  }

  static async getInstance(): Promise<JobTracker> {
    if (!JobTracker.instance) {
      JobTracker.instance = new JobTracker();
      await JobTracker.instance.initializeTracker();
    } else if (!JobTracker.instance.initialized) {
      await JobTracker.instance.initializeTracker();
    }
    return JobTracker.instance;
  }

  private isPortAvailable(port: number): Promise<boolean> {
    return new Promise((resolve) => {
      const server = net.createServer();
      server.once('error', () => resolve(false));
      server.once('listening', () => {
        server.close();
        resolve(true);
      });
      server.listen(port);
    });
  }

  private async findAvailablePort(): Promise<number> {
    for (let port = this.BASE_PORT; port <= this.MAX_PORT; port++) {
      if (await this.isPortAvailable(port)) {
        return port;
      }
    }
    throw new Error(`No available ports found in range ${this.BASE_PORT}-${this.MAX_PORT}`);
  }

  public async initializeTracker(): Promise<void> {
    if (this.initialized) {
      logger.warn('JobTracker already initialized');
      return;
    }

    try {
      const port = await this.findAvailablePort();
      this.wss = new WebSocketServer({ port });
      this.initialized = true;
      logger.info(`Job tracker WebSocket server started on port ${port}`);
    } catch (error) {
      logger.error('Failed to initialize WebSocket server:', error instanceof Error ? error.message : String(error));
      // Continue without WebSocket server - the app can still function without real-time updates
      this.initialized = true;
    }
  }

  async createJob(id: string, task: string, model?: string): Promise<string> {
    if (!this.initialized) {
      throw new Error('JobTracker not initialized');
    }
    
    const job: Job = {
      id,
      task,
      status: JobStatus.QUEUED,
      progress: 'Pending',
      estimated_time_remaining: 'N/A',
      startTime: Date.now(),
      model
    };

    this.activeJobs.set(id, job);
    logger.debug(`Created new job ${id} for task: ${task}`);
    await this.broadcastUpdate();
    this.emit('jobCreated', job);
    return id;
  }

  async updateJobProgress(id: string, progress: number, estimatedTimeRemaining?: number): Promise<void> {
    if (!this.initialized) {
      throw new Error('JobTracker not initialized');
    }

    const job = this.activeJobs.get(id);
    if (job) {
      job.status = JobStatus.IN_PROGRESS;
      job.progress = `${Math.round(progress)}%`;
      job.estimated_time_remaining = estimatedTimeRemaining ? 
        `${Math.round(estimatedTimeRemaining / 60000)} minutes` : 
        'Calculating...';
      
      this.activeJobs.set(id, job);
      logger.debug(`Updated job ${id} progress: ${job.progress}`);
      await this.broadcastUpdate();
      this.emit('jobProgress', job);
    }
  }

  async completeJob(id: string): Promise<void> {
    if (!this.initialized) {
      throw new Error('JobTracker not initialized');
    }

    const job = this.activeJobs.get(id);
    if (job) {
      job.status = JobStatus.COMPLETED;
      job.progress = '100%';
      job.estimated_time_remaining = '0';
      
      this.activeJobs.set(id, job);
      logger.debug(`Completed job ${id}`);
      await this.broadcastUpdate();
      this.emit('jobCompleted', job);
    }
  }

  async cancelJob(id: string): Promise<void> {
    if (!this.initialized) {
      throw new Error('JobTracker not initialized');
    }

    const job = this.activeJobs.get(id);
    if (job) {
      job.status = JobStatus.CANCELLED;
      job.estimated_time_remaining = 'N/A';
      
      this.activeJobs.set(id, job);
      logger.debug(`Cancelled job ${id}`);
      await this.broadcastUpdate();
      this.emit('jobCancelled', job);
    }
  }

  async failJob(id: string, error?: string): Promise<void> {
    if (!this.initialized) {
      throw new Error('JobTracker not initialized');
    }

    const job = this.activeJobs.get(id);
    if (job) {
      job.status = JobStatus.FAILED;
      job.estimated_time_remaining = 'N/A';
      job.error = error;
      
      this.activeJobs.set(id, job);
      logger.error(`Job ${id} failed: ${error || 'Unknown error'}`);
      await this.broadcastUpdate();
      this.emit('jobFailed', job);
    }
  }

  getJob(id: string): Job | undefined {
    if (!this.initialized) {
      throw new Error('JobTracker not initialized');
    }
    return this.activeJobs.get(id);
  }

  getActiveJobs(): Job[] {
    if (!this.initialized) {
      throw new Error('JobTracker not initialized');
    }
    return Array.from(this.activeJobs.values()).filter(
      job => job.status !== JobStatus.COMPLETED && job.status !== JobStatus.CANCELLED
    );
  }

  getAllJobs(): Job[] {
    if (!this.initialized) {
      throw new Error('JobTracker not initialized');
    }
    return Array.from(this.activeJobs.values());
  }

  cleanupCompletedJobs(maxAgeMs: number = 3600000): void {
    if (!this.initialized) {
      throw new Error('JobTracker not initialized');
    }
    
    const now = Date.now();
    for (const [id, job] of this.activeJobs.entries()) {
      if (
        (job.status === JobStatus.COMPLETED || job.status === JobStatus.CANCELLED) &&
        (now - job.startTime) > maxAgeMs
      ) {
        this.activeJobs.delete(id);
        this.emit('jobRemoved', id);
      }
    }
  }

  private async broadcastUpdate(): Promise<void> {
    if (!this.initialized) {
      throw new Error('JobTracker not initialized');
    }

    if (this.wss) {
      try {
        await broadcastJobs(this.wss);
      } catch (error) {
        logger.error('Failed to broadcast job update:', error);
      }
    }
  }

  isInitialized(): boolean {
    return this.initialized;
  }
}

// Export async function to get singleton instance
export const getJobTracker = async (): Promise<JobTracker> => {
  return JobTracker.getInstance();
};