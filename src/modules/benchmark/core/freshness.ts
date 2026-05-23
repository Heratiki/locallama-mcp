import { getModelRegistry } from '../../core/model/index.js';
import { logger } from '../../../utils/logger.js';
import type { TaskCategory } from './model-benchmarker.js';

export type FreshnessReason =
  | 'benchmark_missing'
  | 'benchmark_stale'
  | 'benchmark_fresh'
  | 'benchmark_skipped_backoff';

export interface FreshnessStatus {
  status: 'fresh' | 'stale' | 'missing';
  lastRunAt?: number;
  reason: FreshnessReason;
}

export interface ScheduleOptions {
  providerId?: string;
  taskCategories?: TaskCategory[];
  /** TTL in milliseconds. Omit or pass Infinity to schedule for any non-fresh benchmark. */
  ttlMs?: number;
}

const DEFAULT_BACKOFF_MS = 5 * 60_000; // 5 minutes

class BenchmarkFreshnessService {
  private readonly backoffUntil = new Map<string, number>();

  check(modelId: string, ttlMs: number): FreshnessStatus {
    const model = getModelRegistry().getModel(modelId);
    const lastRunAt = model?.benchmarkSummary?.lastRunAt;

    if (!lastRunAt) {
      logger.debug(`benchmarkFreshness: '${modelId}' has no benchmark data (benchmark_missing)`);
      return { status: 'missing', reason: 'benchmark_missing' };
    }

    const ageMs = Date.now() - lastRunAt;
    if (ageMs > ttlMs) {
      logger.debug(
        `benchmarkFreshness: '${modelId}' is stale (age=${Math.round(ageMs / 3_600_000)}h > ttl=${Math.round(ttlMs / 3_600_000)}h) (benchmark_stale)`,
      );
      return { status: 'stale', lastRunAt, reason: 'benchmark_stale' };
    }

    logger.debug(`benchmarkFreshness: '${modelId}' is fresh (benchmark_fresh)`);
    return { status: 'fresh', lastRunAt, reason: 'benchmark_fresh' };
  }

  isInBackoff(modelId: string): boolean {
    const until = this.backoffUntil.get(modelId);
    return until !== undefined && Date.now() < until;
  }

  recordFailure(modelId: string, backoffMs = DEFAULT_BACKOFF_MS): void {
    this.backoffUntil.set(modelId, Date.now() + backoffMs);
    logger.warn(
      `benchmarkFreshness: '${modelId}' benchmark failed — backoff ${backoffMs / 1000}s (benchmark_skipped_backoff)`,
    );
  }

  clearBackoff(modelId: string): void {
    this.backoffUntil.delete(modelId);
  }

  /**
   * Schedule a background benchmark for modelId when its data is missing or stale.
   *
   * Returns true if a benchmark was scheduled, false if skipped (fresh or in backoff).
   * The benchmark runs fire-and-forget; routing is never blocked.
   */
  scheduleIfNeeded(modelId: string, options: ScheduleOptions = {}): boolean {
    if (this.isInBackoff(modelId)) {
      logger.debug(
        `benchmarkFreshness: skipping '${modelId}' — in backoff (benchmark_skipped_backoff)`,
      );
      return false;
    }

    const { ttlMs = Infinity, providerId, taskCategories } = options;
    const status = this.check(modelId, ttlMs);

    if (status.status === 'fresh') return false;

    logger.info(
      `benchmarkFreshness: scheduling lazy benchmark for '${modelId}' (${status.reason})`,
    );

    void (async () => {
      try {
        // Dynamic import avoids pulling model-benchmarker's heavy dep chain at load time.
        const { benchmarkModel } = await import('./model-benchmarker.js');
        await benchmarkModel({
          modelId,
          providerId,
          taskCategories: taskCategories ?? ['code', 'chat'],
        });
        this.clearBackoff(modelId);
        logger.info(`benchmarkFreshness: lazy benchmark completed for '${modelId}' (benchmark_fresh)`);
      } catch (err) {
        this.recordFailure(modelId);
        logger.warn(
          `benchmarkFreshness: lazy benchmark failed for '${modelId}': ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    })();

    return true;
  }
}

export const benchmarkFreshnessService = new BenchmarkFreshnessService();
