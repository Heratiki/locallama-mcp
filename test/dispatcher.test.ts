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
