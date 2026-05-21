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

const mockReloadConfig = jest.fn<() => {
  success: boolean;
  message: string;
  activeConfig: { openRouterFreeOnly: boolean; tokenThreshold: number };
}>(() => ({
  success: true,
  message: 'reloaded',
  activeConfig: {
    openRouterFreeOnly: false,
    tokenThreshold: 2222,
  },
}));

jest.unstable_mockModule('../dist/config/index.js', () => ({
  reloadConfig: mockReloadConfig,
  config: {
    openRouterApiKey: undefined,
  },
}));

const mockIsAlertActive = jest.fn(() => false);
const mockBuildQueueAlert = jest.fn().mockResolvedValue(null);

jest.unstable_mockModule('../dist/modules/job-store/alert.js', () => ({
  isAlertActive: mockIsAlertActive,
  buildQueueAlert: mockBuildQueueAlert,
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

const mockRouteTask = jest.fn<() => Promise<{ task_id: string; status: string; job_count: number; queue_position: number; poll_again_after_ms: number; provider: string; model: string }>>().mockResolvedValue({
  task_id: 'task-queued-123',
  status: 'queued',
  job_count: 1,
  queue_position: 2,
  poll_again_after_ms: 5000,
  provider: 'lm-studio',
  model: 'llama-3.2-3b',
});

const mockPreemptiveRouteTask = jest.fn<() => Promise<{ costClass: string; providerId: string; model: string; reason: string }>>().mockResolvedValue({
  costClass: 'local',
  providerId: 'ollama',
  model: 'qwen2.5-coder-7b',
  reason: 'simple task — low complexity',
});

const mockCancelJob = jest.fn<() => Promise<{ cancelled: boolean }>>().mockResolvedValue({ cancelled: true });
const mockGetTaskStatus = jest.fn<() => Promise<{ task_id: string; status: string; job_count: number; completed_count: number; failed_count: number; progress_pct: number; poll_again_after_ms: number; jobs: unknown[] }>>().mockResolvedValue({
  task_id: 'task-queued-123',
  status: 'completed',
  job_count: 1,
  completed_count: 1,
  failed_count: 0,
  progress_pct: 100,
  poll_again_after_ms: 0,
  jobs: [{ job_id: 'task-queued-123', status: 'completed', result: 'console.log("hello");' }],
});
const mockCancelTask = jest.fn<() => Promise<{ success: boolean; task_id: string; cancelled_count: number; status: string; message: string }>>().mockResolvedValue({
  success: true,
  task_id: 'task-queued-123',
  cancelled_count: 1,
  status: 'cancelled',
  message: 'cancelled',
});

jest.unstable_mockModule('../dist/modules/api-integration/routing/index.js', () => ({
  routeTask: mockRouteTask,
  preemptiveRouteTask: mockPreemptiveRouteTask,
  cancelJob: mockCancelJob,
  getTaskStatus: mockGetTaskStatus,
  cancelTask: mockCancelTask,
  router: {},
}));

const mockGetMonitoringInfo = jest.fn(() => ({
  websocketUrl: 'ws://127.0.0.1:8081',
  activeJobsUri: 'locallama://jobs/active',
  jobProgressUriTemplate: 'locallama://jobs/progress/{jobId}',
}));

jest.unstable_mockModule('../dist/modules/decision-engine/services/jobTracker.js', () => ({
  getJobTrackerSync: jest.fn(() => ({
    getMonitoringInfo: mockGetMonitoringInfo,
  })),
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
const mockBenchmarkFreeModels = jest.fn<() => Promise<{ results: Record<string, unknown>; summary: { modelsCount: number } }>>()
  .mockResolvedValue({
    results: {},
    summary: { modelsCount: 0 },
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

jest.unstable_mockModule('../dist/modules/api-integration/openrouter-integration/index.js', () => ({
  benchmarkFreeModels: mockBenchmarkFreeModels,
  getFreeModels: jest.fn().mockResolvedValue([]),
  updatePromptingStrategy: jest.fn(),
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
  ContextWindowError: class ContextWindowError extends Error {
    public modelContextWindow: number;
    constructor(public modelId: string, public estimatedTokens: number, contextWindow: number) {
      super(`ContextWindowError: ${modelId}`);
      this.name = 'ContextWindowError';
      this.modelContextWindow = contextWindow;
    }
  },
}));

jest.unstable_mockModule('../dist/modules/benchmark/core/runner.js', () => ({
  BenchmarkProviderError: class BenchmarkProviderError extends Error {
    constructor(
      public code: string,
      public providerId: string,
      public modelId: string,
      message: string,
      public retryAfterMs?: number,
    ) {
      super(message);
      this.name = 'BenchmarkProviderError';
    }
  },
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
    mockGetTaskStatus.mockClear();
    mockCancelTask.mockClear();
    mockEstimateCost.mockClear();
    mockReloadConfig.mockClear();
    mockBenchmarkTask.mockClear();
    mockBenchmarkTasks.mockClear();
    mockBenchmarkFreeModels.mockClear();
    mockGetMonitoringInfo.mockClear();
    mockIsAlertActive.mockReturnValue(false);
    mockBuildQueueAlert.mockResolvedValue(null);
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
    expect(parsed.task_id).toBe('task-queued-123');
    expect(parsed.status).toBe('queued');
    expect(parsed.model).toBe('llama-3.2-3b');
    expect(parsed.provider).toBe('lm-studio');
    expect(parsed.monitoring).toMatchObject({
      websocketUrl: 'ws://127.0.0.1:8081',
      activeJobsUri: 'locallama://jobs/active',
      jobProgressUriTemplate: 'locallama://jobs/progress/{jobId}',
    });
    expect(parsed.monitoring.note).toContain('live job updates');
  });

  it('returns a structured context_overflow body from route_task', async () => {
    if (!capturedHandler) throw new Error('handler not registered');
    const { ContextWindowError } = await import('../dist/modules/api-integration/task-execution/index.js');
    mockRouteTask.mockRejectedValueOnce(new ContextWindowError('tiny-model', 42, 32));

    const result = await capturedHandler(
      {
        params: {
          name: 'route_task',
          arguments: { task: 'oversized prompt', context_length: 42 },
        },
      },
      {},
    );

    const typed = result as { content: { type: string; text: string }[]; isError?: boolean };
    expect(typed.isError).toBe(true);
    const parsed = JSON.parse(typed.content[0].text);
    expect(parsed).toMatchObject({
      error: 'context_overflow',
      modelId: 'tiny-model',
      estimatedTokens: 42,
      modelContextWindow: 32,
    });
  });

  it('returns a structured inference_timeout body from route_task', async () => {
    if (!capturedHandler) throw new Error('handler not registered');
    const { InferenceTimeoutError } = await import('../dist/modules/utils/inferenceTimeout.js');
    mockRouteTask.mockRejectedValueOnce(
      new InferenceTimeoutError('openrouter', 45000, 'OpenRouter inference timed out after 45000ms.'),
    );

    const result = await capturedHandler(
      {
        params: {
          name: 'route_task',
          arguments: { task: 'slow prompt', context_length: 1200 },
        },
      },
      {},
    );

    const typed = result as { content: { type: string; text: string }[]; isError?: boolean };
    expect(typed.isError).toBe(true);
    const parsed = JSON.parse(typed.content[0].text);
    expect(parsed).toMatchObject({
      error: 'inference_timeout',
      providerId: 'openrouter',
      timeoutMs: 45000,
    });
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
    const parsed = JSON.parse(typed.content[0].text);
    expect(parsed.monitoring).toBeUndefined();
  });

  it('routes reload_config to the config module', async () => {
    if (!capturedHandler) throw new Error('handler not registered');

    const result = await capturedHandler(
      {
        params: {
          name: 'reload_config',
          arguments: {},
        },
      },
      {},
    );

    expect(mockReloadConfig).toHaveBeenCalledTimes(1);
    const typed = result as { content: { type: string; text: string }[] };
    const parsed = JSON.parse(typed.content[0].text);
    expect(parsed).toMatchObject({
      success: true,
      activeConfig: {
        openRouterFreeOnly: false,
        tokenThreshold: 2222,
      },
    });
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

  it('routes get_task_status to the routing module', async () => {
    if (!capturedHandler) throw new Error('handler not registered');

    const result = await capturedHandler(
      {
        params: {
          name: 'get_task_status',
          arguments: { task_id: 'task-queued-123' },
        },
      },
      {},
    );

    expect(mockGetTaskStatus).toHaveBeenCalledWith('task-queued-123');
    const typed = result as { content: { type: string; text: string }[] };
    const parsed = JSON.parse(typed.content[0].text);
    expect(parsed.status).toBe('completed');
    expect(parsed.jobs[0].result).toContain('hello');
  });

  it('routes cancel_task to the routing module', async () => {
    if (!capturedHandler) throw new Error('handler not registered');

    const result = await capturedHandler(
      {
        params: {
          name: 'cancel_task',
          arguments: { task_id: 'task-queued-123' },
        },
      },
      {},
    );

    expect(mockCancelTask).toHaveBeenCalledWith('task-queued-123');
    const typed = result as { content: { type: string; text: string }[] };
    const parsed = JSON.parse(typed.content[0].text);
    expect(parsed).toMatchObject({ success: true, cancelled_count: 1 });
  });

  it('includes _queue_alert when failed jobs are present', async () => {
    if (!capturedHandler) throw new Error('handler not registered');
    mockIsAlertActive.mockReturnValueOnce(true);
    mockBuildQueueAlert.mockResolvedValueOnce({
      failed: 1,
      permanently_failed: 0,
      task_ids: ['task-failed'],
    });

    const result = await capturedHandler(
      {
        params: {
          name: 'get_cost_estimate',
          arguments: { context_length: 200 },
        },
      },
      {},
    );

    const typed = result as { content: { type: string; text: string }[] };
    const parsed = JSON.parse(typed.content[0].text);
    expect(parsed._queue_alert).toEqual({
      failed: 1,
      permanently_failed: 0,
      task_ids: ['task-failed'],
    });
  });

  it('omits _queue_alert when no failed jobs are present', async () => {
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

    const typed = result as { content: { type: string; text: string }[] };
    const parsed = JSON.parse(typed.content[0].text);
    expect(parsed._queue_alert).toBeUndefined();
  });

  it('attaches _server_reminder to successful tool responses', async () => {
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

    const typed = result as { content: { type: string; text: string }[] };
    const parsed = JSON.parse(typed.content[0].text);
    expect(parsed._server_reminder).toMatchObject({
      schemaVersion: 1,
      kind: 'monitoring-reminder',
      status: 'unknown',
      scope: 'server-local',
    });
    expect(parsed._server_reminder.message).toContain('monitoring');
  });

  it('attaches _server_reminder to handled-error tool responses', async () => {
    if (!capturedHandler) throw new Error('handler not registered');
    const { ContextWindowError } = await import('../dist/modules/api-integration/task-execution/index.js');
    mockRouteTask.mockRejectedValueOnce(new ContextWindowError('tiny-model', 42, 32));

    const result = await capturedHandler(
      {
        params: {
          name: 'route_task',
          arguments: { task: 'oversized prompt', context_length: 42 },
        },
      },
      {},
    );

    const typed = result as { content: { type: string; text: string }[]; isError?: boolean };
    expect(typed.isError).toBe(true);
    const parsed = JSON.parse(typed.content[0].text);
    expect(parsed.error).toBe('context_overflow');
    expect(parsed._server_reminder).toMatchObject({
      schemaVersion: 1,
      kind: 'monitoring-reminder',
      status: 'unknown',
      scope: 'server-local',
    });
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
    expect(parsed.monitoring.websocketUrl).toBe('ws://127.0.0.1:8081');
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

  it('routes benchmark_free_models to the OpenRouter integration', async () => {
    if (!capturedHandler) throw new Error('handler not registered');

    await capturedHandler(
      {
        params: {
          name: 'benchmark_free_models',
          arguments: {
            tasks: [
              {
                task_id: 'benchmark-free-models',
                task: 'Write a small TypeScript memoization helper.',
                context_length: 300,
                expected_output_length: 120,
                complexity: 0.4,
              },
            ],
            runs_per_task: 1,
            parallel: false,
            max_parallel_tasks: 1,
          },
        },
      },
      {},
    );

    expect(mockBenchmarkFreeModels).toHaveBeenCalledWith({
      tasks: [
        {
          taskId: 'benchmark-free-models',
          task: 'Write a small TypeScript memoization helper.',
          contextLength: 300,
          expectedOutputLength: 120,
          complexity: 0.4,
          localModel: undefined,
          paidModel: undefined,
        },
      ],
      runsPerTask: 1,
      parallel: false,
      maxParallelTasks: 1,
    });
  });

  it('returns a structured benchmark_rate_limited body from benchmark_free_models', async () => {
    if (!capturedHandler) throw new Error('handler not registered');
    const { BenchmarkProviderError } = await import('../dist/modules/benchmark/core/runner.js');
    mockBenchmarkFreeModels.mockRejectedValueOnce(
      new BenchmarkProviderError(
        'benchmark_rate_limited',
        'openrouter',
        'openrouter/free-code',
        'OpenRouter rate limit reached (10 calls/min). Retry after 60s.',
        60000,
      ),
    );

    const result = await capturedHandler(
      {
        params: {
          name: 'benchmark_free_models',
          arguments: {
            tasks: [
              {
                task_id: 'rate-limit-case',
                task: 'Write a JavaScript add function.',
                context_length: 80,
              },
            ],
          },
        },
      },
      {},
    );

    const typed = result as { content: { type: string; text: string }[]; isError?: boolean };
    expect(typed.isError).toBe(true);
    const parsed = JSON.parse(typed.content[0].text);
    expect(parsed).toMatchObject({
      error: 'benchmark_rate_limited',
      providerId: 'openrouter',
      modelId: 'openrouter/free-code',
      retryAfterMs: 60000,
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
