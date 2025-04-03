import { logger } from '../../../utils/logger.js';
import { WebSocketServer } from 'ws';
// Import this type but don't import the function directly to avoid circular dependency
import type { BroadcastJobsFunction } from '../../websocket-server/ws-server-types.js';
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
  results?: string[]; // Array to store generated code blocks
}

/**
 * JobTracker - Manages and tracks the status of all tasks in the system
 */
export class JobTracker extends EventEmitter {
  private activeJobs: Map<string, Job> = new Map();
  private static instance: JobTracker;
  private initialized = false;
  private wss: WebSocketServer | null = null;
  private readonly BASE_PORT = 8080;
  private readonly MAX_PORT = 8180;
  // Store broadcast function dynamically to avoid circular dependency
  private broadcastFunction: BroadcastJobsFunction | null = null;

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

  // Method to set the broadcast function after initialization to avoid circular dependency
  public setBroadcastFunction(fn: BroadcastJobsFunction): void {
    this.broadcastFunction = fn;
    logger.debug('Broadcast function set in JobTracker');
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
      try {
        this.wss = new WebSocketServer({ port, noServer: false });
        logger.info(`Job tracker WebSocket server started on port ${port}`);
      } catch (wsError) {
        logger.error('Failed to create WebSocket server:', wsError);
        // Continue without WebSocket server
        this.wss = null;
      }
      
      // Mark as initialized even if WebSocket creation fails
      // This allows the system to function without job tracking
      this.initialized = true;
    } catch (error) {
      logger.error('Failed to initialize WebSocket server:', error instanceof Error ? error.message : String(error));
      // Continue without WebSocket server - the app can still function without real-time updates
      this.initialized = true;
    }
  }

  async createJob(id: string, task: string, model?: string): Promise<string> {
    // Allow operation even if not fully initialized
    if (!this.initialized) {
      logger.warn(`Attempted to create job ${id} before JobTracker was initialized`);
      // Mark as initialized to allow operations to continue
      this.initialized = true;
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
    try {
      await this.broadcastUpdate();
    } catch (error) {
      logger.warn(`Failed to broadcast job creation for ${id}:`, error);
    }
    this.emit('jobCreated', job);
    return id;
  }

  async updateJobProgress(id: string, progress: number, estimatedTimeRemaining?: number): Promise<void> {
    // Allow operation even if not fully initialized
    if (!this.initialized) {
      logger.warn(`Attempted to update job ${id} before JobTracker was initialized`);
      // Mark as initialized to allow operations to continue
      this.initialized = true;
      return;
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
      try {
        await this.broadcastUpdate();
      } catch (error) {
        logger.warn(`Failed to broadcast progress update for job ${id}:`, error);
      }
      this.emit('jobProgress', job);
    }
  }

  async completeJob(id: string, results?: string[]): Promise<void> {
    // Allow operation even if not fully initialized
    if (!this.initialized) {
      logger.warn(`Attempted to complete job ${id} before JobTracker was initialized`);
      // Mark as initialized to allow operations to continue
      this.initialized = true;
      return;
    }

    const job = this.activeJobs.get(id);
    if (job) {
      job.status = JobStatus.COMPLETED;
      job.progress = '100%';
      job.estimated_time_remaining = '0';
      
      // Store results if provided
      if (results && results.length > 0) {
        job.results = results;
        logger.debug(`Stored ${results.length} code blocks for job ${id}`);
      }
      
      this.activeJobs.set(id, job);
      logger.debug(`Completed job ${id}`);
      try {
        await this.broadcastUpdate();
      } catch (error) {
        logger.warn(`Failed to broadcast job completion for ${id}:`, error);
      }
      this.emit('jobCompleted', job);
    }
  }

  async cancelJob(id: string): Promise<void> {
    // Allow operation even if not fully initialized
    if (!this.initialized) {
      logger.warn(`Attempted to cancel job ${id} before JobTracker was initialized`);
      // Mark as initialized to allow operations to continue
      this.initialized = true;
      return;
    }

    const job = this.activeJobs.get(id);
    if (job) {
      job.status = JobStatus.CANCELLED;
      job.estimated_time_remaining = 'N/A';
      
      this.activeJobs.set(id, job);
      logger.debug(`Cancelled job ${id}`);
      try {
        await this.broadcastUpdate();
      } catch (error) {
        logger.warn(`Failed to broadcast job cancellation for ${id}:`, error);
      }
      this.emit('jobCancelled', job);
    }
  }

  async failJob(id: string, error?: string): Promise<void> {
    // Allow operation even if not fully initialized
    if (!this.initialized) {
      logger.warn(`Attempted to fail job ${id} before JobTracker was initialized`);
      // Mark as initialized to allow operations to continue
      this.initialized = true;
      return;
    }

    const job = this.activeJobs.get(id);
    if (job) {
      job.status = JobStatus.FAILED;
      job.estimated_time_remaining = 'N/A';
      job.error = error;
      
      this.activeJobs.set(id, job);
      logger.error(`Job ${id} failed: ${error || 'Unknown error'}`);
      try {
        await this.broadcastUpdate();
      } catch (broadcastError) {
        logger.warn(`Failed to broadcast job failure for ${id}:`, broadcastError);
      }
      this.emit('jobFailed', job);
    }
  }

  getJob(id: string): Job | undefined {
    // Allow operation even if not fully initialized
    if (!this.initialized) {
      logger.warn(`Attempted to get job ${id} before JobTracker was initialized`);
      // Mark as initialized to allow operations to continue
      this.initialized = true;
      return undefined;
    }
    
    return this.activeJobs.get(id);
  }

  getActiveJobs(): Job[] {
    // Allow operation even if not fully initialized
    if (!this.initialized) {
      logger.warn('Attempted to get active jobs before JobTracker was initialized');
      // Mark as initialized to allow operations to continue
      this.initialized = true;
      return [];
    }
    
    return Array.from(this.activeJobs.values()).filter(
      job => job.status !== JobStatus.COMPLETED && job.status !== JobStatus.CANCELLED
    );
  }

  getAllJobs(): Job[] {
    // Allow operation even if not fully initialized
    if (!this.initialized) {
      logger.warn('Attempted to get all jobs before JobTracker was initialized');
      // Mark as initialized to allow operations to continue
      this.initialized = true;
      return [];
    }
    
    return Array.from(this.activeJobs.values());
  }

  cleanupCompletedJobs(maxAgeMs: number = 3600000): void {
    // Allow operation even if not fully initialized
    if (!this.initialized) {
      logger.warn('Attempted to cleanup jobs before JobTracker was initialized');
      // Mark as initialized to allow operations to continue
      this.initialized = true;
      return;
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
    // Allow operation even if not fully initialized
    if (!this.initialized) {
      logger.warn('Attempted to broadcast update before JobTracker was initialized');
      // Mark as initialized to allow operations to continue
      this.initialized = true;
      return;
    }

    // Add a small delay and retry mechanism for broadcast function availability
    let attempt = 0;
    const maxAttempts = 3;
    const delayMs = 100;

    while (attempt < maxAttempts) {
      if (this.wss && this.broadcastFunction) {
        try {
          await this.broadcastFunction(this.wss);
          return; // Success
        } catch (error) {
          logger.error('Failed to broadcast job update:', error);
          return; // Don't retry on broadcast error
        }
      } else if (this.wss) {
        // Broadcast function not set yet, wait and retry
        logger.debug(`Broadcast function not set yet (attempt ${attempt + 1}/${maxAttempts}), waiting ${delayMs}ms...`);
        await new Promise(resolve => setTimeout(resolve, delayMs));
        attempt++;
      } else {
        // WebSocket server itself is not ready, unlikely but possible
        logger.warn('WebSocket server not available for broadcast');
        return;
      }
    }

    // If still not set after retries, log the final warning
    if (!this.broadcastFunction) {
      logger.warn('Broadcast function not set in JobTracker after multiple checks');
    }
  }

  isInitialized(): boolean {
    return this.initialized;
  }
}

// Initialize singleton instance immediately but safely
let jobTrackerInstance: JobTracker | null = null;
let initializationPromise: Promise<JobTracker> | null = null;

// Export async function to get singleton instance
export const getJobTracker = async (): Promise<JobTracker> => {
  if (initializationPromise) {
    return initializationPromise;
  }
  
  if (!jobTrackerInstance) {
    initializationPromise = JobTracker.getInstance().then(instance => {
      jobTrackerInstance = instance;
      initializationPromise = null;
      return instance;
    });
    return initializationPromise;
  }
  
  return jobTrackerInstance;
};

// Export synchronous function to get instance without initialization
export const getJobTrackerSync = (): JobTracker | null => {
  return jobTrackerInstance;
};
