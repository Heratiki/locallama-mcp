import { describe, expect, it, jest, beforeEach } from '@jest/globals';

const serverMock = {
  setRequestHandler: jest.fn(),
  close: jest.fn().mockResolvedValue(undefined),
  connect: jest.fn().mockResolvedValue(undefined),
  onerror: undefined as ((error: unknown) => void) | undefined
};

const serverConstructorMock = jest.fn(() => serverMock);
const toolInitializeMock = jest.fn();

jest.unstable_mockModule('@modelcontextprotocol/sdk/server/index.js', () => ({
  Server: serverConstructorMock
}));

jest.unstable_mockModule('@modelcontextprotocol/sdk/server/stdio.js', () => ({
  StdioServerTransport: jest.fn()
}));

jest.unstable_mockModule('../dist/modules/api-integration/tool-definition/index.js', () => ({
  toolDefinitionProvider: {
    initialize: toolInitializeMock
  }
}));

jest.unstable_mockModule('../dist/modules/api-integration/resources.js', () => ({
  setupResourceHandlers: jest.fn()
}));

jest.unstable_mockModule('../dist/utils/logger.js', () => ({
  logger: {
    error: jest.fn(),
    warn: jest.fn(),
    info: jest.fn(),
    debug: jest.fn()
  }
}));

// Mock the modules that setupToolCallHandler() dynamically imports so those
// async import chains resolve immediately and don't outlive the Jest environment.
jest.unstable_mockModule('../dist/modules/api-integration/routing/index.js', () => ({
  routeTask: jest.fn(),
  preemptiveRouteTask: jest.fn(),
  cancelJob: jest.fn(),
}));

jest.unstable_mockModule('../dist/modules/api-integration/cost-estimation/index.js', () => ({
  estimateCost: jest.fn(),
}));

const { LocalLamaMcpServer } = await import('../dist/index.js');

describe('LocalLamaMcpServer', () => {
  afterAll(async () => {
    // Flush pending microtasks and macrotasks so the async import() chain inside
    // setupToolCallHandler() has a chance to resolve before Jest tears down the
    // environment. Without this, the dynamic imports fire after cleanup and
    // produce "import after environment torn down" ReferenceErrors.
    for (let i = 0; i < 5; i++) await Promise.resolve();
    await new Promise<void>(resolve => setImmediate(resolve));
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('constructs server and initializes tool definitions', () => {
    const server = new LocalLamaMcpServer();

    expect(server).toBeDefined();
    expect(serverConstructorMock).toHaveBeenCalledTimes(1);
    expect(toolInitializeMock).toHaveBeenCalledTimes(1);
  });
});
