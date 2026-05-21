import { describe, expect, it, jest } from '@jest/globals';
import {
  MonitoringReachabilityCache,
  getCachedMonitoringReachability,
  _resetMonitoringReachabilityCacheForTests,
  type ReachabilityProbe,
} from '../../../dist/modules/server-reminder/reachability.js';

async function flushProbeCompletion(): Promise<void> {
  await Promise.resolve();
  await new Promise<void>((resolve) => setImmediate(resolve));
}

describe('MonitoringReachabilityCache', () => {
  it('returns immediately with unknown while scheduling the first probe', () => {
    const probe = jest.fn<ReachabilityProbe>(() => new Promise(() => undefined));
    const cache = new MonitoringReachabilityCache({ probe, now: () => 1_000 });

    const snapshot = cache.getCachedStatus('http://127.0.0.1:8080');

    expect(snapshot).toMatchObject({ status: 'unknown' });
    expect(snapshot.url).toBeUndefined();
    expect(probe).toHaveBeenCalledTimes(1);
    expect(probe).toHaveBeenCalledWith('http://127.0.0.1:8080', expect.any(Number));
  });

  it('uses cached reachable status and exposes the URL after a background probe succeeds', async () => {
    const probe = jest.fn<ReachabilityProbe>(async () => true);
    const cache = new MonitoringReachabilityCache({ probe, now: () => 1_000 });

    cache.getCachedStatus('http://127.0.0.1:8080');
    await flushProbeCompletion();

    const snapshot = cache.getCachedStatus('http://127.0.0.1:8080');

    expect(snapshot).toMatchObject({
      status: 'reachable',
      url: 'http://127.0.0.1:8080',
      lastCheckedAt: 1_000,
    });
    expect(probe).toHaveBeenCalledTimes(1);
  });

  it('uses cached unreachable status without exposing the URL after a probe fails', async () => {
    const probe = jest.fn<ReachabilityProbe>(async () => false);
    const cache = new MonitoringReachabilityCache({ probe, now: () => 1_000 });

    cache.getCachedStatus('http://127.0.0.1:8080');
    await flushProbeCompletion();

    const snapshot = cache.getCachedStatus('http://127.0.0.1:8080');

    expect(snapshot).toMatchObject({
      status: 'unreachable',
      lastCheckedAt: 1_000,
    });
    expect(snapshot.url).toBeUndefined();
    expect(probe).toHaveBeenCalledTimes(1);
  });

  it('does not start another probe while cached status is fresh', async () => {
    let now = 1_000;
    const probe = jest.fn<ReachabilityProbe>(async () => true);
    const cache = new MonitoringReachabilityCache({ probe, now: () => now, ttlMs: 5_000 });

    cache.getCachedStatus('http://127.0.0.1:8080');
    await flushProbeCompletion();
    now += 4_999;
    cache.getCachedStatus('http://127.0.0.1:8080');

    expect(probe).toHaveBeenCalledTimes(1);
  });

  it('starts a new probe when cached status reaches the TTL boundary', async () => {
    let now = 1_000;
    const probe = jest.fn<ReachabilityProbe>(async () => true);
    const cache = new MonitoringReachabilityCache({ probe, now: () => now, ttlMs: 5_000 });

    cache.getCachedStatus('http://127.0.0.1:8080');
    await flushProbeCompletion();
    now += 5_000;
    cache.getCachedStatus('http://127.0.0.1:8080');

    expect(probe).toHaveBeenCalledTimes(2);
  });

  it('deduplicates concurrent callers so only one in-flight probe runs per URL', async () => {
    const releaseProbe = Promise.withResolvers<void>();
    const probe = jest.fn<ReachabilityProbe>(async () => {
      await releaseProbe.promise;
      return true;
    });
    const cache = new MonitoringReachabilityCache({ probe, now: () => 1_000 });

    const snapshots = await Promise.all(
      Array.from({ length: 20 }, () => Promise.resolve(cache.getCachedStatus('http://127.0.0.1:8080'))),
    );

    expect(probe).toHaveBeenCalledTimes(1);
    expect(snapshots.every((snapshot) => snapshot.status === 'unknown')).toBe(true);
    releaseProbe.resolve();
    await Promise.resolve();
  });

  it('stores unreachable probe_failed status when the probe rejects', async () => {
    const probe = jest.fn<ReachabilityProbe>(async () => {
      throw new Error('probe failed');
    });
    const cache = new MonitoringReachabilityCache({ probe, now: () => 1_000 });

    cache.getCachedStatus('http://127.0.0.1:8080');
    await flushProbeCompletion();

    const snapshot = cache.getCachedStatus('http://127.0.0.1:8080');

    expect(snapshot).toMatchObject({
      status: 'unreachable',
      lastCheckedAt: 1_000,
      reason: 'probe_failed',
    });
    expect(snapshot.url).toBeUndefined();
  });

  it('returns monitoring_url_unavailable and skips probing when URL is absent', () => {
    const probe = jest.fn<ReachabilityProbe>(async () => true);
    const cache = new MonitoringReachabilityCache({ probe, now: () => 1_000 });

    const snapshot = cache.getCachedStatus(undefined);

    expect(snapshot).toEqual({ status: 'unknown', reason: 'monitoring_url_unavailable' });
    expect(probe).not.toHaveBeenCalled();
  });

  it('resets singleton cache state on restart so probe scheduling starts fresh', async () => {
    const pendingProbe = Promise.withResolvers<boolean>();
    const probe = jest.fn<ReachabilityProbe>(() => pendingProbe.promise);
    _resetMonitoringReachabilityCacheForTests({ now: () => 1_000, probe });

    const first = getCachedMonitoringReachability('http://127.0.0.1:8080');
    const second = getCachedMonitoringReachability('http://127.0.0.1:8080');

    expect(first.status).toBe('unknown');
    expect(second.status).toBe('unknown');
    expect(probe).toHaveBeenCalledTimes(1);

    _resetMonitoringReachabilityCacheForTests({ now: () => 1_000, probe });
    getCachedMonitoringReachability('http://127.0.0.1:8080');
    expect(probe).toHaveBeenCalledTimes(2);
    pendingProbe.resolve(true);
    await flushProbeCompletion();
  });
});
