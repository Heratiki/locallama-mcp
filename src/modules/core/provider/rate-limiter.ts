type ProviderTier = 'local' | 'remote';

interface QueueEntry<T> {
  run: () => Promise<T>;
  resolve: (value: T) => void;
  reject: (reason?: unknown) => void;
}

interface ProviderQueueState {
  activeCount: number;
  queue: Array<QueueEntry<unknown>>;
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
  private readonly maxConcurrentLocal: number;
  private readonly maxConcurrentRemote: number;

  constructor(options: ProviderRateLimiterOptions) {
    const localCap = Number.isFinite(options.maxConcurrentLocal) ? options.maxConcurrentLocal : 1;
    const remoteCap = Number.isFinite(options.maxConcurrentRemote) ? options.maxConcurrentRemote : 1;
    this.maxConcurrentLocal = Math.max(1, Math.floor(localCap));
    this.maxConcurrentRemote = Math.max(1, Math.floor(remoteCap));
  }

  async schedule<T>(providerId: string, tier: ProviderTier, run: () => Promise<T>): Promise<T> {
    return await new Promise<T>((resolve, reject) => {
      const queueKey = this.queueKeyFor(providerId, tier);
      const state = this.getOrCreateState(queueKey);
      const entry: QueueEntry<T> = { run, resolve, reject };
      state.queue.push(entry as QueueEntry<unknown>);
      this.drain(queueKey, tier);
    });
  }

  private queueKeyFor(providerId: string, tier: ProviderTier): string {
    return tier === 'local' ? 'local' : `remote:${providerId}`;
  }

  private getOrCreateState(providerId: string): ProviderQueueState {
    const existing = this.states.get(providerId);
    if (existing) return existing;

    const created: ProviderQueueState = { activeCount: 0, queue: [] };
    this.states.set(providerId, created);
    return created;
  }

  private capForTier(tier: ProviderTier): number {
    return tier === 'local' ? this.maxConcurrentLocal : this.maxConcurrentRemote;
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
          this.drain(queueKey, tier);
        });
    }
  }

  clear(): void {
    this.states.clear();
  }
}
