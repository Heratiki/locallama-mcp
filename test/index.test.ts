import { describe, expect, it, jest, ,beforeAll, afterAll, beforeEach } from '@jest/globals';
import { LocalLamaMcpServer } from '../dist/index.js';

// Create mock objects first
const mockServer = {
  setRequestHandler: jest.fn(),
  close: jest.fn().mockReturnValue(Promise.resolve())
};

const mockLockFile = {
  isLockFilePresent: jest.fn(),
  createLockFile: jest.fn(),
  removeLockFile: jest.fn(),
  getLockFileInfo: jest.fn()
};

// Set up mocks before imports
jest.mock('@modelcontextprotocol/sdk/server/index.js', () => ({
  Server: jest.fn(() => mockServer)
}));
jest.mock('../dist/modules/api-integration/tool-definition/index.js', () => ({
  toolDefinitionProvider: {
    initialize: jest.fn().mockReturnValue(Promise.resolve()),
  }
}));
// Add manual mock for lock-file
jest.mock('../dist/utils/lock-file.js', () => ({
  isLockFilePresent: jest.fn(),
  createLockFile: jest.fn(),
  removeLockFile: jest.fn(),
  getLockFileInfo: jest.fn(),
}));
jest.mock('../dist/modules/decision-engine/index.js', () => ({
  decisionEngine: {
    initialize: jest.fn().mockReturnValue(Promise.resolve()),
  }
}));

// Import after all mocks are defined
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { setupResourceHandlers } from '../dist/modules/api-integration/resources.js';
import { toolDefinitionProvider } from '../dist/modules/api-integration/tool-definition/index.js';
import * as lockFile from '../dist/utils/lock-file.js'; // Ensure path points to dist and uses .js
import { decisionEngine } from '../dist/modules/decision-engine/index.js'; // Import decisionEngine directly


