import { beforeEach, describe, expect, it, jest } from '@jest/globals';

jest.unstable_mockModule('../../../../dist/utils/logger.js', () => ({
  logger: {
    debug: jest.fn(),
    error: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
  },
}));

jest.unstable_mockModule('../../../../dist/config/index.js', () => ({
  config: {
    openRouterApiKey: 'test-key',
    openRouterFreeOnly: false,
    costThreshold: 0.02,
    reliableBenchmarkCount: 3,
    providerMaxConcurrentLocal: 1,
    cacheDir: 'test-cache',
  },
}));

const mockRegistryGetModel = jest.fn().mockImplementation((modelId) => {
    if (modelId === 'qwen2.5-coder:7b') {
      return {
        id: 'qwen2.5-coder:7b',
        providerId: 'ollama',
        displayName: 'Qwen 2.5 Coder 7B',
        benchmarkSummary: { benchmarkCount: 5, successRate: 0.8, qualityScore: 0.85, avgResponseTime: 2000, scores: { code: 0.9 } },
      };
    }
    if (modelId === 'llama3:8b') {
      return {
        id: 'llama3:8b',
        providerId: 'ollama',
        displayName: 'Llama 3 8B',
        benchmarkSummary: { benchmarkCount: 2, successRate: 0.6, qualityScore: 0.7, avgResponseTime: 3000, scores: { code: 0.75 } },
      };
    }
    if (modelId === 'phi3:3.8b') {
      return {
        id: 'phi3:3.8b',
        providerId: 'ollama',
        displayName: 'Phi 3 3.8B',
        benchmarkSummary: { benchmarkCount: 0, successRate: 0, qualityScore: 0, avgResponseTime: 0 },
      };
    }
    return undefined;
  });

const mockGetModelRegistry = jest.fn().mockReturnValue({
  getModel: mockRegistryGetModel,
  listAll: jest.fn().mockReturnValue([
    { id: 'qwen2.5-coder:7b', contextWindow: 8000 },
    { id: 'llama3:8b', contextWindow: 8000 },
    { id: 'phi3:3.8b', contextWindow: 8000 },
  ]),
});

jest.unstable_mockModule('../../../../dist/modules/core/model/index.js', () => ({
  getModelRegistry: mockGetModelRegistry,
}));

const mockOpenRouterModelTracking = {
  models: {},
  lastUpdated: new Date().toISOString(),
  freeModels: [],
  freeModelHealth: {},
};

jest.unstable_mockModule('../../../../dist/modules/openrouter/index.js', () => ({
  openRouterModule: {
    modelTracking: mockOpenRouterModelTracking,
    getProviderFromModelId: jest.fn((modelId: string) => modelId.split('/')[0] || 'unknown'),
  },
}));

const mockRouteTaskDecision = jest.fn().mockResolvedValue({
  provider: 'paid',
  model: 'openai/gpt-4o',
  explanation: 'Complex task selected paid model.',
});

jest.unstable_mockModule('../../../../dist/modules/decision-engine/index.js', () => ({
  decisionEngine: {
    routeTask: mockRouteTaskDecision,
    preemptiveRouting: jest.fn(),
  },
}));

jest.unstable_mockModule('../../../../dist/modules/user-preferences/index.js', () => ({
  loadUserPreferences: jest.fn().mockResolvedValue({}),
}));

const mockEstimateCost = jest.fn().mockResolvedValue({
  local: { cost: { total: 0 } },
  paid: { cost: { total: 0.0012 } },
});

jest.unstable_mockModule('../../../../dist/modules/api-integration/cost-estimation/index.js', () => ({
  costEstimator: { estimateCost: mockEstimateCost },
}));

const mockExecuteTask = jest.fn().mockResolvedValue('paid OpenRouter response');

jest.unstable_mockModule('../../../../dist/modules/api-integration/task-execution/index.js', () => ({
  taskExecutor: { executeTask: mockExecuteTask },
}));

const mockCreateJob = jest.fn().mockResolvedValue('job-id');
const mockCompleteJob = jest.fn().mockResolvedValue(undefined);
const mockFailJob = jest.fn().mockResolvedValue(undefined);
const mockCancelJob = jest.fn().mockResolvedValue(undefined);

jest.unstable_mockModule('../../../../dist/modules/decision-engine/services/jobTracker.js', () => ({
  JobStatus: {
    COMPLETED: 'Completed',
    CANCELLED: 'Cancelled',
    FAILED: 'Failed',
  },
  getJobTracker: jest.fn().mockResolvedValue({
    createJob: mockCreateJob,
    completeJob: mockCompleteJob,
    failJob: mockFailJob,
    getJob: jest.fn(),
    cancelJob: mockCancelJob,
  }),
}));

