import { getProviderRegistry } from '../../core/provider/index.js';
import { getQueuedJobCounts } from '../../job-store/db.js';
import type {
  SystemStateResult,
  SystemStateReason,
  SystemStateStatus,
} from '../routing/types.js';

const POLL_MS: Record<SystemStateStatus, number> = {
  healthy: 30_000,
  contended: 5_000,
  degraded: 10_000,
};

export async function getSystemState(): Promise<SystemStateResult> {
  const registry = getProviderRegistry();
  const localStats = registry.getLocalExecutionQueueStats();
  const counts = await getQueuedJobCounts();

  const localSlotStatus =
    localStats.activeBenchmarks > 0
      ? ('benchmark' as const)
      : localStats.activeCount > 0
        ? ('inference' as const)
        : ('idle' as const);

  const reasons: SystemStateReason[] = [];

  if (localStats.activeBenchmarks > 0) reasons.push('local_slot_benchmark_contention');
  if (localStats.queuedBenchmarks > 0) reasons.push('benchmark_queued');

  const remoteProviders = registry
    .list()
    .filter((p) => !p.isLocal)
    .map((p) => {
      const available = registry.isAvailable(p.id);
      if (!available) reasons.push('provider_unavailable');
      return {
        id: p.id,
        cost_class: p.costClass,
        available,
        queued_jobs: counts.byProvider[p.id] ?? 0,
      };
    });

  const status: SystemStateStatus = reasons.some(
    (r) => r === 'provider_unavailable' || r === 'provider_unreachable',
  )
    ? 'degraded'
    : reasons.length > 0
      ? 'contended'
      : 'healthy';

  return {
    status,
    reasons: [...new Set(reasons)],
    poll_again_after_ms: POLL_MS[status],
    local_slot: {
      status: localSlotStatus,
      queued_jobs: counts.local,
      active_benchmark_runs: localStats.activeBenchmarks,
      queued_benchmark_runs: localStats.queuedBenchmarks,
    },
    remote_providers: remoteProviders,
  };
}
