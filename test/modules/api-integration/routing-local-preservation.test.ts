import { beforeEach, describe, expect, it, jest } from '@jest/globals';

/**
 * Issue #150 (F2): a local route_task decision survives decomposition with a
 * subtask assignment whose `provider` is the model id (e.g. `llama3.2:3b`),
 * so no registered provider can execute the subtask.
 *
 * These tests pin the two routing-side guarantees:
 *  1. `preserveLocalDecisionModelAssignments` must not keep (or install) an
 *     assignment whose provider is not a registered provider when a valid
 *     local model entry is available.
 *  2. When no valid replacement entry exists, the provider on an
 *     id-matching assignment must be repaired by probing the provider
 *     registry instead of being left as the model id.
 */

jest.unstable_mockModule('../../../dist/utils/logger.js', () => ({
  logger: {
    debug: jest.fn(),
    error: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
  },
}));

jest.unstable_mockModule('../../../dist/config/index.js', () => ({
  config: {
    openRouterApiKey: 'test-key',
    openRouterFreeOnly: false,
    costThreshold: 0.02,
    reliableBenchmarkCount: 3,
    providerMaxConcurrentLocal: 1,
    cacheDir: 'test-cache',
  },
}));

jest.unstable_mockModule('../../../dist/modules/core/model/index.js', () => ({
  getModelRegistry: jest.fn().mockReturnValue({
    getModel: jest.fn().mockReturnValue(undefined),
    listAll: jest.fn().mockReturnValue([{ id: 'llama3.2:3b', contextWindow: 8192 }]),
  }),
}));

jest.unstable_mockModule('../../../dist/modules/openrouter/index.js', () => ({
  openRouterModule: {
    modelTracking: { models: {}, freeModels: [], freeModelHealth: {} },
    getProviderFromModelId: jest.fn((modelId: string) => modelId.split('/')[0] || 'unknown'),
  },
}));

const mockRouteTaskDecision = jest.fn().mockResolvedValue({
  provider: 'paid',
  model: 'openai/gpt-4o',
  explanation: 'Complex task selected paid model.',
});

jest.unstable_mockModule('../../../dist/modules/decision-engine/index.js', () => ({
  decisionEngine: {
    routeTask: mockRouteTaskDecision,
    preemptiveRouting: jest.fn(),
  },
}));

jest.unstable_mockModule('../../../dist/modules/user-preferences/index.js', () => ({
  loadUserPreferences: jest.fn().mockResolvedValue({}),
}));

jest.unstable_mockModule('../../../dist/modules/api-integration/cost-estimation/index.js', () => ({
  costEstimator: {
    estimateCost: jest.fn().mockResolvedValue({
      local: { cost: { total: 0 } },
      paid: { cost: { total: 0.0012 } },
    }),
  },
}));

jest.unstable_mockModule('../../../dist/modules/api-integration/task-execution/index.js', () => ({
  taskExecutor: { executeTask: jest.fn().mockResolvedValue('paid OpenRouter response') },
}));

jest.unstable_mockModule('../../../dist/modules/decision-engine/services/jobTracker.js', () => ({
  JobStatus: {
    COMPLETED: 'Completed',
    CANCELLED: 'Cancelled',
    FAILED: 'Failed',
  },
  getJobTracker: jest.fn().mockResolvedValue({
    createJob: jest.fn().mockResolvedValue('job-id'),
    completeJob: jest.fn().mockResolvedValue(undefined),
    failJob: jest.fn().mockResolvedValue(undefined),
    getJob: jest.fn(),
    cancelJob: jest.fn(),
  }),
}));

jest.unstable_mockModule('../../../dist/modules/job-store/index.js', () => ({
  insertTask: jest.fn().mockResolvedValue(undefined),
  updateTask: jest.fn().mockResolvedValue(undefined),
  updateJob: jest.fn().mockResolvedValue(undefined),
  getTask: jest.fn(),
  getJobsByTaskId: jest.fn(),
  cancelJobsForTask: jest.fn(),
  getQueuePositionForJob: jest.fn().mockResolvedValue(1),
}));

jest.unstable_mockModule('../../../dist/modules/job-store/alert.js', () => ({
  refreshAlertState: jest.fn().mockResolvedValue(undefined),
}));

const mockProcessCodeTask = jest.fn();
const mockExecuteAllSubtasks = jest.fn();
const mockSynthesizeFinalResult = jest.fn();

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

const mockGetAvailableModels = jest.fn().mockResolvedValue([]);

jest.unstable_mockModule('../../../dist/modules/cost-monitor/index.js', () => ({
  costMonitor: {
    getAvailableModels: mockGetAvailableModels,
    getFreeModels: jest.fn().mockResolvedValue([]),
  },
}));

const mockOllamaProvider = {
  id: 'ollama',
  displayName: 'Ollama',
  isLocal: true,
  costClass: 'local',
  supportsModel: jest.fn().mockResolvedValue(false),
};

const mockRegistry = {
  list: jest.fn(() => [mockOllamaProvider]),
  has: jest.fn((providerId: string) => providerId === 'ollama' || providerId === 'lm-studio' || providerId === 'openrouter'),
  get: jest.fn((providerId: string) => (providerId === 'ollama' ? mockOllamaProvider : undefined)),
  isAvailable: jest.fn(() => true),
  listByCostClass: jest.fn((costClass: string) => (costClass === 'local' ? [mockOllamaProvider] : [])),
  getLocalExecutionQueueStats: jest.fn(() => ({
    activeCount: 0,
    queuedCount: 0,
    activeBenchmarks: 0,
    queued_benchmark_runs: 0,
  })),
};

