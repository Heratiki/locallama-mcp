import { JobStatus } from '../../decision-engine/services/jobTracker.js';
import { CostEstimationResult } from '../cost-estimation/types.js';
import { RetrivSearchResult } from '../retriv-integration/types.js';
import { DecomposedCodeTask } from '../../decision-engine/types/codeTask.js';

export interface RouteTaskParams {
  task: string;
  contextLength: number;
  expectedOutputLength?: number;
  complexity?: number;
  priority?: 'speed' | 'cost' | 'quality';
  preemptive?: boolean;
}

export interface RouteTaskResult {
  model: string;
  provider: string;
  reason: string;
  jobId?: string;
  estimatedCost?: number;
  estimatedTime?: number;
  requiresConfirmation?: boolean;
  details?: {
    status?: JobStatus;
    progress?: number;
    isPreemptive?: boolean;
    costEstimate?: CostEstimationResult;
    retrivResults?: RetrivSearchResult[];
    taskAnalysis?: DecomposedCodeTask;
  };
}

export interface CancelJobResult {
  success: boolean;
  status: JobStatus | 'Not Found' | 'Error';
  message: string;
  jobId: string;
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
  routeTask(params: RouteTaskParams): Promise<RouteTaskResult>;
  preemptiveRouting(params: RouteTaskParams): Promise<RouteTaskResult>;
  cancelJob(jobId: string): Promise<CancelJobResult>;
}