const mockInsertTask = jest.fn().mockResolvedValue(undefined);
const mockUpdateTask = jest.fn().mockResolvedValue(undefined);
const mockUpdateJob = jest.fn().mockResolvedValue(undefined);
const mockGetTask = jest.fn();
const mockGetJobsByTaskId = jest.fn();
const mockCancelJobsForTask = jest.fn();
const mockGetQueuePositionForJob = jest.fn().mockResolvedValue(1);

jest.unstable_mockModule('../../../../dist/modules/job-store/index.js', () => ({
  insertTask: mockInsertTask,
  updateTask: mockUpdateTask,
  updateJob: mockUpdateJob,
  getTask: mockGetTask,
  getJobsByTaskId: mockGetJobsByTaskId,
  cancelJobsForTask: mockCancelJobsForTask,
  getQueuePositionForJob: mockGetQueuePositionForJob,
}));

const mockRefreshAlertState = jest.fn().mockResolvedValue(undefined);

jest.unstable_mockModule('../../../../dist/modules/job-store/alert.js', () => ({
  refreshAlertState: mockRefreshAlertState,
}));

const mockProcessCodeTask = jest.fn();
const mockExecuteAllSubtasks = jest.fn();
const mockSynthesizeFinalResult = jest.fn();
const mockGetAvailableModels = jest.fn();

jest.unstable_mockModule('../../../../dist/modules/decision-engine/services/codeTaskCoordinator.js', () => ({
  codeTaskCoordinator: {
    processCodeTask: mockProcessCodeTask,
    executeAllSubtasks: mockExecuteAllSubtasks,
    synthesizeFinalResult: mockSynthesizeFinalResult,
  },
}));

jest.unstable_mockModule('../../../../dist/modules/cost-monitor/codeSearchEngine.js', () => ({
  getCodeSearchEngine: jest.fn(),
}));

const mockGetFreeModels = jest.fn().mockResolvedValue([]);

jest.unstable_mockModule('../../../../dist/modules/cost-monitor/index.js', () => ({
  costMonitor: {
    getAvailableModels: mockGetAvailableModels,
    getFreeModels: mockGetFreeModels,
  },
}));

const mockOpenRouterProvider = {
  id: 'openrouter',
  supportsModel: jest.fn().mockResolvedValue(true),
};

const mockRegistry = {
  list: jest.fn(() => [mockOpenRouterProvider]),
  has: jest.fn((providerId: string) => providerId === 'openrouter' || providerId === 'ollama' || providerId === 'lm-studio'),
  isAvailable: jest.fn((providerId: string) => providerId !== 'ollama' && providerId !== 'lm-studio'),
  getLocalExecutionQueueStats: jest.fn(() => ({
    activeCount: 0,
    queuedCount: 0,
    activeBenchmarks: 0,
    queuedBenchmarks: 0,
  })),
  listByCostClass: jest.fn((costClass: string) => {
    if (costClass === 'local') {
      return [{ id: 'ollama' }, { id: 'lm-studio' }];
    }
    return [mockOpenRouterProvider];
  }),
};

jest.unstable_mockModule('../../../../dist/modules/core/provider/index.js', () => ({
  getProviderRegistry: jest.fn(() => mockRegistry),
  isProviderLocal: jest.fn((providerId: string) => providerId === 'ollama' || providerId === 'lm-studio' || providerId === 'local'),
  providerCostClass: jest.fn((providerId: string) => (providerId === 'openrouter' || providerId === 'paid' ? 'paid' : 'local')),
}));

const mockDispatcherCancel = jest.fn(() => true);

jest.unstable_mockModule('../../../../dist/modules/patch/dispatcher/index.js', () => ({
  getPatchDispatcher: () => ({ cancel: mockDispatcherCancel }),
}));

const { getTaskStatus, cancelTask } = await import('../../../../dist/modules/api-integration/routing/index.js');

const patchResult = {
  schema: 'patch_result_v1', status: 'passed', reason: 'passed', diff: 'diff --git a/a.ts b/a.ts\n', base: 'b1',
  files_changed: ['a.ts'], checks: [{ name: 'tsc', exit_code: 0, timed_out: false, duration_ms: 5, tail: '' }],
  attempts: 1, models: [{ model_id: 'm', provider_id: 'p', cost_class: 'local', attempts: 1 }],
  tokens: { local: 10, free: 0, paid: 0 }, cost_usd: 0, elapsed_ms: 100, diagnosis: null,
};

