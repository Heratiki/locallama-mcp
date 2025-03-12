/**
 * Types for the Routing module
 */

export interface IRouter {
  /**
   * Route a coding task to either a local LLM or a paid API based on cost and complexity
   */
  routeTask: (params: RouteTaskParams) => Promise<RouteTaskResult>;
  
  /**
   * Quickly route a coding task without making API calls (faster but less accurate)
   */
  preemptiveRouting: (params: RouteTaskParams) => Promise<RouteTaskResult>;
  
  /**
   * Cancel a running job
   */
  cancelJob: (jobId: string) => Promise<CancelJobResult>;
}

export interface RouteTaskParams {
  /**
   * The coding task to route
   */
  task: string;
  
  /**
   * The length of the context in tokens
   */
  contextLength: number;
  
  /**
   * The expected length of the output in tokens
   */
  expectedOutputLength?: number;
  
  /**
   * The complexity of the task (0-1)
   */
  complexity?: number;
  
  /**
   * The priority for this task
   */
  priority?: 'speed' | 'cost' | 'quality';
  
  /**
   * Whether to use preemptive routing (faster but less accurate)
   */
  preemptive?: boolean;
}

export interface RouteTaskResult {
  /**
   * The model selected for the task
   */
  model: string;
  
  /**
   * The provider of the model (openrouter, ollama, lm-studio, etc.)
   */
  provider: string;
  
  /**
   * The reason for selecting this model
   */
  reason: string;
  
  /**
   * The job ID for tracking progress
   */
  jobId?: string;
  
  /**
   * The estimated cost for executing this task
   */
  estimatedCost?: number;
  
  /**
   * The estimated time to complete the task (ms)
   */
  estimatedTime?: number;
  
  /**
   * Whether confirmation is required before proceeding
   */
  requiresConfirmation?: boolean;
  
  /**
   * Additional details about the routing decision
   */
  details?: Record<string, unknown>;
}

export interface CancelJobResult {
  /**
   * Whether the job was successfully cancelled
   */
  success: boolean;
  
  /**
   * The current status of the job
   */
  status: string;
  
  /**
   * Additional message about the cancellation
   */
  message: string;
  
  /**
   * The job ID that was cancelled
   */
  jobId: string;
}

export interface JobTrackingInfo {
  /**
   * The job ID
   */
  id: string;
  
  /**
   * The task description
   */
  task: string;
  
  /**
   * The model used for the task
   */
  model: string;
  
  /**
   * The current status of the job
   */
  status: 'Queued' | 'In Progress' | 'Completed' | 'Failed' | 'Cancelled';
  
  /**
   * The current progress percentage (0-100)
   */
  progress: number;
  
  /**
   * The start time of the job
   */
  startTime: Date;
  
  /**
   * The end time of the job (if completed)
   */
  endTime?: Date;
  
  /**
   * The result of the job (if completed)
   */
  result?: string;
  
  /**
   * The error message (if failed)
   */
  error?: string;
}