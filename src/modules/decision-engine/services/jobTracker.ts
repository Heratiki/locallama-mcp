import { logger } from '../../../utils/logger.js';
import { WebSocketServer } from 'ws';
// Import this type but don't import the function directly to avoid circular dependency
import type { BroadcastJobsFunction } from '../../websocket-server/ws-server-types.js';
import net from 'net';
import EventEmitter from 'events';
import {
  initJobStore,
  insertJob as dbInsertJob,
  updateJob as dbUpdateJob,
  getAllJobs as dbGetAllJobs,
  deleteOldJobs as dbDeleteOldJobs
} from '../../job-store/index.js';
import { refreshAlertState } from '../../job-store/alert.js';

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

export interface JobTrackerMonitoringInfo {
  websocketUrl: string;
  activeJobsUri: string;
  jobProgressUriTemplate: string;
}

/**
 * JobTracker - Manages and tracks the status of all tasks in the system
 */
export class JobTracker extends EventEmitter {
  // In-memory cache for synchronous read access; kept in sync with DB writes.
  private activeJobs: Map<string, Job> = new Map();
  private static instance: JobTracker | null = null;
  private initialized = false;
  private wss: WebSocketServer | null = null;
  private websocketPort: number | null = null;
  private readonly BASE_PORT = 8080;
  private readonly MAX_PORT = 8180;
  // Store broadcast function dynamically to avoid circular dependency
  private broadcastFunction: BroadcastJobsFunction | null = null;

  private constructor() {
    super();
  }

