import { beforeEach, describe, expect, it, jest } from '@jest/globals';

/**
 * Issue #151 (F3): route_task reports an error result as completed and
 * validated. Two defects are pinned here:
 *
 *  1. When an attempt's result is a subtask execution failure (every subtask
 *     returned an execution error), the attempt must not pass. The validation
 *     ladder must move on, and when every attempt fails the Job must end
 *     `failed` carrying the error (not `completed` with `validation.passed:
 *     true`).
 *  2. When both self and external validation are skipped, the attempt is
 *     recorded as `passed: null` (unverified), never `true`. The result is
 *     accepted but marked unverified (see REPORT.md for the ladder decision).
 */

jest.unstable_mockModule('../../../dist/utils/logger.js', () => ({
  logger: { debug: jest.fn(), error: jest.fn(), info: jest.fn(), warn: jest.fn() },
}));

jest.unstable_mockModule('../../../dist/config/index.js', () => ({
  config: {
    openRouterApiKey: 'test-key',
    openRouterFreeOnly: false,
    costThreshold: 0.02,
    reliableBenchmarkCount: 3,
    providerMaxConcurrentLocal: 1,
    cacheDir: 'test-cache',
    minValidatorScore: 0.5,
    rootDir: 'test-root',
  },
}));

const mockValidate = jest.fn();
const mockUpdateReputation = jest.fn();

jest.unstable_mockModule('../../../dist/modules/decision-engine/services/outputValidator.js', () => ({
  OutputValidator: { validate: mockValidate, updateReputation: mockUpdateReputation },
}));

const mockGetModelRegistry = jest.fn().mockReturnValue({
  getModel: jest.fn((modelId: string) => ({
    id: modelId,
    providerId: modelId.startsWith('openrouter:') ? 'openrouter' : 'ollama',
    displayName: modelId,
    contextWindow: 8000,
    benchmarkSummary: { benchmarkCount: 5, successRate: 0.8, qualityScore: 0.85, avgResponseTime: 2000, scores: { code: 0.9 } },
  })),
  listAll: jest.fn().mockReturnValue([
    { id: 'good-model', contextWindow: 8000 },
    { id: 'better-model', contextWindow: 8000 },
    { id: 'best-model', contextWindow: 8000 },
  ]),
});

jest.unstable_mockModule('../../../dist/modules/core/model/index.js', () => ({
  getModelRegistry: mockGetModelRegistry,
}));

const mockRouteTaskDecision = jest.fn().mockResolvedValue({
  provider: 'ollama',
  model: 'good-model',
  explanation: 'Routing decision.',
});

const mockGetBestValidatorModel = jest.fn().mockResolvedValue({
  id: 'best-validator',
  provider: 'ollama',
  costClass: 'local',
});

jest.unstable_mockModule('../../../dist/modules/decision-engine/index.js', () => ({
  decisionEngine: {
    routeTask: mockRouteTaskDecision,
    preemptiveRouting: jest.fn(),
    getBestValidatorModel: mockGetBestValidatorModel,
  },
}));

jest.unstable_mockModule('../../../dist/modules/user-preferences/index.js', () => ({
  loadUserPreferences: jest.fn().mockResolvedValue({}),
}));

jest.unstable_mockModule('../../../dist/modules/api-integration/cost-estimation/index.js', () => ({
  costEstimator: {
    estimateCost: jest.fn().mockResolvedValue({ local: { cost: { total: 0 } }, paid: { cost: { total: 0 } } }),
  },
}));

jest.unstable_mockModule('../../../dist/modules/api-integration/task-execution/index.js', () => ({
  taskExecutor: { executeTask: jest.fn().mockResolvedValue('generated response') },
}));

const mockCreateJob = jest.fn().mockResolvedValue('job-id');
const mockCompleteJob = jest.fn().mockResolvedValue(undefined);
const mockFailJob = jest.fn().mockResolvedValue(undefined);
const mockCancelJob = jest.fn().mockResolvedValue(undefined);
const mockGetJob = jest.fn();