const row = (over: Record<string, unknown>) => ({
  id: 'job-1', task_id: 'task-1', status: 'completed', provider_id: null, model_id: null, task_text: 't',
  result: null, error: null, queue_position: null, progress_pct: 0, poll_again_after_ms: null, retry_count: 0,
  created_at: 1, started_at: 1, completed_at: 2, ...over,
});

const task = (id: string, status = 'completed') => ({
  id, status, job_count: 1, completed_count: 1, failed_count: 0, created_at: 1,
});

describe('routing patch branches', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetTask.mockResolvedValue(undefined);
    mockGetJobsByTaskId.mockResolvedValue([]);
    mockCancelJobsForTask.mockResolvedValue(0);
  });

  it('AC4: get_task_status returns the patch_result_v1 object for a patch Job, not a string', async () => {
    mockGetTask.mockResolvedValueOnce(task('task-p'));
    mockGetJobsByTaskId.mockResolvedValueOnce([
      row({ id: 'pj', task_id: 'task-p', kind: 'patch', result: JSON.stringify(patchResult) }),
    ]);
    const status = await getTaskStatus('task-p');
    expect(status.jobs[0].result).toEqual(patchResult);
    expect(typeof status.jobs[0].result).toBe('object');
  });

  it('AC4: a failed patch Job returns its diagnosis object and error code', async () => {
    const failed = { ...patchResult, status: 'failed', reason: 'budget_attempts', diff: '', files_changed: [],
      diagnosis: { last_errors: 'x', best_diff: '', attempts: [] } };
    mockGetTask.mockResolvedValueOnce(task('task-f', 'failed'));
    mockGetJobsByTaskId.mockResolvedValueOnce([
      row({ id: 'pf', task_id: 'task-f', kind: 'patch', status: 'failed', error: 'budget_attempts', result: JSON.stringify(failed) }),
    ]);
    const status = await getTaskStatus('task-f');
    expect(status.jobs[0]).toMatchObject({ status: 'failed', error: 'budget_attempts', result: failed });
  });

  it('AC4: route Jobs return as before (string, array joined, null kind)', async () => {
    mockGetTask.mockResolvedValueOnce(task('task-r'));
    mockGetJobsByTaskId.mockResolvedValueOnce([
      row({ id: 'r1', task_id: 'task-r', result: JSON.stringify(['a', 'b']) }),
      row({ id: 'r2', task_id: 'task-r', kind: null, result: JSON.stringify({ x: 1 }) }),
      row({ id: 'r3', task_id: 'task-r', kind: 'route', result: 'not json' }),
    ]);
    const status = await getTaskStatus('task-r');
    expect(status.jobs.map(j => j.result)).toEqual(['a\nb', '[object Object]', 'not json']);
  });

  it('AC6: cancel_task on a patch Job sets the row cancelled and aborts its worker', async () => {
    mockGetTask.mockResolvedValueOnce(task('task-c', 'in_progress')).mockResolvedValueOnce(task('task-c', 'cancelled'));
    mockCancelJobsForTask.mockResolvedValueOnce(1);
    mockGetJobsByTaskId.mockResolvedValue([row({ id: 'pc', task_id: 'task-c', kind: 'patch', status: 'cancelled' })]);
    const result = await cancelTask('task-c');
    expect(mockCancelJobsForTask).toHaveBeenCalledWith('task-c');
    expect(mockDispatcherCancel).toHaveBeenCalledWith('pc');
    expect(mockCancelJobsForTask.mock.invocationCallOrder[0])
      .toBeLessThan(mockDispatcherCancel.mock.invocationCallOrder[0]);
    expect(result).toMatchObject({ success: true, cancelled_count: 1, status: 'cancelled' });
  });

  it('AC6: cancel_task on a route-only task does not touch the patch dispatcher', async () => {
    mockGetTask.mockResolvedValueOnce(task('task-x', 'in_progress')).mockResolvedValueOnce(task('task-x', 'cancelled'));
    mockCancelJobsForTask.mockResolvedValueOnce(1);
    mockGetJobsByTaskId.mockResolvedValue([row({ id: 'rx', task_id: 'task-x', status: 'cancelled' })]);
    const result = await cancelTask('task-x');
    expect(mockDispatcherCancel).not.toHaveBeenCalled();
    expect(result).toMatchObject({ success: true, cancelled_count: 1 });
  });
});
