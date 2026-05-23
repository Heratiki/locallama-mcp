import { config } from '../../../config/index.js';

type ProviderTier = 'local' | 'remote';
type WorkloadKind = 'task' | 'benchmark';
type QueuePriority = 'normal' | 'background';

export interface ProviderScheduleOptions {
  workload?: WorkloadKind;
  priority?: QueuePriority;
}

interface QueueEntry<T> {
  run: () => Promise<T>;
  resolve: (value: T) => void;
  reject: (reason?: unknown) => void;
  workload: WorkloadKind;
  priority: QueuePriority;
}

interface ProviderQueueState {
  activeCount: number;
  activeBenchmarks: number;
  queue: Array<QueueEntry<unknown>>;
}

export interface ProviderQueueStats {
  activeCount: number;
  queuedCount: number;
  activeBenchmarks: number;
  queuedBenchmarks: number;
}

export interface ProviderRateLimiterOptions {
  maxConcurrentLocal: number;
  maxConcurrentRemote: number;
}

/**
 * Provider execution queue with tier-specific concurrency caps.
 *
 * Local providers share one queue because they contend for the same local
 * accelerator memory. Remote providers keep independent FIFO queues.
 */
export class ProviderRateLimiter {
  private readonly states = new Map<string, ProviderQueueState>();
  private readonly options: ProviderRateLimiterOptions;

  constructor(options?: Partial<ProviderRateLimiterOptions>) {
    this.options = {
      maxConcurrentLocal: options?.maxConcurrentLocal ?? config.providerMaxConcurrentLocal,
      maxConcurrentRemote: options?.maxConcurrentRemote ?? config.providerMaxConcurrentRemote,
    };
  }

  async schedule<T>(providerId: string, tier: ProviderTier, run: () => Promise<T>, options?: ProviderScheduleOptions): Promise<T> {
    return await new Promise<T>((resolve, reject) => {
      const queueKey = this.queueKeyFor(providerId, tier);
      const state = this.getOrCreateState(queueKey);
      const entry: QueueEntry<T> = {
        run,
        resolve,
        reject,
        workload: options?.workload ?? 'task',
        priority: options?.priority ?? 'normal',
      };
      this.enqueue(state, entry as QueueEntry<unknown>);
      this.drain(queueKey, tier);
    });
  }

  getQueueStats(providerId: string, tier: ProviderTier): ProviderQueueStats {
    const queueKey = this.queueKeyFor(providerId, tier);
    const state = this.states.get(queueKey);
    if (!state) {
      return {
        activeCount: 0,
        queuedCount: 0,
        activeBenchmarks: 0,
        queuedBenchmarks: 0,
      };
    }

    const queuedBenchmarks = state.queue.filter((entry) => entry.workload === 'benchmark').length;
    return {
      activeCount: state.activeCount,
      queuedCount: state.queue.length,
      activeBenchmarks: state.activeBenchmarks,
      queuedBenchmarks,
    };
  }

  private queueKeyFor(providerId: string, tier: ProviderTier): string {
    return tier === 'local' ? 'local' : `remote:${providerId}`;
  }

  private getOrCreateState(providerId: string): ProviderQueueState {
    const existing = this.states.get(providerId);
    if (existing) return existing;

    const created: ProviderQueueState = { activeCount: 0, activeBenchmarks: 0, queue: [] };
    this.states.set(providerId, created);
    return created;
  }

  private enqueue(state: ProviderQueueState, entry: QueueEntry<unknown>): void {
    if (entry.priority === 'background') {
      state.queue.push(entry);
      return;
    }

    if (entry.workload !== 'task') {
      state.queue.push(entry);
      return;
    }

    const firstBenchmarkIdx = state.queue.findIndex((queued) => queued.workload === 'benchmark');
    if (firstBenchmarkIdx === -1) {
      state.queue.push(entry);
      return;
    }

    state.queue.splice(firstBenchmarkIdx, 0, entry);
  }

  private capForTier(tier: ProviderTier): number {
    const rawCap = tier === 'local' ? this.options.maxConcurrentLocal : this.options.maxConcurrentRemote;
    const cap = Number.isFinite(rawCap) ? rawCap : 1;
    return Math.max(1, Math.floor(cap));
  }

  private drain(queueKey: string, tier: ProviderTier): void {
    const state = this.states.get(queueKey);
    if (!state) return;

    const cap = this.capForTier(tier);
    while (state.activeCount < cap) {
      const next = state.queue.shift();
      if (!next) {
        break;
      }

      state.activeCount += 1;
      if (next.workload === 'benchmark') {
        state.activeBenchmarks += 1;
      }
      void next
        .run()
        .then((value) => {
          next.resolve(value as never);
        })
        .catch((error: unknown) => {
          next.reject(error);
        })
        .finally(() => {
          state.activeCount = Math.max(0, state.activeCount - 1);
          if (next.workload === 'benchmark') {
            state.activeBenchmarks = Math.max(0, state.activeBenchmarks - 1);
          }
          this.drain(queueKey, tier);
        });
    }
  }

  clear(): void {
    this.states.clear();
  }
}