jest.unstable_mockModule('../../../dist/modules/decision-engine/services/jobTracker.js', () => ({
  JobStatus: { COMPLETED: 'Completed', CANCELLED: 'Cancelled', FAILED: 'Failed' },
  getJobTracker: jest.fn().mockResolvedValue({
    createJob: mockCreateJob,
    completeJob: mockCompleteJob,
    failJob: mockFailJob,
    getJob: mockGetJob,
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

jest.unstable_mockModule('../../../dist/modules/job-store/index.js', () => ({
  insertTask: mockInsertTask,
  updateTask: mockUpdateTask,
  updateJob: mockUpdateJob,
  getTask: mockGetTask,
  getJobsByTaskId: mockGetJobsByTaskId,
  cancelJobsForTask: mockCancelJobsForTask,
  getQueuePositionForJob: mockGetQueuePositionForJob,
}));

jest.unstable_mockModule('../../../dist/modules/job-store/alert.js', () => ({
  refreshAlertState: jest.fn().mockResolvedValue(undefined),
}));

const mockProcessCodeTask = jest.fn();
const mockExecuteAllSubtasks = jest.fn();
const mockSynthesizeFinalResult = jest.fn();
const mockGetAvailableModels = jest.fn();

jest.unstable_mockModule('../../../dist/modules/decision-engine/services/codeTaskCoordinator.js', () => ({
  codeTaskCoordinator: {
    processCodeTask: mockProcessCodeTask,
    executeAllSubtasks: mockExecuteAllSubtasks,
    synthesizeFinalResult: mockSynthesizeFinalResult,
  },
}));

jest.unstable_mockModule('../../../dist/modules/cost-monitor/codeSearchEngine.js', () => ({
  getCodeSearchEngine: jest.fn(),
}));

const mockGetFreeModels = jest.fn().mockResolvedValue([]);

jest.unstable_mockModule('../../../dist/modules/cost-monitor/index.js', () => ({
  costMonitor: {
    getAvailableModels: mockGetAvailableModels,
    getFreeModels: mockGetFreeModels,
  },
}));

const mockHasRateLimitBudget = jest.fn().mockReturnValue(true);
const mockOpenRouterProvider = {
  id: 'openrouter',
  supportsModel: jest.fn().mockResolvedValue(true),
  hasRateLimitBudget: mockHasRateLimitBudget,
  executeTask: jest.fn(),
};
const mockOllamaProvider = {
  id: 'ollama',
  supportsModel: jest.fn().mockResolvedValue(true),
  executeTask: jest.fn(),
};

const mockRegistry = {
  list: jest.fn(() => [mockOllamaProvider, mockOpenRouterProvider]),
  has: jest.fn((providerId: string) => providerId === 'openrouter' || providerId === 'ollama'),
  isAvailable: jest.fn(() => true),
  getLocalExecutionQueueStats: jest.fn(() => ({ activeCount: 0, queuedCount: 0, activeBenchmarks: 0, queuedBenchmarks: 0 })),
  listByCostClass: jest.fn((costClass: string) => (costClass === 'local' ? [mockOllamaProvider] : [mockOpenRouterProvider])),
  get: jest.fn((providerId: string) => (providerId === 'openrouter' ? mockOpenRouterProvider : mockOllamaProvider)),
};

jest.unstable_mockModule('../../../dist/modules/core/provider/index.js', () => ({
  getProviderRegistry: jest.fn(() => mockRegistry),
  isProviderLocal: jest.fn((providerId: string) => providerId === 'ollama' || providerId === 'local'),
  providerCostClass: jest.fn((providerId: string) => (providerId === 'openrouter' ? 'paid' : 'local')),
}));

const { router } = await import('../../../dist/modules/api-integration/routing/index.js');

const rankedTrio = {
  good: { model_id: 'good-model', provider_id: 'ollama', benchmark_runs: 1, validation_score_seeded: false },
  better: { model_id: 'better-model', provider_id: 'ollama', benchmark_runs: 1, validation_score_seeded: false },
  best: { model_id: 'best-model', provider_id: 'ollama', benchmark_runs: 1, validation_score_seeded: false },
};

const subtaskFailureCode =
  'Error: Failed to execute subtask "Write the function" with model "good-model" (Provider: ollama): boom';

describe('route_task error result handling (issue #151)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetTask.mockResolvedValue(undefined);
    mockGetJobsByTaskId.mockResolvedValue([]);
    mockGetQueuePositionForJob.mockResolvedValue(1);
    mockCancelJobsForTask.mockResolvedValue(0);
    mockGetAvailableModels.mockResolvedValue([]);
    mockGetFreeModels.mockResolvedValue([]);
    mockHasRateLimitBudget.mockReturnValue(true);
    mockProcessCodeTask.mockResolvedValue({
      decomposedTask: {
        originalTask: 'Test task',
        subtasks: [{ id: 'subtask-1', complexity: 0.5 }],
        totalEstimatedTokens: 100,
        dependencyMap: {},
      },
      modelAssignments: new Map([['subtask-1', { id: 'good-model', provider: 'ollama' }]]),
      executionOrder: [{ id: 'subtask-1', complexity: 0.5 }],
      criticalPath: [{ id: 'subtask-1', complexity: 0.5 }],
      estimatedCost: 0,
    });
    mockExecuteAllSubtasks.mockResolvedValue(new Map([['subtask-1', 'subtask-result']]));
    mockSynthesizeFinalResult.mockResolvedValue('final code');
    mockGetBestValidatorModel.mockResolvedValue({ id: 'best-validator', provider: 'ollama', costClass: 'local' });
  });

  it('fails the job with the subtask error when every attempt returns a subtask execution failure', async () => {
    mockGetJobsByTaskId.mockResolvedValue([{ id: 'task-1', status: 'queued' }]);
    mockGetJob.mockReturnValue({ id: 'task-1', task: 'Test task', status: 'Queued', ranked_trio: rankedTrio });

    // The result code is itself a subtask failure. Validators are made to
    // "pass" to prove the subtask-failure check is independent of validation.
    mockSynthesizeFinalResult.mockResolvedValue(subtaskFailureCode);
    mockValidate.mockResolvedValue({ passed: true, confidence: 1.0, reason: 'validator passes', parsed_cleanly: true, skipped: false });

    await (router as any).runQueuedRouteTask('task-1', 'ollama', { task: 'Test task', contextLength: 100, validate: true });

    expect(mockCompleteJob).not.toHaveBeenCalled();
    expect(mockFailJob).toHaveBeenCalledWith('task-1', subtaskFailureCode, expect.any(Object));

    const validation = mockFailJob.mock.calls[0][2] as { passed: boolean; attempts: Array<{ passed: boolean }> };
    expect(validation.passed).toBe(false);
    expect(validation.attempts).toHaveLength(3);
    expect(validation.attempts.every((attempt) => attempt.passed === false)).toBe(true);
  });

  it('records the attempt as unverified (passed: null) when both validators are skipped', async () => {
    mockGetJobsByTaskId.mockResolvedValue([{ id: 'task-2', status: 'queued' }]);
    mockGetJob.mockReturnValue({ id: 'task-2', task: 'Test task', status: 'Queued', ranked_trio: rankedTrio });

    // Both self and external validation are skipped (provider error / no verdict).
    mockValidate.mockResolvedValue({ passed: null, confidence: 0, reason: 'validator unavailable', parsed_cleanly: false, skipped: true });

    await (router as any).runQueuedRouteTask('task-2', 'ollama', { task: 'Test task', contextLength: 100, validate: true });

    expect(mockFailJob).not.toHaveBeenCalled();
    expect(mockCompleteJob).toHaveBeenCalledWith(
      'task-2',
      ['final code'],
      expect.objectContaining({
        validate: true,
        passed: null,
        attempts: expect.arrayContaining([
          expect.objectContaining({
            passed: null,
            self_validation: expect.objectContaining({ skipped: true }),
            external_validation: expect.objectContaining({ skipped: true }),
          }),
        ]),
      }),
    );
  });
});
