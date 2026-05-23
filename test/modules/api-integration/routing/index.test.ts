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
    providerMaxConcurrentLocal: 1,
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

jest.unstable_mockModule('../../../../dist/modules/cost-monitor/index.js', () => ({
  costMonitor: {
    getAvailableModels: mockGetAvailableModels,
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

const { routeTask, preemptiveRouteTask, getTaskStatus, cancelTask, router } = await import('../../../../dist/modules/api-integration/routing/index.js');
const executeRouteTaskBlocking = (params: Parameters<typeof routeTask>[0]) =>
  (router as unknown as { executeRouteTaskBlocking(params: Parameters<typeof routeTask>[0]): Promise<unknown> })
    .executeRouteTaskBlocking(params);

describe('api-integration routing', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetTask.mockResolvedValue(undefined);
    mockGetJobsByTaskId.mockResolvedValue([]);
    mockGetQueuePositionForJob.mockResolvedValue(1);
    mockCancelJobsForTask.mockResolvedValue(0);
    mockGetAvailableModels.mockResolvedValue([]);
    mockRegistry.list.mockReturnValue([mockOpenRouterProvider]);
    mockRegistry.has.mockImplementation((providerId: string) => providerId === 'openrouter' || providerId === 'ollama' || providerId === 'lm-studio');
    mockRegistry.isAvailable.mockImplementation((providerId: string) => providerId !== 'ollama' && providerId !== 'lm-studio');
    mockRegistry.listByCostClass.mockImplementation((costClass: string) => {
      if (costClass === 'local') {
        return [{ id: 'ollama' }, { id: 'lm-studio' }];
      }
      return [mockOpenRouterProvider];
    });
  });

  it('route_task returns immediately with a queued task id', async () => {
    mockRouteTaskDecision.mockResolvedValueOnce({
      provider: 'paid',
      model: 'openai/gpt-4o',
      explanation: 'Queued paid task.',
    });
    mockGetQueuePositionForJob.mockResolvedValueOnce(3);
    mockExecuteTask.mockImplementationOnce(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
      return 'background result';
    });

    const result = await routeTask({
      task: 'Generate a short implementation plan.',
      contextLength: 64,
      expectedOutputLength: 128,
      complexity: 0.7,
      priority: 'quality',
    });

    expect(result.status).toBe('queued');
    expect(result.task_id).toEqual(expect.any(String));
    expect(result.job_count).toBe(1);
    expect(result.queue_position).toBe(3);
    expect(result.poll_again_after_ms).toBe(5000);
    expect(result.provider).toBe('openrouter');
    expect(result.model).toBe('openai/gpt-4o');
    expect(mockInsertTask).toHaveBeenCalledWith(expect.objectContaining({
      id: result.task_id,
      status: 'queued',
      job_count: 1,
    }));
    expect(mockCreateJob).toHaveBeenCalledWith(result.task_id, expect.stringContaining('implementation plan'), 'openai/gpt-4o', 'openrouter');
  });

  it('keeps later local queued tasks out of in_progress until a local slot is available', async () => {
    mockRouteTaskDecision.mockResolvedValueOnce({
      provider: 'local',
      model: 'qwen2.5-coder:7b',
      explanation: 'Local route for queue serialization test.',
    });
    mockRouteTaskDecision.mockResolvedValueOnce({
      provider: 'local',
      model: 'qwen2.5-coder:7b',
      explanation: 'Local route for queue serialization test.',
    });
    mockOpenRouterProvider.supportsModel.mockResolvedValue(false);

    let releaseFirstExecution: (() => void) | undefined;
    const executeMock = jest
      .fn()
      .mockImplementationOnce(async () => {
        await new Promise<void>((resolve) => {
          releaseFirstExecution = resolve;
        });
        return {
          model: 'qwen2.5-coder:7b',
          providerId: 'local',
          costClass: 'local',
          provider: 'local',
          reason: 'first',
          resultCode: 'first-result',
          estimatedCost: 0,
        };
      })
      .mockResolvedValue({
        model: 'qwen2.5-coder:7b',
        providerId: 'local',
        costClass: 'local',
        provider: 'local',
        reason: 'second',
        resultCode: 'second-result',
        estimatedCost: 0,
      });

    const internalRouter = router as unknown as { executeRouteTaskBlocking: typeof executeMock };
    const originalExecute = internalRouter.executeRouteTaskBlocking;
    internalRouter.executeRouteTaskBlocking = executeMock;

    try {
      await Promise.all([
        routeTask({
          task: 'First queued local task',
          contextLength: 64,
          expectedOutputLength: 128,
          complexity: 0.5,
          priority: 'cost',
        }),
        routeTask({
          task: 'Second queued local task',
          contextLength: 64,
          expectedOutputLength: 128,
          complexity: 0.5,
          priority: 'cost',
        }),
      ]);

      await new Promise((resolve) => setTimeout(resolve, 10));

      const inProgressBeforeRelease = mockUpdateJob.mock.calls.filter(
        ([job]) => job?.status === 'in_progress',
      ).length;
      expect(inProgressBeforeRelease).toBe(1);

      releaseFirstExecution?.();
      await new Promise((resolve) => setTimeout(resolve, 10));

      const inProgressAfterRelease = mockUpdateJob.mock.calls.filter(
        ([job]) => job?.status === 'in_progress',
      ).length;
      expect(inProgressAfterRelease).toBe(2);
    } finally {
      mockOpenRouterProvider.supportsModel.mockResolvedValue(true);
      internalRouter.executeRouteTaskBlocking = originalExecute;
    }
  });

  it('get_task_status returns aggregate task status and inline completed results', async () => {
    mockGetTask.mockResolvedValueOnce({
      id: 'task-1',
      status: 'in_progress',
      job_count: 2,
      completed_count: 0,
      failed_count: 0,
      created_at: Date.now(),
    });
    mockGetJobsByTaskId.mockResolvedValueOnce([
      {
        id: 'job-1',
        task_id: 'task-1',
        status: 'completed',
        provider_id: 'ollama',
        model_id: 'qwen2.5-coder:7b',
        task_text: 'first',
        result: JSON.stringify(['done']),
        error: null,
        queue_position: 1,
        progress_pct: 100,
        poll_again_after_ms: null,
        retry_count: 0,
        created_at: Date.now(),
        started_at: Date.now(),
        completed_at: Date.now(),
      },
      {
        id: 'job-2',
        task_id: 'task-1',
        status: 'in_progress',
        provider_id: 'openrouter',
        model_id: 'openai/gpt-4o',
        task_text: 'second',
        result: null,
        error: null,
        queue_position: 2,
        progress_pct: 50,
        poll_again_after_ms: 15000,
        retry_count: 0,
        created_at: Date.now(),
        started_at: Date.now(),
        completed_at: null,
      },
    ]);

    const result = await getTaskStatus('task-1');

    expect(result).toMatchObject({
      task_id: 'task-1',
      status: 'in_progress',
      job_count: 2,
      completed_count: 1,
      failed_count: 0,
      progress_pct: 75,
      poll_again_after_ms: 15000,
    });
    expect(result.jobs[0]).toMatchObject({
      job_id: 'job-1',
      status: 'completed',
      result: 'done',
    });
  });

  it('cancel_task cancels all non-terminal jobs for the task', async () => {
    mockGetTask
      .mockResolvedValueOnce({
        id: 'task-cancel',
        status: 'in_progress',
        job_count: 2,
        completed_count: 0,
        failed_count: 0,
        created_at: Date.now(),
      })
      .mockResolvedValueOnce({
        id: 'task-cancel',
        status: 'cancelled',
        job_count: 2,
        completed_count: 0,
        failed_count: 0,
        created_at: Date.now(),
      });
    mockCancelJobsForTask.mockResolvedValueOnce(2);
    mockGetJobsByTaskId.mockResolvedValueOnce([
      { id: 'job-1', status: 'cancelled' },
      { id: 'job-2', status: 'cancelled' },
    ]);

    const result = await cancelTask('task-cancel');

    expect(mockCancelJobsForTask).toHaveBeenCalledWith('task-cancel');
    expect(result).toMatchObject({
      success: true,
      task_id: 'task-cancel',
      cancelled_count: 2,
      status: 'cancelled',
    });
  });

  it('preserves a paid routing decision and executes the selected OpenRouter model directly', async () => {
    const result = await executeRouteTaskBlocking({
      task: 'Design a secure OAuth2 token refresh flow. Return three concise bullets.',
      contextLength: 120,
      expectedOutputLength: 80,
      complexity: 0.9,
      priority: 'quality',
    });

    expect(mockExecuteTask).toHaveBeenCalledWith(
      'openai/gpt-4o',
      expect.stringContaining('OAuth2 token refresh'),
      expect.stringMatching(/^route-/),
    );
    expect(mockProcessCodeTask).not.toHaveBeenCalled();
    expect(mockCompleteJob).toHaveBeenCalledWith(
      expect.stringMatching(/^route-/),
      ['paid OpenRouter response'],
    );
    expect(result).toMatchObject({
      providerId: 'openrouter',
      costClass: 'paid',
      model: 'openai/gpt-4o',
      resultCode: 'paid OpenRouter response',
      estimatedCost: 0.0012,
    });
  });

  it('preserves local decision model for single-subtask full route execution', async () => {
    mockRouteTaskDecision.mockResolvedValueOnce({
      provider: 'local',
      model: 'qwen2.5-coder:7b',
      confidence: 0.62,
      explanation: 'Local decision for medium complexity task.',
    });

    const subtask = {
      id: 'subtask-1',
      description: 'Write debounce utility',
      complexity: 0.4,
      estimatedTokens: 120,
      dependencies: [],
      codeType: 'function' as const,
      recommendedModelSize: 'small' as const,
    };

    const initialAssignments = new Map([
      ['subtask-1', {
        id: 'qwen2.5-coder:3b',
        name: 'Qwen 3B',
        provider: 'ollama',
        capabilities: { chat: true, completion: true },
        costPerToken: { prompt: 0, completion: 0 },
      }],
    ]);

    mockProcessCodeTask.mockResolvedValueOnce({
      decomposedTask: {
        originalTask: 'Write debounce utility',
        subtasks: [subtask],
        totalEstimatedTokens: 120,
        dependencyMap: {},
      },
      modelAssignments: initialAssignments,
      executionOrder: [subtask],
      criticalPath: [subtask],
      dependencyVisualization: '',
      estimatedCost: 0,
    });

    mockGetAvailableModels.mockResolvedValueOnce([
      {
        id: 'qwen2.5-coder:7b',
        name: 'Qwen 7B',
        provider: 'ollama',
        capabilities: { chat: true, completion: true },
        costPerToken: { prompt: 0, completion: 0 },
      },
      {
        id: 'qwen2.5-coder:3b',
        name: 'Qwen 3B',
        provider: 'ollama',
        capabilities: { chat: true, completion: true },
        costPerToken: { prompt: 0, completion: 0 },
      },
    ]);

    mockExecuteAllSubtasks.mockImplementation(async (_decomposedTask, assignments) => {
      const assigned = assignments.get('subtask-1');
      return new Map([['subtask-1', `executed-with-${assigned?.id || 'unknown'}`]]);
    });
    mockSynthesizeFinalResult.mockResolvedValueOnce('final-synthesized-output');

    const result = await executeRouteTaskBlocking({
      task: 'Write a TypeScript debounce utility function.',
      contextLength: 90,
      expectedOutputLength: 180,
      complexity: 0.4,
      priority: 'cost',
    });

    expect(mockProcessCodeTask).toHaveBeenCalledTimes(1);
    expect(mockExecuteAllSubtasks).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({
      providerId: 'ollama',
      costClass: 'local',
      model: 'qwen2.5-coder:7b',
      resultCode: 'final-synthesized-output',
    });
  });

  it('preserves local decision model for key subtasks in multi-subtask decomposition', async () => {
    mockRouteTaskDecision.mockResolvedValueOnce({
      provider: 'local',
      model: 'qwen2.5-coder:7b',
      confidence: 0.61,
      explanation: 'Local decision for decomposed task.',
    });

    const subtaskA = {
      id: 'subtask-a',
      description: 'Implement retry core',
      complexity: 0.82,
      estimatedTokens: 180,
      dependencies: [],
      codeType: 'function' as const,
      recommendedModelSize: 'medium' as const,
    };
    const subtaskB = {
      id: 'subtask-b',
      description: 'Implement adapter wrapper',
      complexity: 0.35,
      estimatedTokens: 110,
      dependencies: ['subtask-a'],
      codeType: 'function' as const,
      recommendedModelSize: 'small' as const,
    };

    const assignments = new Map([
      ['subtask-a', {
        id: 'qwen2.5-coder:3b',
        name: 'Qwen 3B',
        provider: 'ollama',
        capabilities: { chat: true, completion: true },
        costPerToken: { prompt: 0, completion: 0 },
      }],
      ['subtask-b', {
        id: 'qwen2.5-coder:3b',
        name: 'Qwen 3B',
        provider: 'ollama',
        capabilities: { chat: true, completion: true },
        costPerToken: { prompt: 0, completion: 0 },
      }],
    ]);

    mockProcessCodeTask.mockResolvedValueOnce({
      decomposedTask: {
        originalTask: 'Build retry helper and wrapper',
        subtasks: [subtaskA, subtaskB],
        totalEstimatedTokens: 290,
        dependencyMap: { 'subtask-b': ['subtask-a'] },
      },
      modelAssignments: assignments,
      executionOrder: [subtaskA, subtaskB],
      criticalPath: [subtaskA, subtaskB],
      dependencyVisualization: '',
      estimatedCost: 0,
    });

    mockGetAvailableModels.mockResolvedValueOnce([
      {
        id: 'qwen2.5-coder:7b',
        name: 'Qwen 7B',
        provider: 'ollama',
        capabilities: { chat: true, completion: true },
        costPerToken: { prompt: 0, completion: 0 },
      },
      {
        id: 'qwen2.5-coder:3b',
        name: 'Qwen 3B',
        provider: 'ollama',
        capabilities: { chat: true, completion: true },
        costPerToken: { prompt: 0, completion: 0 },
      },
    ]);

    mockExecuteAllSubtasks.mockImplementation(async (_task, currentAssignments) => {
      const aModel = currentAssignments.get('subtask-a')?.id || 'unknown';
      const bModel = currentAssignments.get('subtask-b')?.id || 'unknown';
      return new Map([
        ['subtask-a', `executed-with-${aModel}`],
        ['subtask-b', `executed-with-${bModel}`],
      ]);
    });
    mockSynthesizeFinalResult.mockResolvedValueOnce('multi-subtask-final-output');

    const result = await executeRouteTaskBlocking({
      task: 'Build a retry helper and adapter wrapper in TypeScript.',
      contextLength: 140,
      expectedOutputLength: 260,
      complexity: 0.65,
      priority: 'cost',
    });

    expect(mockExecuteAllSubtasks).toHaveBeenCalledTimes(1);
    const executeCall = mockExecuteAllSubtasks.mock.calls[0];
    const finalAssignments = executeCall[1] as Map<string, { id: string }>;
    expect(finalAssignments.get('subtask-a')?.id).toBe('qwen2.5-coder:7b');
    expect(finalAssignments.get('subtask-b')?.id).toBe('qwen2.5-coder:7b');

    expect(result).toMatchObject({
      providerId: 'ollama',
      costClass: 'local',
      model: 'qwen2.5-coder:7b',
      resultCode: 'multi-subtask-final-output',
    });
  });

  it('preemptive_route_task does not suggest a local model when local providers are unavailable', async () => {
    const { decisionEngine } = await import('../../../../dist/modules/decision-engine/index.js');
    (decisionEngine.preemptiveRouting as jest.Mock).mockResolvedValueOnce({
      provider: 'local',
      model: 'qwen2.5-coder:7b',
      explanation: 'Initial local recommendation.',
      confidence: 0.8,
      factors: {
        cost: { local: 0, paid: 0.001, wasFactor: true },
        complexity: { score: 0.4, wasFactor: true },
        tokenUsage: { contextLength: 40, outputLength: 60, wasFactor: true },
        priority: { value: 'cost', wasFactor: true },
      },
      scores: { local: 0.8, paid: 0.2 },
      preemptive: true,
    });

    mockGetAvailableModels.mockResolvedValueOnce([
      {
        id: 'openai/gpt-4o-mini',
        name: 'GPT-4o mini',
        provider: 'openrouter',
        capabilities: { chat: true, completion: true },
        costPerToken: { prompt: 0.0001, completion: 0.0002 },
        contextWindow: 128000,
      },
    ]);

    const result = await preemptiveRouteTask({
      task: 'Summarize this request.',
      contextLength: 40,
      expectedOutputLength: 60,
      complexity: 0.4,
      priority: 'cost',
    });

    expect(result.providerId).toBe('paid');
    expect(result.costClass).toBe('paid');
    expect(result.model).toBe('openai/gpt-4o-mini');
  });
});