describe('LocalLamaMcpServer', () => {
  let server: LocalLamaMcpServer;
  let exitSpy: jest.SpyInstance; // Use correct type

  beforeAll(() => {
    // Mock process.exit once for the entire suite
    exitSpy = jest.spyOn(process, 'exit').mockImplementation((() => {}) as (code?: number | undefined) => never);
  });

  afterAll(() => {
    // Restore the mock after all tests in the suite
    exitSpy.mockRestore();
  });

  beforeEach(() => {
    // Clear mocks before each test
    jest.clearAllMocks();

    // Initialize the server before each test
    server = new LocalLamaMcpServer();
  });

  it('should initialize correctly', () => {
    // Ensure the server and tool definition provider are initialized
    // Assert against the mock constructor returned by jest.mock
    expect(Server).toHaveBeenCalledTimes(1);
    // Access mocked initialize directly and cast
    expect(toolDefinitionProvider.initialize as jest.Mock).toHaveBeenCalledTimes(1);
  });

  it('should set up process signal handlers', () => {
    // Spy on process.on to verify signal handlers are set up
    const processOnSpy = jest.spyOn(process, 'on');
    // Access private method using 'any' cast for testing
    (server as any)['setupProcessSignalHandlers']();
    expect(processOnSpy).toHaveBeenCalledWith('SIGINT', expect.any(Function));
    expect(processOnSpy).toHaveBeenCalledWith('uncaughtException', expect.any(Function));
    expect(processOnSpy).toHaveBeenCalledWith('unhandledRejection', expect.any(Function));
    // Adjust expected call count based on previous run
    expect(processOnSpy).toHaveBeenCalledTimes(5);
  });

  it('should shut down gracefully on SIGINT', async () => {
    const shutdownSpy = jest.spyOn(server as any, 'shutdown');
    // No local mock needed

    process.emit('SIGINT');
    await new Promise(resolve => setImmediate(resolve));

    expect(shutdownSpy).toHaveBeenCalledTimes(1);
    // Use the suite-level spy
    expect(exitSpy).toHaveBeenCalledWith(0);
    // Clear mock calls for the next test if necessary (or handle in beforeEach)
    exitSpy.mockClear(); 
    shutdownSpy.mockClear();
  });

  it('should handle uncaught exceptions', async () => {
    const shutdownSpy = jest.spyOn(server as any, 'shutdown');
    // No local mock needed
    const testError = new Error('Test error');

    process.emit('uncaughtException', testError);
    await new Promise(resolve => setImmediate(resolve));

    expect(shutdownSpy).toHaveBeenCalledTimes(1);
    // Use the suite-level spy
    expect(exitSpy).toHaveBeenCalledWith(1);
    exitSpy.mockClear();
    shutdownSpy.mockClear();
  });

  it('should handle unhandled rejections', async () => {
    const shutdownSpy = jest.spyOn(server as any, 'shutdown');
    // No local mock needed
    const testRejection = new Error('Test rejection');

    process.emit('unhandledRejection', testRejection, Promise.reject(testRejection));
    await new Promise(resolve => setImmediate(resolve));

    expect(shutdownSpy).toHaveBeenCalledTimes(1);
    // Use the suite-level spy
    expect(exitSpy).toHaveBeenCalledWith(1);
    exitSpy.mockClear();
    shutdownSpy.mockClear();
  });

  it('should set up tool call handler', async () => {
    // Spy on setRequestHandler on the mockServer instance
    const setRequestHandlerSpy = jest.spyOn(mockServer, 'setRequestHandler');

    // Mock the import statements (ensure mocks are correctly set up if needed elsewhere)
    // Note: Mocking imports inside tests is generally discouraged, prefer top-level mocks
    // jest.mock('../dist/modules/api-integration/routing/index.js', () => ({ ... }));
    // jest.mock('../dist/modules/api-integration/cost-estimation/index.js', () => ({ ... }));

    // Access private method using 'any' cast for testing
    await (server as any)['setupToolCallHandler']();

    expect(setRequestHandlerSpy).toHaveBeenCalledTimes(1);
  });

  it('should run the server', async () => {
    // Mock lock file and decision engine initialization
    // Access functions via the imported module object
    (lockFile.isLockFilePresent as jest.Mock).mockReturnValue(false);
    (lockFile.createLockFile as jest.Mock).mockImplementation(() => {});
    // Access mocked decisionEngine initialize method correctly
    const decisionEngineInitializeMock = decisionEngine.initialize as jest.Mock;
    (setupResourceHandlers as jest.Mock).mockImplementation(() => {});
    // Mock the prototype correctly
    const connectMock = jest.fn().mockReturnValue(Promise.resolve());
    // Ensure StdioServerTransport is mocked correctly if it's a class
    jest.mock('@modelcontextprotocol/sdk/server/stdio.js', () => ({
      StdioServerTransport: jest.fn().mockImplementation(() => ({
        connect: connectMock
      }))
    }));

    // Re-import after mock if necessary, or ensure mock is hoisted
    const { StdioServerTransport: MockedTransport } = await import('@modelcontextprotocol/sdk/server/stdio.js');

    await server.run();

    expect(lockFile.isLockFilePresent).toHaveBeenCalledTimes(1);
    expect(lockFile.createLockFile).toHaveBeenCalledTimes(1);
    // Check the mock directly
    expect(decisionEngineInitializeMock).toHaveBeenCalledTimes(1);
    expect(setupResourceHandlers).toHaveBeenCalledTimes(1);
    expect(MockedTransport).toHaveBeenCalledTimes(1);
    expect(connectMock).toHaveBeenCalledTimes(1); // Verify connect was called
  });

  it('should handle existing lock file', async () => {
    // Access functions via the imported module object
    (lockFile.isLockFilePresent as jest.Mock).mockReturnValue(true);
    (lockFile.getLockFileInfo as jest.Mock).mockReturnValue({ pid: 123, startTime: 'test' });
    // No local mock needed

    await server.run();

    expect(lockFile.isLockFilePresent).toHaveBeenCalledTimes(1);
    expect(lockFile.getLockFileInfo).toHaveBeenCalledTimes(1);
    // Use the suite-level spy
    expect(exitSpy).toHaveBeenCalledWith(0); // Check the suite-level spy
    exitSpy.mockClear(); // Clear calls for next test
  });

  it('should shut down the server', async () => {
    // Spy on server close and lock file removal
    // Use 'any' cast to access mocked server property
    const serverCloseSpy = jest.spyOn((server as any).server, 'close').mockResolvedValue(undefined);
    // Access function via the imported module object
    (lockFile.removeLockFile as jest.Mock).mockImplementation(() => {});

    // Access private method using 'any' cast for testing
    await (server as any)['shutdown']();

    expect(serverCloseSpy).toHaveBeenCalledTimes(1);
    expect(lockFile.removeLockFile).toHaveBeenCalledTimes(1);
  });
});