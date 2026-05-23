import { JobStatus } from '../../decision-engine/services/jobTracker.js';
import { CostEstimationResult } from '../cost-estimation/types.js';
import { RetrivSearchResult } from '../retriv-integration/types.js';
import { DecomposedCodeTask } from '../../decision-engine/types/codeTask.js';
import type { JobStatus as PersistedJobStatus, TaskStatus as PersistedTaskStatus } from '../../job-store/types.js';

export interface RouteTaskParams {
  task: string;
  contextLength: number;
  expectedOutputLength?: number;
  complexity?: number;
  priority?: 'speed' | 'cost' | 'quality';
  preemptive?: boolean;
}

export interface RouteTaskResult {
  /** The final model used for the last step or synthesis */
  model: string;
  /**
   * Normalized provider id (e.g. 'lm-studio', 'ollama', 'openrouter', 'retriv').
   * Prefer this over `provider` for routing decisions; `provider` is kept
   * for backward compatibility but may carry legacy values like 'local-cache'.
   */
  providerId: string;
  /**
   * Cost class of the provider that produced this result.
   * 'local' = ran on a local runtime (zero API cost).
   * 'free'  = free-tier remote model (zero cost, but external).
   * 'paid'  = paid remote model.
   */
  costClass: 'local' | 'free' | 'paid';
  /** @deprecated Use `providerId` and `costClass` instead. Kept for backward compatibility. */
  provider: string;
  /** Explanation of the routing and execution process */
  reason: string;
  /** Estimated cost for the entire task execution */
  estimatedCost?: number;
  /** The final synthesized code result */
  resultCode: string;
  /** Optional details about the execution */
  details?: {
    costEstimate?: CostEstimationResult;
    retrivResults?: RetrivSearchResult[];
    taskAnalysis?: DecomposedCodeTask;
  };
}

export interface QueuedRouteTaskResult {
  task_id: string;
  status: 'queued';
  job_count: number;
  queue_position: number;
  poll_again_after_ms: number;
  provider: string;
  model: string;
  benchmark_contention?: {
    local_slot_contended: boolean;
    active_benchmark_runs: number;
    queued_benchmark_runs: number;
    message: string;
  };
}

export interface TaskStatusJobSummary {
  job_id: string;
  status: PersistedJobStatus;
  provider?: string;
  model?: string;
  result?: string;
  error?: string;
  progress_pct: number;
}

export interface TaskStatusResult {
  task_id: string;
  status: PersistedTaskStatus | 'not_found';
  job_count: number;
  completed_count: number;
  failed_count: number;
  progress_pct: number;
  poll_again_after_ms: number;
  jobs: TaskStatusJobSummary[];
}

export interface CancelJobResult {
  success: boolean;
  status: JobStatus | 'Not Found' | 'Error';
  message: string;
  jobId: string;
}

export interface CancelTaskResult {
  success: boolean;
  task_id: string;
  cancelled_count: number;
  status: PersistedTaskStatus | 'not_found' | 'error';
  message: string;
}

export type Job = {
  id: string;
  task: string;
  status: JobStatus;
  progress: string;
  estimated_time_remaining: string;
  startTime?: number;
  model?: string;
};

export interface IRouter {
  routeTask(params: RouteTaskParams): Promise<QueuedRouteTaskResult>;
  preemptiveRouting(params: RouteTaskParams): Promise<RouteTaskResult>;
  cancelJob(jobId: string): Promise<CancelJobResult>;
  getTaskStatus(taskId: string): Promise<TaskStatusResult>;
  cancelTask(taskId: string): Promise<CancelTaskResult>;
}
