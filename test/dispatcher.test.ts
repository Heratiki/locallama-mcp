import { describe, expect, it, jest, beforeAll, beforeEach } from '@jest/globals';

// ---------------------------------------------------------------------------
// MCP SDK stubs
// ---------------------------------------------------------------------------

let capturedHandler: ((req: { params: { name: string; arguments?: Record<string, unknown> } }, extra: unknown) => Promise<unknown>) | undefined;

const serverMock = {
  setRequestHandler: jest.fn((_schema: unknown, handler: typeof capturedHandler) => {
    capturedHandler = handler;
  }),
  close: jest.fn<() => Promise<void>>().mockResolvedValue(undefined),
  connect: jest.fn<() => Promise<void>>().mockResolvedValue(undefined),
  onerror: undefined as unknown,
  getClientVersion: jest.fn().mockReturnValue(null),
};

jest.unstable_mockModule('@modelcontextprotocol/sdk/server/index.js', () => ({
  Server: jest.fn(() => serverMock),
}));

jest.unstable_mockModule('@modelcontextprotocol/sdk/server/stdio.js', () => ({
  StdioServerTransport: jest.fn(),
}));

// ---------------------------------------------------------------------------
// Logger
// ---------------------------------------------------------------------------

jest.unstable_mockModule('../dist/utils/logger.js', () => ({
  logger: {
    error: jest.fn(),
    warn: jest.fn(),
    info: jest.fn(),
    debug: jest.fn(),
  },
}));

// ---------------------------------------------------------------------------
// Tool-definition, resources (no-ops)
// ---------------------------------------------------------------------------

jest.unstable_mockModule('../dist/modules/api-integration/tool-definition/index.js', () => ({
  toolDefinitionProvider: { initialize: jest.fn() },
}));

jest.unstable_mockModule('../dist/modules/api-integration/resources.js', () => ({
  setupResourceHandlers: jest.fn(),
}));

// ---------------------------------------------------------------------------
// Lock-file (no-op — avoids filesystem side effects)
// ---------------------------------------------------------------------------

jest.unstable_mockModule('../dist/utils/lock-file.js', () => ({
  isLockFilePresent: jest.fn().mockReturnValue(false),
  getLockFileInfo: jest.fn().mockReturnValue(null),
  createLockFile: jest.fn(),
  removeLockFile: jest.fn(),
}));

// ---------------------------------------------------------------------------
// Routing module (KEY — the dispatcher delegates to these)
// ---------------------------------------------------------------------------

const mockRouteTask = jest.fn<() => Promise<{ costClass: string; providerId: string; model: string; resultCode: string; reason: string; estimatedCost: number }>>().mockResolvedValue({
  costClass: 'local',
  providerId: 'lm-studio',
  model: 'llama-3.2-3b',
  resultCode: 'console.log("hello");',
  reason: 'simple task',
  estimatedCost: 0,
});

const mockPreemptiveRouteTask = jest.fn<() => Promise<{ costClass: string; providerId: string; model: string; reason: string }>>().mockResolvedValue({
  costClass: 'local',
  providerId: 'ollama',
  model: 'qwen2.5-coder-7b',
  reason: 'simple task — low complexity',
});

const mockCancelJob = jest.fn<() => Promise<{ cancelled: boolean }>>().mockResolvedValue({ cancelled: true });

jest.unstable_mockModule('../dist/modules/api-integration/routing/index.js', () => ({
  routeTask: mockRouteTask,
  preemptiveRouteTask: mockPreemptiveRouteTask,
  cancelJob: mockCancelJob,
  router: {},
}));

// ---------------------------------------------------------------------------
// Cost-estimation module
// ---------------------------------------------------------------------------

const mockEstimateCost = jest.fn<() => Promise<{ local: number; paid: number }>>().mockResolvedValue({ local: 0, paid: 0.01 });

jest.unstable_mockModule('../dist/modules/api-integration/cost-estimation/index.js', () => ({
  estimateCost: mockEstimateCost,
  costEstimator: { estimateCost: mockEstimateCost },
}));

// ---------------------------------------------------------------------------
// Benchmark module
// ---------------------------------------------------------------------------

