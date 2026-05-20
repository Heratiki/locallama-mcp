/**
 * Re-export job store functions under the names expected by ws-server.ts.
 * Previously this module contained its own SQLite implementation;
 * it is now a thin adapter over the canonical job-store module.
 */
export { initJobStore as initDatabase } from '../job-store/index.js';

import { getAllJobs } from '../job-store/index.js';
import type { PersistedJob } from '../job-store/index.js';

// ws-server.ts uses getAllJobsFromDb() and filters by status === 'pending' | 'in_progress'.
// The persisted store uses lowercase status values ('queued', 'in_progress', etc.),
// so we map 'queued' → 'pending' here to keep ws-server.ts working unchanged.
interface WsJob {
  id: string;
  status: string;
  [key: string]: unknown;
}

function mapPersistedToWs(job: PersistedJob): WsJob {
  const statusMap: Record<string, string> = {
    queued: 'pending',
    in_progress: 'in_progress',
    completed: 'completed',
    failed: 'failed',
    permanently_failed: 'failed',
    cancelled: 'cancelled'
  };
  return {
    ...job,
    status: statusMap[job.status] ?? job.status
  };
}

export async function getAllJobsFromDb(): Promise<WsJob[]> {
  const jobs = await getAllJobs();
  return jobs.map(mapPersistedToWs);
}
