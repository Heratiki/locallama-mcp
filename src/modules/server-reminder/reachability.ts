export type MonitoringReachabilityStatus = 'reachable' | 'unreachable' | 'unknown';

export type MonitoringReachabilitySnapshot = {
  status: MonitoringReachabilityStatus;
  url?: string;
  lastCheckedAt?: number;
  reason?: string;
};

export type ReachabilityProbe = (url: string, timeoutMs: number) => Promise<boolean>;

type MonitoringReachabilityCacheOptions = {
  ttlMs?: number;
  timeoutMs?: number;
  now?: () => number;
  probe?: ReachabilityProbe;
};

const DEFAULT_TTL_MS = 5 * 60 * 1000;
const DEFAULT_TIMEOUT_MS = 750;

async function defaultProbe(url: string, timeoutMs: number): Promise<boolean> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  timeout.unref?.();

  try {
    const response = await fetch(url, {
      method: 'GET',
      signal: controller.signal,
    });
    return response.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timeout);
  }
}

export class MonitoringReachabilityCache {
  private readonly ttlMs: number;
  private readonly timeoutMs: number;
  private readonly now: () => number;
  private readonly probe: ReachabilityProbe;
  private readonly entries = new Map<string, MonitoringReachabilitySnapshot>();
  private readonly inFlight = new Set<string>();

  constructor(options: MonitoringReachabilityCacheOptions = {}) {
    this.ttlMs = options.ttlMs ?? DEFAULT_TTL_MS;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.now = options.now ?? Date.now;
    this.probe = options.probe ?? defaultProbe;
  }

  getCachedStatus(url: string | undefined | null): MonitoringReachabilitySnapshot {
    if (!url) {
      return { status: 'unknown', reason: 'monitoring_url_unavailable' };
    }

    const cached = this.entries.get(url);
    if (!cached || this.isStale(cached)) {
      this.startProbe(url);
    }

    return this.entries.get(url) ?? {
      status: 'unknown',
      reason: 'probe_pending',
    };
  }

  private isStale(snapshot: MonitoringReachabilitySnapshot): boolean {
    if (snapshot.lastCheckedAt === undefined) return true;
    return this.now() - snapshot.lastCheckedAt >= this.ttlMs;
  }

  private startProbe(url: string): void {
    if (this.inFlight.has(url)) return;
    this.inFlight.add(url);

    void this.probe(url, this.timeoutMs)
      .then((reachable) => {
        const checkedAt = this.now();
        this.entries.set(url, reachable
          ? { status: 'reachable', url, lastCheckedAt: checkedAt }
          : { status: 'unreachable', lastCheckedAt: checkedAt, reason: 'probe_failed' });
      })
      .catch(() => {
        this.entries.set(url, {
          status: 'unreachable',
          lastCheckedAt: this.now(),
          reason: 'probe_failed',
        });
      })
      .finally(() => {
        this.inFlight.delete(url);
      });
  }
}

let monitoringReachabilityCache = new MonitoringReachabilityCache();

export function getCachedMonitoringReachability(url: string | undefined | null): MonitoringReachabilitySnapshot {
  return monitoringReachabilityCache.getCachedStatus(url);
}

export function _resetMonitoringReachabilityCacheForTests(options: MonitoringReachabilityCacheOptions = {}): void {
  monitoringReachabilityCache = new MonitoringReachabilityCache(options);
}
