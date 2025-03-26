export interface Job {
  id: string;
  status: string;
  progress: number;
  estimated_time_remaining: number | null;
  task: string;
  model: string;
  startTime: Date;
}

export type ActiveJobs = Job[];