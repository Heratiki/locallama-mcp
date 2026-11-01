import { beforeEach, describe, expect, it, jest } from '@jest/globals';

const axiosGetMock = jest.fn();

jest.unstable_mockModule('axios', () => ({
  default: { get: axiosGetMock },
  get: axiosGetMock,
}));

jest.unstable_mockModule('../../../dist/config/index.js', () => ({
  config: {
    openRouterApiKey: undefined,
    lmStudioEndpoint: 'http://localhost:1234',
    ollamaEndpoint: 'http://localhost:1234',
    reliableBenchmarkCount: 3,
    providerMaxConcurrentLocal: 1,
    cacheDir: 'test-cache',
    rootDir: '.',
    openRouterFreeOnly: false,
    costThreshold: 0.02,
    minValidatorScore: 0.5,
  },
}));

jest.unstable_mockModule('../../../dist/utils/logger.js', () => ({
  logger: {
    error: jest.fn(),
    warn: jest.fn(),
    info: jest.fn(),
    debug: jest.fn(),
  },
}));

jest.unstable_mockModule('../../../dist/modules/cost-monitor/utils.js', () => ({
  calculateTokenEstimates: jest.fn(),
  modelContextWindows: {},
  getProviderFromModelId: (id: string) => id.split('/')[0] ?? 'unknown',
}));

jest.unstable_mockModule('../../../dist/modules/openrouter/index.js', () => ({
  openRouterModule: {
    handleOpenRouterError: jest.fn(),
    modelTracking: { models: {}, freeModels: [], freeModelHealth: {} },
    initialize: jest.fn().mockResolvedValue(undefined),
    getAvailableModels: jest.fn().mockResolvedValue([]),
    getFreeModels: jest.fn().mockResolvedValue([]),
    getProviderFromModelId: (id: string) => id.split('/')[0] ?? 'unknown',
    isModelQuarantined: jest.fn().mockReturnValue(false),
  },
}));

jest.unstable_mockModule('../../../dist/modules/core/model/index.js', () => ({
  getModelRegistry: jest.fn().mockReturnValue({
    getModel: jest.fn().mockReturnValue(undefined),
    listAll: jest.fn().mockReturnValue([]),
  }),
}));

jest.unstable_mockModule('../../../dist/modules/decision-engine/services/outputValidator.js', () => ({
  OutputValidator: {
    validate: jest.fn(),
    updateReputation: jest.fn(),
  },
}));

jest.unstable_mockModule('../../../dist/modules/user-preferences/index.js', () => ({
  loadUserPreferences: jest.fn().mockResolvedValue({}),
}));

jest.unstable_mockModule('../../../dist/modules/api-integration/cost-estimation/index.js', () => ({
  costEstimator: {
    estimateCost: jest.fn().mockResolvedValue({
      local: { cost: { total: 0 } },
      paid: { cost: { total: 0 } },
    }),
  },
}));

jest.unstable_mockModule('../../../dist/modules/api-integration/task-execution/index.js', () => ({
  taskExecutor: {
    executeTask: jest.fn().mockResolvedValue('generated'),
  },
}));

jest.unstable_mockModule('../../../dist/modules/decision-engine/services/jobTracker.js', () => ({
  JobStatus: {
    COMPLETED: 'Completed',
    CANCELLED: 'Cancelled',
    FAILED: 'Failed',
  },
  getJobTracker: jest.fn().mockResolvedValue({
    createJob: jest.fn(),
    completeJob: jest.fn(),
    failJob: jest.fn(),
    getJob: jest.fn(),
    cancelJob: jest.fn(),
  }),
}));

jest.unstable_mockModule('../../../dist/modules/job-store/index.js', () => ({
  insertTask: jest.fn().mockResolvedValue(undefined),
  updateTask: jest.fn().mockResolvedValue(undefined),
  updateJob: jest.fn().mockResolvedValue(undefined),
  getTask: jest.fn(),
  getJobsByTaskId: jest.fn().mockResolvedValue([]),
  cancelJobsForTask: jest.fn().mockResolvedValue(0),
  getQueuePositionForJob: jest.fn().mockResolvedValue(1),
}));

jest.unstable_mockModule('../../../dist/modules/job-store/alert.js', () => ({
  refreshAlertState: jest.fn().mockResolvedValue(undefined),
}));

jest.unstable_mockModule('../../../dist/modules/decision-engine/services/codeTaskCoordinator.js', () => ({
  codeTaskCoordinator: {
    processCodeTask: jest.fn(),
    executeAllSubtasks: jest.fn(),
    synthesizeFinalResult: jest.fn(),
  },
}));

jest.unstable_mockModule('../../../dist/modules/cost-monitor/codeSearchEngine.js', () => ({
  getCodeSearchEngine: jest.fn(),
}));

jest.unstable_mockModule('../../../dist/modules/utils/tokenCount.js', () => ({
  countTokens: jest.fn().mockReturnValue(10),
}));

jest.unstable_mockModule('../../../dist/modules/utils/contextWindow.js', () => ({
  ContextWindowError: class ContextWindowError extends Error {
    constructor(public source: string, public requested: number, public max: number) {
      super('context window exceeded');
    }
  },
}));

jest.unstable_mockModule('../../../dist/modules/telemetry/index.js', () => ({
  withSpan: jest.fn().mockImplementation(async (_name, _attrs, fn) => {
    return await fn({ setAttribute: jest.fn() } as any);
  }),
}));

