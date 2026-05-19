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
    cancelJob: jest.fn(),
  }),
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

jest.unstable_mockModule('../../../../dist/modules/core/provider/index.js', () => ({
  getProviderRegistry: jest.fn(() => ({
    list: jest.fn(() => [mockOpenRouterProvider]),
  })),
  isProviderLocal: jest.fn((providerId: string) => providerId === 'ollama' || providerId === 'lm-studio' || providerId === 'local'),
  providerCostClass: jest.fn((providerId: string) => (providerId === 'openrouter' ? 'paid' : 'local')),
}));

const { routeTask } = await import('../../../../dist/modules/api-integration/routing/index.js');

describe('api-integration routing', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetAvailableModels.mockResolvedValue([]);
  });

  it('preserves a paid routing decision and executes the selected OpenRouter model directly', async () => {
    const result = await routeTask({
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

    const result = await routeTask({
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
});
