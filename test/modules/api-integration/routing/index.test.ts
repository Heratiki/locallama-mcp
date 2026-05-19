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

const mockOpenRouterProvider = {
  id: 'openrouter',
  supportsModel: jest.fn().mockResolvedValue(true),
};

jest.unstable_mockModule('../../../../dist/modules/core/provider/index.js', () => ({
  getProviderRegistry: jest.fn(() => ({
    list: jest.fn(() => [mockOpenRouterProvider]),
  })),
  providerCostClass: jest.fn((providerId: string) => (providerId === 'openrouter' ? 'paid' : 'local')),
}));

const { routeTask } = await import('../../../../dist/modules/api-integration/routing/index.js');

describe('api-integration routing', () => {
  beforeEach(() => {
    jest.clearAllMocks();
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
});