jest.unstable_mockModule('../../../dist/modules/core/provider/index.js', () => ({
  getProviderRegistry: jest.fn(() => mockRegistry),
  isProviderLocal: jest.fn((providerId: string) => providerId === 'ollama' || providerId === 'lm-studio' || providerId === 'local'),
  providerCostClass: jest.fn((providerId: string) => (providerId === 'openrouter' || providerId === 'paid' ? 'paid' : 'local')),
}));

const { router } = await import('../../../dist/modules/api-integration/routing/index.js');

const executeRouteTaskBlocking = (params: Parameters<typeof router.routeTask>[0]) =>
  (router as unknown as {
    executeRouteTaskBlocking(params: Parameters<typeof router.routeTask>[0]): Promise<Record<string, unknown>>;
  }).executeRouteTaskBlocking(params);

/** Model object whose provider is the model id — the exact shape from locallama.log (#150). */
const poisonedAssignment = {
  id: 'llama3.2:3b',
  name: 'llama3.2:3b',
  provider: 'llama3.2:3b',
  capabilities: { chat: true, completion: true },
  costPerToken: { prompt: 0, completion: 0 },
  contextWindow: 8192,
};

const cleanOllamaModel = {
  id: 'llama3.2:3b',
  name: 'Llama 3.2 3B',
  provider: 'ollama',
  capabilities: { chat: true, completion: true },
  costPerToken: { prompt: 0, completion: 0 },
  contextWindow: 8192,
};

const singleSubtask = {
  id: 'subtask-1',
  description: 'Write a TypeScript slugify function',
  complexity: 0.175,
  estimatedTokens: 1000,
  dependencies: [] as string[],
  codeType: 'function' as const,
  recommendedModelSize: 'small' as const,
};

const routeTaskParams = {
  task: 'Write a TypeScript function slugify(input: string): string.',
  contextLength: 80,
  expectedOutputLength: 150,
  complexity: 0.5,
  priority: 'cost' as const,
};

describe('local decision model preservation for decomposed tasks (issue #150)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetAvailableModels.mockResolvedValue([]);
    mockProcessCodeTask.mockReset();
    mockExecuteAllSubtasks.mockReset();
    mockSynthesizeFinalResult.mockReset();
    mockSynthesizeFinalResult.mockResolvedValue('final-synthesized-output');
    mockExecuteAllSubtasks.mockResolvedValue(new Map([['subtask-1', 'subtask-result']]));
    mockOllamaProvider.supportsModel.mockResolvedValue(false);
  });

  it('replaces an assignment whose provider is the model id with the registered ollama model', async () => {
    mockRouteTaskDecision.mockResolvedValueOnce({
      provider: 'local',
      model: 'llama3.2:3b',
      confidence: 1,
      explanation: 'Local decision for the slugify task.',
    });

    mockProcessCodeTask.mockResolvedValueOnce({
      decomposedTask: {
        originalTask: routeTaskParams.task,
        subtasks: [singleSubtask],
        totalEstimatedTokens: 1000,
        dependencyMap: {},
      },
      modelAssignments: new Map([['subtask-1', poisonedAssignment]]),
      executionOrder: [singleSubtask],
      criticalPath: [singleSubtask],
      dependencyVisualization: '',
      estimatedCost: 0,
    });

    // costMonitor reports the poisoned registry entry first and the clean
    // ollama-served entry second — both match the decision model id.
    mockGetAvailableModels.mockResolvedValueOnce([poisonedAssignment, cleanOllamaModel]);

    await executeRouteTaskBlocking(routeTaskParams);

    expect(mockExecuteAllSubtasks).toHaveBeenCalledTimes(1);
    const passedAssignments = mockExecuteAllSubtasks.mock.calls[0][1] as Map<string, { id: string; provider: string }>;
    const assigned = passedAssignments.get('subtask-1');
    expect(assigned?.id).toBe('llama3.2:3b');
    expect(assigned?.provider).toBe('ollama');
  });

  it('repairs an unregistered provider on an id-matching assignment by probing the provider registry', async () => {
    mockRouteTaskDecision.mockResolvedValueOnce({
      provider: 'local',
      model: 'llama3.2:3b',
      confidence: 1,
      explanation: 'Local decision for the slugify task.',
    });

    mockProcessCodeTask.mockResolvedValueOnce({
      decomposedTask: {
        originalTask: routeTaskParams.task,
        subtasks: [singleSubtask],
        totalEstimatedTokens: 1000,
        dependencyMap: {},
      },
      modelAssignments: new Map([['subtask-1', poisonedAssignment]]),
      executionOrder: [singleSubtask],
      criticalPath: [singleSubtask],
      dependencyVisualization: '',
      estimatedCost: 0,
    });

    // Only the poisoned entry is reported; no clean replacement is available.
    mockGetAvailableModels.mockResolvedValueOnce([poisonedAssignment]);
    // The registered ollama provider does support the bare model id.
    mockOllamaProvider.supportsModel.mockImplementation(async (modelId: string) => modelId === 'llama3.2:3b');

    const result = await executeRouteTaskBlocking(routeTaskParams);

    expect(mockExecuteAllSubtasks).toHaveBeenCalledTimes(1);
    const passedAssignments = mockExecuteAllSubtasks.mock.calls[0][1] as Map<string, { id: string; provider: string }>;
    const assigned = passedAssignments.get('subtask-1');
    expect(assigned?.id).toBe('llama3.2:3b');
    expect(assigned?.provider).toBe('ollama');
    expect(result).toMatchObject({ providerId: 'ollama', provider: 'ollama' });
  });
});