const mockBenchmarkTask = jest.fn<() => Promise<{ taskId: string; local: { model: string; successRate: number }; paid: { model: string; successRate: number } }>>()
  .mockResolvedValue({
    taskId: 'refactor-auth-token-refresh',
    local: { model: 'qwen2.5-coder:7b', successRate: 0.82 },
    paid: { model: 'skipped', successRate: 0 },
  });

const mockBenchmarkTasks = jest.fn<() => Promise<{ taskCount: number; local: { avgSuccessRate: number }; paid: { avgSuccessRate: number } }>>()
  .mockResolvedValue({
    taskCount: 3,
    local: { avgSuccessRate: 0.76 },
    paid: { avgSuccessRate: 0 },
  });

const mockDefaultBenchmarkConfig = {
  runsPerTask: 1,
  parallel: false,
  maxParallelTasks: 1,
  taskTimeout: 300000,
  saveResults: true,
  resultsPath: 'benchmark-results.json',
};

jest.unstable_mockModule('../dist/modules/benchmark/index.js', () => ({
  benchmarkModule: {
    defaultConfig: mockDefaultBenchmarkConfig,
    benchmarkTask: mockBenchmarkTask,
    benchmarkTasks: mockBenchmarkTasks,
  },
}));

// ---------------------------------------------------------------------------
// Heavy deps imported by index.ts at module level
// ---------------------------------------------------------------------------

jest.unstable_mockModule('../dist/modules/core/provider/index.js', () => ({
  ProviderRegistry: jest.fn(() => ({ register: jest.fn(), initAll: jest.fn().mockResolvedValue(undefined), has: jest.fn().mockReturnValue(false) })),
  getProviderRegistry: jest.fn(),
  _setProviderRegistryForTests: jest.fn(),
  isProviderLocal: jest.fn().mockReturnValue(true),
  isProviderId: jest.fn().mockReturnValue(false),
  providerCostClass: jest.fn().mockReturnValue('local'),
}));

jest.unstable_mockModule('../dist/modules/lm-studio/provider.js', () => ({
  lmStudioProvider: { id: 'lm-studio', init: jest.fn(), costClass: 'local', isLocal: true },
}));

jest.unstable_mockModule('../dist/modules/ollama/provider.js', () => ({
  ollamaProvider: { id: 'ollama', init: jest.fn(), costClass: 'local', isLocal: true },
}));

jest.unstable_mockModule('../dist/modules/openrouter/provider.js', () => ({
  openRouterProvider: { id: 'openrouter', init: jest.fn(), costClass: 'paid', isLocal: false },
}));

jest.unstable_mockModule('../dist/modules/core/model/index.js', () => ({
  getModelRegistry: jest.fn().mockReturnValue({ seedFromProvider: jest.fn(), listAll: jest.fn().mockReturnValue([]) }),
  _setModelRegistryForTests: jest.fn(),
  ModelRegistry: jest.fn(() => ({ seedFromProvider: jest.fn(), listAll: jest.fn().mockReturnValue([]) })),
}));

jest.unstable_mockModule('../dist/modules/core/prompting/service.js', () => ({
  getPromptingStrategyService: jest.fn().mockReturnValue({ loadFromFile: jest.fn().mockResolvedValue(undefined) }),
  _setPromptingStrategyServiceForTests: jest.fn(),
  PromptingStrategyService: jest.fn(() => ({ loadFromFile: jest.fn().mockResolvedValue(undefined) })),
  USER_STRATEGIES_PATH: '/tmp/test-strategies.json',
}));

jest.unstable_mockModule('../dist/modules/decision-engine/index.js', () => ({
  decisionEngine: {
    initialize: jest.fn().mockResolvedValue(undefined),
    routeTask: jest.fn().mockResolvedValue({ provider: 'local', model: 'test', confidence: 0.8 }),
  },
  apiHandlers: {},
  jobTracker: jest.fn().mockResolvedValue({ updateJobProgress: jest.fn(), failJob: jest.fn() }),
}));

jest.unstable_mockModule('../dist/modules/api-integration/task-execution/index.js', () => ({
  taskExecutor: { executeTask: jest.fn().mockResolvedValue('result') },
  TaskExecutor: jest.fn(() => ({ executeTask: jest.fn().mockResolvedValue('result') })),
}));

// ---------------------------------------------------------------------------
// Module under test
// ---------------------------------------------------------------------------

const { LocalLamaMcpServer } = await import('../dist/index.js');

