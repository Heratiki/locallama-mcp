export type JobStatus = 'queued' | 'in_progress' | 'completed' | 'failed' | 'permanently_failed' | 'cancelled';
export type TaskStatus = 'queued' | 'in_progress' | 'completed' | 'partially_failed' | 'failed' | 'cancelled';

export interface PersistedJob {
  id: string;
  task_id: string;
  status: JobStatus;
  provider_id: string | null;
  model_id: string | null;
  task_text: string;
  result: string | null;
  error: string | null;
  queue_position: number | null;
  /** 1 = local inference slot, 0 = remote provider queue. Used for per-slot position computation (ADR 0002). */
  is_local: number | null;
  progress_pct: number;
  poll_again_after_ms: number | null;
  retry_count: number;
  created_at: number;   // unix ms
  started_at: number | null;
  completed_at: number | null;
}

export interface PersistedTask {
  id: string;
  status: TaskStatus;
  job_count: number;
  completed_count: number;
  failed_count: number;
  created_at: number;
}
