import { getJobsByStatus, updateJob } from './db.js';

export interface RecoveryResult {
  recovering: number;
  permanentlyFailed: number;
}

export async function recoverInProgressJobs(): Promise<RecoveryResult> {
  const inProgress = await getJobsByStatus(['in_progress']);
  let recovering = 0;
  let permanentlyFailed = 0;

  for (const job of inProgress) {
    if (job.retry_count === 0) {
      await updateJob({ id: job.id, status: 'queued', retry_count: 1 });
      recovering++;
    } else {
      await updateJob({ id: job.id, status: 'permanently_failed' });
      permanentlyFailed++;
    }
  }

  return { recovering, permanentlyFailed };
}
