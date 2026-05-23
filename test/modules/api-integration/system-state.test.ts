import { describe, it, expect, jest, beforeEach } from '@jest/globals';

// ── Mocks ─────────────────────────────────────────────────────────────────────

jest.unstable_mockModule('../../../dist/utils/logger.js', () => ({
  logger: { error: jest.fn(), warn: jest.fn(), info: jest.fn(), debug: jest.fn() },
}));

const mockGetQueuedJobCounts = jest.fn<() => Promise<{ local: number; byProvider: Record<string, number> }>>();

jest.unstable_mockModule('../../../dist/modules/job-store/db.js', () => ({
  getQueuedJobCounts: mockGetQueuedJobCounts,
}));

const mockGetLocalExecutionQueueStats = jest.fn<() => { activeCount: number; queuedCount: number; activeBenchmarks: number; queuedBenchmarks: number }>();
const mockList = jest.fn<() => { id: string; isLocal: boolean; costClass: 'local' | 'free' | 'paid' }[]>();
const mockIsAvailable = jest.fn<(id: string) => boolean>();

jest.unstable_mockModule('../../../dist/modules/core/provider/index.js', () => ({
  getProviderRegistry: () => ({
    getLocalExecutionQueueStats: mockGetLocalExecutionQueueStats,
    list: mockList,
    isAvailable: mockIsAvailable,
  }),
}));

// ── Module import (after mocks) ───────────────────────────────────────────────

const { getSystemState } = await import('../../../dist/modules/api-integration/system-state/index.js');

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('getSystemState', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetQueuedJobCounts.mockResolvedValue({ local: 0, byProvider: {} });
    mockList.mockReturnValue([]);
    mockIsAvailable.mockReturnValue(true);
  });

  it('returns healthy status when local slot is idle and no remote providers are down', async () => {
    mockGetLocalExecutionQueueStats.mockReturnValue({
      activeCount: 0,
      queuedCount: 0,
      activeBenchmarks: 0,
      queuedBenchmarks: 0,
    });

    const state = await getSystemState();

    expect(state.status).toBe('healthy');
    expect(state.reasons).toHaveLength(0);
    expect(state.poll_again_after_ms).toBe(30_000);
    expect(state.local_slot.status).toBe('idle');
    expect(state.local_slot.queued_jobs).toBe(0);
    expect(state.local_slot.active_benchmark_runs).toBe(0);
    expect(state.local_slot.queued_benchmark_runs).toBe(0);
    expect(state.remote_providers).toHaveLength(0);
  });

  it('returns healthy with inference status when a task job is active', async () => {
    mockGetLocalExecutionQueueStats.mockReturnValue({
      activeCount: 1,
      queuedCount: 0,
      activeBenchmarks: 0,
      queuedBenchmarks: 0,
    });
    mockGetQueuedJobCounts.mockResolvedValue({ local: 2, byProvider: {} });

    const state = await getSystemState();

    expect(state.status).toBe('healthy');
    expect(state.local_slot.status).toBe('inference');
    expect(state.local_slot.queued_jobs).toBe(2);
  });

  it('returns contended with local_slot_benchmark_contention when a benchmark is active', async () => {
    mockGetLocalExecutionQueueStats.mockReturnValue({
      activeCount: 1,
      queuedCount: 0,
      activeBenchmarks: 1,
      queuedBenchmarks: 0,
    });

    const state = await getSystemState();

    expect(state.status).toBe('contended');
    expect(state.reasons).toContain('local_slot_benchmark_contention');
    expect(state.reasons).not.toContain('benchmark_queued');
    expect(state.poll_again_after_ms).toBe(5_000);
    expect(state.local_slot.status).toBe('benchmark');
    expect(state.local_slot.active_benchmark_runs).toBe(1);
  });

  it('includes benchmark_queued reason when benchmarks are waiting in queue', async () => {
    mockGetLocalExecutionQueueStats.mockReturnValue({
      activeCount: 1,
      queuedCount: 1,
      activeBenchmarks: 1,
      queuedBenchmarks: 2,
    });

    const state = await getSystemState();

    expect(state.status).toBe('contended');
    expect(state.reasons).toContain('local_slot_benchmark_contention');
    expect(state.reasons).toContain('benchmark_queued');
    expect(state.local_slot.queued_benchmark_runs).toBe(2);
  });

  it('returns degraded with provider_unavailable when a remote provider circuit is open', async () => {
    mockGetLocalExecutionQueueStats.mockReturnValue({
      activeCount: 0,
      queuedCount: 0,
      activeBenchmarks: 0,
      queuedBenchmarks: 0,
    });
    mockList.mockReturnValue([{ id: 'openrouter', isLocal: false, costClass: 'free' }]);
    mockIsAvailable.mockReturnValue(false);
    mockGetQueuedJobCounts.mockResolvedValue({ local: 0, byProvider: { openrouter: 1 } });

    const state = await getSystemState();

    expect(state.status).toBe('degraded');
    expect(state.reasons).toContain('provider_unavailable');
    expect(state.poll_again_after_ms).toBe(10_000);
    expect(state.remote_providers).toHaveLength(1);
    expect(state.remote_providers[0]).toMatchObject({
      id: 'openrouter',
      cost_class: 'free',
      available: false,
      queued_jobs: 1,
    });
  });

  it('degraded beats contended when both conditions are active', async () => {
    mockGetLocalExecutionQueueStats.mockReturnValue({
      activeCount: 1,
      queuedCount: 0,
      activeBenchmarks: 1,
      queuedBenchmarks: 0,
    });
    mockList.mockReturnValue([{ id: 'openrouter', isLocal: false, costClass: 'free' }]);
    mockIsAvailable.mockReturnValue(false);

    const state = await getSystemState();

    expect(state.status).toBe('degraded');
    expect(state.reasons).toContain('local_slot_benchmark_contention');
    expect(state.reasons).toContain('provider_unavailable');
  });

  it('deduplicates provider_unavailable when multiple providers are down', async () => {
    mockGetLocalExecutionQueueStats.mockReturnValue({
      activeCount: 0,
      queuedCount: 0,
      activeBenchmarks: 0,
      queuedBenchmarks: 0,
    });
    mockList.mockReturnValue([
      { id: 'openrouter', isLocal: false, costClass: 'free' },
      { id: 'openai', isLocal: false, costClass: 'paid' },
    ]);
    mockIsAvailable.mockReturnValue(false);

    const state = await getSystemState();

    expect(state.status).toBe('degraded');
    expect(state.reasons.filter((r) => r === 'provider_unavailable')).toHaveLength(1);
    expect(state.remote_providers).toHaveLength(2);
  });

  it('excludes local providers from remote_providers array', async () => {
    mockGetLocalExecutionQueueStats.mockReturnValue({
      activeCount: 0,
      queuedCount: 0,
      activeBenchmarks: 0,
      queuedBenchmarks: 0,
    });
    mockList.mockReturnValue([
      { id: 'ollama', isLocal: true, costClass: 'local' },
      { id: 'lm-studio', isLocal: true, costClass: 'local' },
      { id: 'openrouter', isLocal: false, costClass: 'free' },
    ]);
    mockIsAvailable.mockReturnValue(true);

    const state = await getSystemState();

    expect(state.remote_providers).toHaveLength(1);
    expect(state.remote_providers[0].id).toBe('openrouter');
  });
});