// ---------------------------------------------------------------------------
// Helper: wait for Node's I/O and microtask queues to fully drain so the
// chained import().then().then() inside setupToolCallHandler() completes.
// ---------------------------------------------------------------------------

async function waitForHandler(timeoutMs = 2000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!capturedHandler && Date.now() < deadline) {
    // Flush microtasks, then let Node process I/O / setImmediate callbacks
    for (let i = 0; i < 5; i++) await Promise.resolve();
    await new Promise<void>((resolve) => setImmediate(resolve));
  }
  if (!capturedHandler) {
    throw new Error(
      'setupToolCallHandler never called server.setRequestHandler within the timeout',
    );
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('LocalLamaMcpServer tool dispatcher', () => {
  beforeAll(async () => {
    // Create one server instance and wait for its async handler chain to settle.
    new LocalLamaMcpServer();
    await waitForHandler();
  });

  beforeEach(() => {
    mockRouteTask.mockClear();
    mockPreemptiveRouteTask.mockClear();
    mockCancelJob.mockClear();
    mockEstimateCost.mockClear();
    mockBenchmarkTask.mockClear();
    mockBenchmarkTasks.mockClear();
  });

  it('registers a tool call handler with the MCP Server', () => {
    expect(serverMock.setRequestHandler).toHaveBeenCalled();
    expect(capturedHandler).toBeDefined();
  });

  it('routes route_task to the routing module', async () => {
    if (!capturedHandler) throw new Error('handler not registered');

    const result = await capturedHandler(
      {
        params: {
          name: 'route_task',
          arguments: { task: 'write a hello world', context_length: 100 },
        },
      },
      {},
    );

    expect(mockRouteTask).toHaveBeenCalledTimes(1);
    const typed = result as { content: { type: string; text: string }[] };
    expect(typed.content[0].type).toBe('text');
    const parsed = JSON.parse(typed.content[0].text);
    expect(parsed.costClass).toBe('local');
    expect(parsed.modelId).toBe('llama-3.2-3b');
  });

  it('routes preemptive_route_task to the routing module', async () => {
    if (!capturedHandler) throw new Error('handler not registered');

    const result = await capturedHandler(
      {
        params: {
          name: 'preemptive_route_task',
          arguments: { task: 'add docstring', context_length: 50 },
        },
      },
      {},
    );

    expect(mockPreemptiveRouteTask).toHaveBeenCalledTimes(1);
    const typed = result as { content: { type: string; text: string }[] };
    const parsed = JSON.parse(typed.content[0].text);
    expect(parsed.costClass).toBe('local');
    expect(parsed.modelId).toBe('qwen2.5-coder-7b');
  });

  it('routes get_cost_estimate to the cost module', async () => {
    if (!capturedHandler) throw new Error('handler not registered');

    const result = await capturedHandler(
      {
        params: {
          name: 'get_cost_estimate',
          arguments: { context_length: 200 },
        },
      },
      {},
    );

    expect(mockEstimateCost).toHaveBeenCalledTimes(1);
    const typed = result as { content: { type: string; text: string }[] };
    expect(typed.content[0].type).toBe('text');
  });

  it('routes cancel_job to the routing module', async () => {
    if (!capturedHandler) throw new Error('handler not registered');

    const result = await capturedHandler(
      {
        params: {
          name: 'cancel_job',
          arguments: { job_id: 'test-job-123' },
        },
      },
      {},
    );

    expect(mockCancelJob).toHaveBeenCalledWith('test-job-123');
    const typed = result as { content: { type: string; text: string }[] };
    expect(typed.content[0].type).toBe('text');
  });

  it('routes benchmark_task to the benchmark module with realistic client arguments', async () => {
    if (!capturedHandler) throw new Error('handler not registered');

    const result = await capturedHandler(
      {
        params: {
          name: 'benchmark_task',
          arguments: {
            task_id: 'refactor-auth-token-refresh',
            task: [
              'Refactor an Express middleware that refreshes OAuth tokens.',
              'Preserve the existing public API, add typed error handling,',
              'and avoid retrying non-idempotent requests.',
            ].join(' '),
            context_length: 2400,
            expected_output_length: 900,
            complexity: 0.72,
            local_model: 'qwen2.5-coder:7b',
            skip_paid_model: true,
            runs_per_task: 2,
            task_timeout: 420000,
          },
        },
      },
      {},
    );

    expect(mockBenchmarkTask).toHaveBeenCalledTimes(1);
    expect(mockBenchmarkTask).toHaveBeenCalledWith(
      {
        taskId: 'refactor-auth-token-refresh',
        task: expect.stringContaining('Express middleware'),
        contextLength: 2400,
        expectedOutputLength: 900,
        complexity: 0.72,
        localModel: 'qwen2.5-coder:7b',
        paidModel: undefined,
        skipPaidModel: true,
      },
      {
        runsPerTask: 2,
        taskTimeout: 420000,
      },
    );
    const typed = result as { content: { type: string; text: string }[] };
    const parsed = JSON.parse(typed.content[0].text);
    expect(parsed.local.model).toBe('qwen2.5-coder:7b');
  });

  it('routes benchmark_tasks to the benchmark module with varied real-world task shapes', async () => {
    if (!capturedHandler) throw new Error('handler not registered');

    await capturedHandler(
      {
        params: {
          name: 'benchmark_tasks',
          arguments: {
            tasks: [
              {
                task_id: 'debug-streaming-json-parser',
                task: 'Find and fix an intermittent JSON parsing bug in a Node stream pipeline where chunks may split UTF-8 characters.',
                context_length: 1800,
                expected_output_length: 700,
                complexity: 0.64,
                local_model: 'qwen2.5-coder:3b',
              },
              {
                task_id: 'add-postgres-migration-guard',
                task: 'Write a migration guard that prevents dropping a populated Postgres column unless an explicit override flag is present.',
                context_length: 3200,
                expected_output_length: 1100,
                complexity: 0.81,
                local_model: 'qwen2.5-coder:7b',
              },
              {
                task_id: 'review-jwt-cache-security',
                task: 'Review a JWT verification cache for replay and key-rotation risks and propose a minimal TypeScript patch.',
                context_length: 4100,
                expected_output_length: 1300,
                complexity: 0.88,
              },
            ],
            runs_per_task: 2,
            parallel: true,
            max_parallel_tasks: 2,
            task_timeout: 480000,
          },
        },
      },
      {},
    );

    expect(mockBenchmarkTasks).toHaveBeenCalledTimes(1);
    const [tasks, config] = mockBenchmarkTasks.mock.calls[0];
    expect(tasks).toHaveLength(3);
    expect(tasks[0]).toMatchObject({
      taskId: 'debug-streaming-json-parser',
      contextLength: 1800,
      expectedOutputLength: 700,
      complexity: 0.64,
      localModel: 'qwen2.5-coder:3b',
    });
    expect(tasks[2]).toMatchObject({
      taskId: 'review-jwt-cache-security',
      expectedOutputLength: 1300,
      complexity: 0.88,
    });
    expect(config).toMatchObject({
      runsPerTask: 2,
      parallel: true,
      maxParallelTasks: 2,
      taskTimeout: 480000,
      saveResults: true,
    });
  });

  it('does not overwrite benchmark defaults when optional run settings are omitted', async () => {
    if (!capturedHandler) throw new Error('handler not registered');

    await capturedHandler(
      {
        params: {
          name: 'benchmark_task',
          arguments: {
            task_id: 'minimal-real-client-payload',
            task: 'Patch a TypeScript helper so it handles null input without changing the exported API.',
            context_length: 1200,
          },
        },
      },
      {},
    );

    expect(mockBenchmarkTask).toHaveBeenCalledWith(
      expect.objectContaining({
        taskId: 'minimal-real-client-payload',
        contextLength: 1200,
        expectedOutputLength: 512,
        complexity: 0.5,
      }),
      {},
    );
  });

  it('throws for an unknown tool name', async () => {
    if (!capturedHandler) throw new Error('handler not registered');

    await expect(
      capturedHandler(
        {
          params: {
            name: 'completely_unknown_tool',
            arguments: {},
          },
        },
        {},
      ),
    ).rejects.toThrow('Unknown tool: completely_unknown_tool');
  });

  it('throws when route_task args are invalid', async () => {
    if (!capturedHandler) throw new Error('handler not registered');

    await expect(
      capturedHandler(
        {
          params: {
            name: 'route_task',
            arguments: { task: 'missing context_length' },
          },
        },
        {},
      ),
    ).rejects.toThrow(/Invalid arguments/);
  });
});
