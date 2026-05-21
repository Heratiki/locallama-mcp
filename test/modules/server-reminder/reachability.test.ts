import { describe, expect, it, jest } from '@jest/globals';
import { MonitoringReachabilityCache, type ReachabilityProbe } from '../../../dist/modules/server-reminder/reachability.js';

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
    await Promise.resolve();

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
    await Promise.resolve();

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
    await Promise.resolve();
    now += 4_999;
    cache.getCachedStatus('http://127.0.0.1:8080');

    expect(probe).toHaveBeenCalledTimes(1);
  });
});