  /** Map a PersistedJob row back to the in-memory Job interface. */
  private persistedToJob(p: import('../../job-store/index.js').PersistedJob): Job {
    const statusMap: Record<string, JobStatus> = {
      queued: JobStatus.QUEUED,
      in_progress: JobStatus.IN_PROGRESS,
      completed: JobStatus.COMPLETED,
      failed: JobStatus.FAILED,
      permanently_failed: JobStatus.FAILED,
      cancelled: JobStatus.CANCELLED
    };
    return {
      id: p.id,
      task: p.task_text,
      status: statusMap[p.status] ?? JobStatus.QUEUED,
      progress: p.progress_pct === 100 ? '100%' : p.progress_pct > 0 ? `${p.progress_pct}%` : 'Pending',
      estimated_time_remaining: p.status === 'completed' ? '0' : 'N/A',
      startTime: p.created_at,
      model: p.model_id ?? undefined,
      error: p.error ?? undefined,
      results: p.result ? (JSON.parse(p.result) as string[]) : undefined
    };
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

  static async shutdownInstance(): Promise<void> {
    if (!JobTracker.instance) return;
    await JobTracker.instance.shutdown();
    JobTracker.instance = null;
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

    // Initialize the persistent job store and hydrate in-memory cache
    try {
      await initJobStore();
      logger.info('Persistent job store initialized');
      // Reload any existing jobs from the DB into the in-memory cache
      const existingJobs = await dbGetAllJobs();
      for (const persisted of existingJobs) {
        this.activeJobs.set(persisted.id, this.persistedToJob(persisted));
      }
      logger.info(`Loaded ${existingJobs.length} existing job(s) from persistent store`);
      await refreshAlertState();
    } catch (storeError) {
      logger.error('Failed to initialize persistent job store:', storeError);
      // Continue — the tracker can still function (with degraded persistence)
    }

    try {
      const port = await this.findAvailablePort();
      try {
        this.wss = new WebSocketServer({ port, noServer: false });
        this.websocketPort = port;
        logger.info(`Job tracker WebSocket server started on port ${port}`);
      } catch (wsError) {
        logger.error('Failed to create WebSocket server:', wsError);
        // Continue without WebSocket server
        this.wss = null;
        this.websocketPort = null;
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

  async createJob(id: string, task: string, model?: string, provider?: string): Promise<string> {
    // Allow operation even if not fully initialized
    if (!this.initialized) {
      logger.warn(`Attempted to create job ${id} before JobTracker was initialized`);
      // Mark as initialized to allow operations to continue
      this.initialized = true;
    }

    const now = Date.now();
    try {
      await dbInsertJob({
        id,
        task_id: id,
        status: 'queued',
        provider_id: provider ?? null,
        model_id: model ?? null,
        task_text: task,
        result: null,
        error: null,
        queue_position: null,
        is_local: null,
        progress_pct: 0,
        poll_again_after_ms: null,
        retry_count: 0,
        created_at: now,
        started_at: null,
        completed_at: null
      });
    } catch (dbError) {
      logger.warn(`Failed to persist job ${id} to store:`, dbError);
    }

    const job: Job = {
      id,
      task,
      status: JobStatus.QUEUED,
      progress: 'Pending',
      estimated_time_remaining: 'N/A',
      startTime: now,
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

  async updateJobProgress(id: string, progress: number, estimatedTimeRemaining?: number, provider?: string): Promise<void> {
    // Allow operation even if not fully initialized
    if (!this.initialized) {
      logger.warn(`Attempted to update job ${id} before JobTracker was initialized`);
      // Mark as initialized to allow operations to continue
      this.initialized = true;
      return;
    }

    const progressPct = Math.round(progress);
    const progressStr = `${progressPct}%`;
    const etaStr = estimatedTimeRemaining
      ? `${Math.round(estimatedTimeRemaining / 60000)} minutes`
      : 'Calculating...';

    // Update in-memory cache FIRST for immediate visibility
    const existing = this.activeJobs.get(id);
    const job: Job = existing
      ? { ...existing, status: JobStatus.IN_PROGRESS, progress: progressStr, estimated_time_remaining: etaStr }
      : { id, task: '', status: JobStatus.IN_PROGRESS, progress: progressStr, estimated_time_remaining: etaStr, startTime: Date.now() };
    this.activeJobs.set(id, job);

    try {
      await dbUpdateJob({
        id,
        status: 'in_progress',
        progress_pct: progressPct,
        provider_id: provider ?? undefined,
        started_at: Date.now()
      });
    } catch (dbError) {
      logger.warn(`Failed to persist progress update for job ${id}:`, dbError);
    }

    logger.debug(`Updated job ${id} progress: ${progressStr}`);
    try {
      await this.broadcastUpdate();
    } catch (error) {
      logger.warn(`Failed to broadcast progress update for job ${id}:`, error);
    }
    this.emit('jobProgress', job);
  }

  async completeJob(id: string, results?: string[]): Promise<void> {
    // Allow operation even if not fully initialized
    if (!this.initialized) {
      logger.warn(`Attempted to complete job ${id} before JobTracker was initialized`);
      // Mark as initialized to allow operations to continue
      this.initialized = true;
      return;
    }

    const now = Date.now();
    const existing = this.activeJobs.get(id);
    const job: Job = {
      ...(existing ?? { task: '', startTime: now }),
      id,
      status: JobStatus.COMPLETED,
      progress: '100%',
      estimated_time_remaining: '0',
      results: results ?? existing?.results
    };
    this.activeJobs.set(id, job);

    try {
      await dbUpdateJob({
        id,
        status: 'completed',
        progress_pct: 100,
        result: results ? JSON.stringify(results) : null,
        completed_at: now,
        queue_position: null,
        poll_again_after_ms: 0
      });
    } catch (dbError) {
      logger.warn(`Failed to persist completion for job ${id}:`, dbError);
    }

    if (results && results.length > 0) {
      logger.debug(`Stored ${results.length} code blocks for job ${id}`);
    }

    logger.debug(`Completed job ${id}`);
    try {
      await this.broadcastUpdate();
    } catch (error) {
      logger.warn(`Failed to broadcast job completion for ${id}:`, error);
    }
    this.emit('jobCompleted', job);
  }

  async cancelJob(id: string): Promise<void> {
    // Allow operation even if not fully initialized
    if (!this.initialized) {
      logger.warn(`Attempted to cancel job ${id} before JobTracker was initialized`);
      // Mark as initialized to allow operations to continue
      this.initialized = true;
      return;
    }

    const existing = this.activeJobs.get(id);
    const job: Job = {
      ...(existing ?? { task: '', startTime: Date.now() }),
      id,
      status: JobStatus.CANCELLED,
      progress: 'Cancelled',
      estimated_time_remaining: 'N/A'
    };
    this.activeJobs.set(id, job);

    try {
      await dbUpdateJob({ 
        id, 
        status: 'cancelled',
        queue_position: null,
        poll_again_after_ms: 0
      });
    } catch (dbError) {
      logger.warn(`Failed to persist cancellation for job ${id}:`, dbError);
    }

    logger.debug(`Cancelled job ${id}`);
    try {
      await this.broadcastUpdate();
    } catch (error) {
      logger.warn(`Failed to broadcast job cancellation for ${id}:`, error);
    }
    this.emit('jobCancelled', job);
    await refreshAlertState();
  }

  async failJob(id: string, error?: string): Promise<void> {
    // Allow operation even if not fully initialized
    if (!this.initialized) {
      logger.warn(`Attempted to fail job ${id} before JobTracker was initialized`);
      // Mark as initialized to allow operations to continue
      this.initialized = true;
      return;
    }

    const existing = this.activeJobs.get(id);
    const job: Job = {
      ...(existing ?? { task: '', startTime: Date.now() }),
      id,
      status: JobStatus.FAILED,
      progress: 'Failed',
      estimated_time_remaining: 'N/A',
      error
    };
    this.activeJobs.set(id, job);

    try {
      await dbUpdateJob({ 
        id, 
        status: 'failed', 
        error: error ?? null,
        queue_position: null,
        poll_again_after_ms: 0
      });
    } catch (dbError) {
      logger.warn(`Failed to persist failure for job ${id}:`, dbError);
    }

    logger.error(`Job ${id} failed: ${error || 'Unknown error'}`);
    try {
      await this.broadcastUpdate();
    } catch (broadcastError) {
      logger.warn(`Failed to broadcast job failure for ${id}:`, broadcastError);
    }
    this.emit('jobFailed', job);
    await refreshAlertState();
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

    // Prune from in-memory cache
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

    // Prune from persistent store (fire-and-forget; errors already logged inside)
    dbDeleteOldJobs(maxAgeMs).catch((err: unknown) => {
      logger.warn('Failed to prune old jobs from persistent store:', err);
    });
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

  getWebSocketUrl(host: string = '127.0.0.1'): string | null {
    if (!this.initialized || !this.wss) return null;

    const address = this.wss.address();
    const port = typeof address === 'object' && address !== null
      ? address.port
      : this.websocketPort;

    if (!port) return null;
    return `ws://${host}:${port}`;
  }

  getMonitoringInfo(): JobTrackerMonitoringInfo | null {
    const websocketUrl = this.getWebSocketUrl();
    if (!websocketUrl) return null;

    return {
      websocketUrl,
      activeJobsUri: 'locallama://jobs/active',
      jobProgressUriTemplate: 'locallama://jobs/progress/{jobId}',
    };
  }

  async shutdown(): Promise<void> {
    const server = this.wss;
    this.wss = null;
    this.websocketPort = null;
    this.initialized = false;
    this.activeJobs.clear();
    this.removeAllListeners();

    if (!server) return;

    for (const client of server.clients) {
      try {
        client.close();
      } catch {
        // Best-effort shutdown; ignore individual client close failures.
      }
    }

    await new Promise<void>((resolve) => {
      server.close(() => resolve());
    });
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

export const shutdownJobTracker = async (): Promise<void> => {
  await JobTracker.shutdownInstance();
  jobTrackerInstance = null;
  initializationPromise = null;
};
