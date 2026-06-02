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
    minValidatorScore: 0.5,
    rootDir: 'test-root',
  },
}));

const mockValidate = jest.fn();
const mockUpdateReputation = jest.fn();

jest.unstable_mockModule('../../../../dist/modules/decision-engine/services/outputValidator.js', () => ({
  OutputValidator: {
    validate: mockValidate,
    updateReputation: mockUpdateReputation,
  },
}));

const mockRegistryGetModel = jest.fn().mockImplementation((modelId) => {
  return {
    id: modelId,
    providerId: modelId.startsWith('openrouter:') ? 'openrouter' : 'ollama',
    displayName: modelId,
    contextWindow: 8000,
    benchmarkSummary: { benchmarkCount: 5, successRate: 0.8, qualityScore: 0.85, avgResponseTime: 2000, scores: { code: 0.9 } },
  };
});

const mockGetModelRegistry = jest.fn().mockReturnValue({
  getModel: mockRegistryGetModel,
  listAll: jest.fn().mockReturnValue([
    { id: 'good-model', contextWindow: 8000 },
    { id: 'better-model', contextWindow: 8000 },
    { id: 'best-model', contextWindow: 8000 },
  ]),
});

jest.unstable_mockModule('../../../../dist/modules/core/model/index.js', () => ({
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

jest.unstable_mockModule('../../../../dist/modules/decision-engine/index.js', () => ({
  decisionEngine: {
    routeTask: mockRouteTaskDecision,
    preemptiveRouting: jest.fn(),
    getBestValidatorModel: mockGetBestValidatorModel,
  },
}));

jest.unstable_mockModule('../../../../dist/modules/user-preferences/index.js', () => ({
  loadUserPreferences: jest.fn().mockResolvedValue({}),
}));

const mockEstimateCost = jest.fn().mockResolvedValue({
  local: { cost: { total: 0 } },
  paid: { cost: { total: 0 } },
});

jest.unstable_mockModule('../../../../dist/modules/api-integration/cost-estimation/index.js', () => ({
  costEstimator: { estimateCost: mockEstimateCost },
}));

const mockExecuteTask = jest.fn().mockResolvedValue('generated response');

jest.unstable_mockModule('../../../../dist/modules/api-integration/task-execution/index.js', () => ({
  taskExecutor: { executeTask: mockExecuteTask },
}));

const mockCreateJob = jest.fn().mockResolvedValue('job-id');
const mockCompleteJob = jest.fn().mockResolvedValue(undefined);
const mockFailJob = jest.fn().mockResolvedValue(undefined);
const mockCancelJob = jest.fn().mockResolvedValue(undefined);
const mockGetJob = jest.fn();

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
  isAvailable: jest.fn((providerId: string) => true),
  getLocalExecutionQueueStats: jest.fn(() => ({
    activeCount: 0,
    queuedCount: 0,
    activeBenchmarks: 0,
    queuedBenchmarks: 0,
  })),
  listByCostClass: jest.fn((costClass: string) => {
    if (costClass === 'local') {
      return [mockOllamaProvider];
    }
    return [mockOpenRouterProvider];
  }),
  get: jest.fn((providerId: string) => {
    if (providerId === 'openrouter') return mockOpenRouterProvider;
    return mockOllamaProvider;
  }),
};

jest.unstable_mockModule('../../../../dist/modules/core/provider/index.js', () => ({
  getProviderRegistry: jest.fn(() => mockRegistry),
  isProviderLocal: jest.fn((providerId: string) => providerId === 'ollama' || providerId === 'local'),
  providerCostClass: jest.fn((providerId: string) => (providerId === 'openrouter' ? 'paid' : 'local')),
}));

const { router } = await import('../../../../dist/modules/api-integration/routing/index.js');

describe('Synchronous Validation + Retry Loop (TDD)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetTask.mockResolvedValue(undefined);
    mockGetJobsByTaskId.mockResolvedValue([]);
    mockGetQueuePositionForJob.mockResolvedValue(1);
    mockCancelJobsForTask.mockResolvedValue(0);
    mockGetAvailableModels.mockResolvedValue([]);
    mockRegistryGetModel.mockImplementation((modelId) => {
      return {
        id: modelId,
        providerId: modelId.startsWith('openrouter:') ? 'openrouter' : 'ollama',
        displayName: modelId,
        contextWindow: 8000,
        benchmarkSummary: { benchmarkCount: 5, successRate: 0.8, qualityScore: 0.85, avgResponseTime: 2000, scores: { code: 0.9 } },
      };
    });
    mockGetFreeModels.mockResolvedValue([]);
    mockHasRateLimitBudget.mockReturnValue(true);

    mockProcessCodeTask.mockResolvedValue({
      decomposedTask: {
        originalTask: 'Test task',
        subtasks: [{ id: 'subtask-1', complexity: 0.5 }],
        totalEstimatedTokens: 100,
        dependencyMap: {},
      },
      modelAssignments: new Map([
        ['subtask-1', { id: 'good-model', provider: 'ollama' }]
      ]),
      executionOrder: [{ id: 'subtask-1', complexity: 0.5 }],
      criticalPath: [{ id: 'subtask-1', complexity: 0.5 }],
      estimatedCost: 0,
    });
    mockSynthesizeFinalResult.mockResolvedValue('final code');
  });

  it('bypasses validation entirely when validate: false is passed', async () => {
    mockGetJobsByTaskId.mockResolvedValueOnce([
      { id: 'task-1', status: 'queued' }
    ]);
    mockGetJob.mockReturnValueOnce({
      id: 'task-1',
      task: 'Test task',
      status: 'Queued',
      ranked_trio: {
        good: { model_id: 'good-model', provider_id: 'ollama', benchmark_runs: 1, validation_score_seeded: false },
        better: { model_id: 'better-model', provider_id: 'ollama', benchmark_runs: 1, validation_score_seeded: false },
        best: { model_id: 'best-model', provider_id: 'ollama', benchmark_runs: 1, validation_score_seeded: false }
      }
    });

    await (router as any).runQueuedRouteTask('task-1', 'ollama', {
      task: 'Test task',
      contextLength: 100,
      validate: false
    });

    expect(mockValidate).not.toHaveBeenCalled();
    expect(mockCompleteJob).toHaveBeenCalledWith('task-1', ['final code'], expect.objectContaining({
      validate: false,
      passed: true
    }));
  });

  it('escalates retry ladder good -> better -> best when validation fails', async () => {
    mockGetJobsByTaskId.mockResolvedValue([
      { id: 'task-2', status: 'queued' }
    ]);
    mockGetJob.mockReturnValue({
      id: 'task-2',
      task: 'Test task',
      status: 'Queued',
      ranked_trio: {
        good: { model_id: 'good-model', provider_id: 'ollama', benchmark_runs: 1, validation_score_seeded: false },
        better: { model_id: 'better-model', provider_id: 'ollama', benchmark_runs: 1, validation_score_seeded: false },
        best: { model_id: 'best-model', provider_id: 'ollama', benchmark_runs: 1, validation_score_seeded: false }
      }
    });

    // Mock validate:
    // good fails self-validation
    mockValidate.mockImplementation(async (task, output, provider, modelId) => {
      if (modelId === 'good-model') {
        return { passed: false, confidence: 1.0, reason: 'Good model bad code', parsed_cleanly: true, skipped: false };
      }
      if (modelId === 'better-model') {
        return { passed: false, confidence: 1.0, reason: 'Better model bad code', parsed_cleanly: true, skipped: false };
      }
      if (modelId === 'best-model') {
        return { passed: true, confidence: 1.0, reason: 'Best model good code', parsed_cleanly: true, skipped: false };
      }
      if (modelId === 'best-validator') {
        return { passed: true, confidence: 1.0, reason: 'Validator passed', parsed_cleanly: true, skipped: false };
      }
      return { passed: true, confidence: 1.0, reason: 'Default pass', parsed_cleanly: true, skipped: false };
    });

    await (router as any).runQueuedRouteTask('task-2', 'ollama', {
      task: 'Test task',
      contextLength: 100,
      validate: true
    });

    // Should complete the job with the best model output
    expect(mockCompleteJob).toHaveBeenCalledWith('task-2', ['final code'], expect.objectContaining({
      validate: true,
      passed: true,
      attempts: expect.arrayContaining([
        expect.objectContaining({ model_id: 'good-model', passed: false }),
        expect.objectContaining({ model_id: 'better-model', passed: false }),
        expect.objectContaining({ model_id: 'best-model', passed: true }),
      ])
    }));
    expect(mockUpdateReputation).toHaveBeenCalledWith('good-model', true);
    expect(mockUpdateReputation).toHaveBeenCalledWith('better-model', true);
    expect(mockUpdateReputation).toHaveBeenCalledWith('best-model', true);
  });

  it('skips self-validation when rate limit budget is exhausted', async () => {
    mockGetJobsByTaskId.mockResolvedValue([
      { id: 'task-3', status: 'queued' }
    ]);
    mockGetJob.mockReturnValue({
      id: 'task-3',
      task: 'Test task',
      status: 'Queued',
      ranked_trio: {
        good: { model_id: 'openrouter:free-model', provider_id: 'openrouter', benchmark_runs: 1, validation_score_seeded: false },
        better: { model_id: 'better-model', provider_id: 'ollama', benchmark_runs: 1, validation_score_seeded: false },
        best: { model_id: 'best-model', provider_id: 'ollama', benchmark_runs: 1, validation_score_seeded: false }
      }
    });

    mockGetFreeModels.mockResolvedValue([{ id: 'openrouter:free-model' }]);
    mockHasRateLimitBudget.mockReturnValue(false); // exhausted!

    mockValidate.mockResolvedValue({ passed: true, confidence: 1.0, reason: 'Passes validation', parsed_cleanly: true, skipped: false });

    await (router as any).runQueuedRouteTask('task-3', 'openrouter', {
      task: 'Test task',
      contextLength: 100,
      validate: true
    });

    expect(mockCompleteJob).toHaveBeenCalledWith('task-3', ['final code'], expect.objectContaining({
      validate: true,
      passed: true,
      attempts: expect.arrayContaining([
        expect.objectContaining({
          model_id: 'openrouter:free-model',
          self_validation: expect.objectContaining({ skipped: true }),
          passed: true // skipped + passed external = passed
        })
      ])
    }));
  });

  it('fails job when best model also fails validation', async () => {
    mockGetJobsByTaskId.mockResolvedValue([
      { id: 'task-4', status: 'queued' }
    ]);
    mockGetJob.mockReturnValue({
      id: 'task-4',
      task: 'Test task',
      status: 'Queued',
      ranked_trio: {
        good: { model_id: 'good-model', provider_id: 'ollama', benchmark_runs: 1, validation_score_seeded: false },
        better: { model_id: 'better-model', provider_id: 'ollama', benchmark_runs: 1, validation_score_seeded: false },
        best: { model_id: 'best-model', provider_id: 'ollama', benchmark_runs: 1, validation_score_seeded: false }
      }
    });

    // All fail self-validation
    mockValidate.mockResolvedValue({ passed: false, confidence: 1.0, reason: 'Failure', parsed_cleanly: true, skipped: false });

    await (router as any).runQueuedRouteTask('task-4', 'ollama', {
      task: 'Test task',
      contextLength: 100,
      validate: true
    });

    expect(mockFailJob).toHaveBeenCalledWith(
      'task-4',
      expect.stringContaining('Validation failed on all attempts'),
      expect.any(Object)
    );
  });
});