jest.unstable_mockModule('../../../dist/modules/decision-engine/index.js', () => ({
  decisionEngine: {
    routeTask: jest.fn().mockResolvedValue({ provider: 'local', model: 'llama-cpp:test-7b' }),
    preemptiveRouting: jest.fn(),
    getBestValidatorModel: jest.fn(),
  },
}));

const mockGetAvailableModels = jest.fn();
const mockGetFreeModels = jest.fn().mockResolvedValue([]);

jest.unstable_mockModule('../../../dist/modules/cost-monitor/index.js', () => ({
  costMonitor: {
    getAvailableModels: mockGetAvailableModels,
    getFreeModels: mockGetFreeModels,
  },
}));

const mockLlamaProvider = {
  id: 'llama-cpp',
  displayName: 'llama.cpp',
  costClass: 'local',
  isLocal: true,
  isAvailable: jest.fn().mockResolvedValue(true),
  listModels: jest.fn().mockResolvedValue([
    {
      id: 'llama-cpp:model-a',
      displayName: 'model-a',
      contextWindow: 8192,
      costPerToken: { prompt: 0, completion: 0 },
    },
    {
      id: 'llama-cpp:model-b',
      displayName: 'model-b',
      contextWindow: undefined,
      costPerToken: { prompt: 0, completion: 0 },
    },
  ]),
  supportsModel: jest.fn().mockImplementation(async (modelId: string) => modelId.startsWith('llama-cpp')),
  executeTask: jest.fn(),
  getCost: jest.fn().mockReturnValue({ prompt: 0, completion: 0 }),
};

const mockOllamaProvider = {
  id: 'ollama',
  displayName: 'Ollama',
  costClass: 'local',
  isLocal: true,
  isAvailable: jest.fn().mockResolvedValue(true),
  listModels: jest.fn().mockResolvedValue([]),
  supportsModel: jest.fn().mockResolvedValue(false),
  executeTask: jest.fn(),
  getCost: jest.fn().mockReturnValue({ prompt: 0, completion: 0 }),
};

const mockRegistry = {
  get: jest.fn((providerId: string) => (providerId === 'llama-cpp' ? mockLlamaProvider : providerId === 'ollama' ? mockOllamaProvider : undefined)),
  has: jest.fn((providerId: string) => providerId === 'llama-cpp' || providerId === 'ollama'),
  list: jest.fn().mockReturnValue([mockOllamaProvider, mockLlamaProvider]),
  isAvailable: jest.fn().mockReturnValue(true),
  listByCostClass: jest.fn((costClass: string) =>
    costClass === 'local' ? [mockOllamaProvider, mockLlamaProvider] : []
  ),
  getLocalExecutionQueueStats: jest.fn().mockReturnValue({
    activeCount: 0,
    queuedCount: 0,
    activeBenchmarks: 0,
    queuedBenchmarks: 0,
  }),
};

jest.unstable_mockModule('../../../dist/modules/core/provider/index.js', () => ({
  getProviderRegistry: jest.fn().mockReturnValue(mockRegistry),
  isProviderLocal: jest.fn((providerId: string) => providerId === 'llama-cpp' || providerId === 'ollama' || providerId === 'lm-studio' || providerId === 'local'),
  providerCostClass: jest.fn((providerId: string) => (providerId === 'openrouter' ? 'paid' : 'local')),
  isProviderId: jest.fn((modelProvider: string, expectedId: string) => modelProvider === expectedId),
  executeProviderTask: jest.fn(),
}));

const { getAvailableModels } = await import('../../../dist/modules/cost-monitor/api.js');
const { router } = await import('../../../dist/modules/api-integration/routing/index.js');

describe('getAvailableModels — llama.cpp provider', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    axiosGetMock.mockRejectedValue(new Error('no live provider'));
  });

  it('returns llama.cpp models from the registered provider with provider llama-cpp', async () => {
    const models = await getAvailableModels();

    const llamaModels = models.filter((m) => m.provider === 'llama-cpp');
    expect(llamaModels).toHaveLength(2);
    expect(llamaModels.map((m) => m.id)).toEqual(['llama-cpp:model-a', 'llama-cpp:model-b']);
  });

  it('uses the provider context window when given and falls back to 4096 otherwise', async () => {
    const models = await getAvailableModels();

    const modelA = models.find((m) => m.id === 'llama-cpp:model-a');
    const modelB = models.find((m) => m.id === 'llama-cpp:model-b');

    expect(modelA?.contextWindow).toBe(8192);
    expect(modelB?.contextWindow).toBe(4096);
  });
});

describe('buildRankedTrio — llama.cpp local tier', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetFreeModels.mockResolvedValue([]);
    mockGetAvailableModels.mockResolvedValue([
      {
        id: 'ollama:llama2-7b',
        name: 'llama2-7b',
        provider: 'ollama',
        capabilities: { chat: true, completion: true },
        costPerToken: { prompt: 0, completion: 0 },
        contextWindow: 4096,
      },
      {
        id: 'llama-cpp:test-7b',
        name: 'test-7b',
        provider: 'llama-cpp',
        capabilities: { chat: true, completion: true },
        costPerToken: { prompt: 0, completion: 0 },
        contextWindow: 4096,
      },
    ]);
  });

  it('can pick a llama.cpp model in the local tier', async () => {
    const result = await (router as any).buildRankedTrio(
      'llama-cpp:test-7b',
      'local',
      0.3,
      1000,
      undefined
    );

    expect(result.ranked_trio.good.model_id).toBe('llama-cpp:test-7b');
    expect(result.ranked_trio.good.provider_id).toBe('llama-cpp');
  });
});
