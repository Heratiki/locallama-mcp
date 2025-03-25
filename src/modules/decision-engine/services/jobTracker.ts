import { logger } from '../../../utils/logger.js';
import { WebSocketServer } from 'ws';
import { broadcastJobs } from '../../websocket-server/ws-server.js';
import net from 'net';

// Get the WebSocket server instance
let wss: WebSocketServer | null = null;
const BASE_PORT = 8080;
const MAX_PORT = 8180;

function isPortAvailable(port: number): Promise<boolean> {
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

async function findAvailablePort(startPort: number, endPort: number): Promise<number> {
  for (let port = startPort; port <= endPort; port++) {
    if (await isPortAvailable(port)) {
      return port;
    }
  }
  throw new Error(`No available ports found in range ${startPort}-${endPort}`);
}

async function initializeWebSocketServer() {
  try {
    const port = await findAvailablePort(BASE_PORT, MAX_PORT);
    wss = new WebSocketServer({ port });
    logger.info(`Job tracker WebSocket server started on port ${port}`);
  } catch (error) {
    logger.error('Failed to initialize WebSocket server:', error instanceof Error ? error.message : String(error));
    // Continue without WebSocket server - the app can still function without job tracking
  }
}

// Initialize the WebSocket server
void initializeWebSocketServer();

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
  async createJob(id: string, task: string, model?: string): Promise<string> {
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
    if (wss) await broadcastJobs(wss);
    return id;
  }

  /**
   * Update the progress of an existing job
   */
  async updateJobProgress(id: string, progress: number, estimatedTimeRemaining?: number): Promise<void> {
    const job = this.activeJobs.get(id);
    if (job) {
      job.status = 'In Progress';
      job.progress = `${Math.round(progress)}%`;
      job.estimated_time_remaining = estimatedTimeRemaining ? 
        `${Math.round(estimatedTimeRemaining / 60000)} minutes` : 
        'Calculating...';
      this.activeJobs.set(id, job);
      logger.debug(`Updated job ${id} progress: ${job.progress}`);
      if (wss) await broadcastJobs(wss);
    }
  }

  /**
   * Mark a job as completed
   */
  async completeJob(id: string): Promise<void> {
    const job = this.activeJobs.get(id);
    if (job) {
      job.status = 'Completed';
      job.progress = '100%';
      job.estimated_time_remaining = '0';
      this.activeJobs.set(id, job);
      logger.debug(`Completed job ${id}`);
      if (wss) await broadcastJobs(wss);
    }
  }

  /**
   * Cancel an active job
   */
  async cancelJob(id: string): Promise<void> {
    const job = this.activeJobs.get(id);
    if (job) {
      job.status = 'Cancelled';
      job.estimated_time_remaining = 'N/A';
      this.activeJobs.set(id, job);
      logger.debug(`Cancelled job ${id}`);
      if (wss) await broadcastJobs(wss);
    }
  }

  /**
   * Mark a job as failed with optional error message
   */
  async failJob(id: string, error?: string): Promise<void> {
    const job = this.activeJobs.get(id);
    if (job) {
      job.status = 'Failed';
      job.estimated_time_remaining = 'N/A';
      this.activeJobs.set(id, job);
      logger.error(`Job ${id} failed: ${error || 'Unknown error'}`);
      if (wss) await broadcastJobs(wss);
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