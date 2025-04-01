import { LocalLamaMcpServer } from '../src/index';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { setupResourceHandlers } from '../src/modules/api-integration/resources.js';
import { toolDefinitionProvider } from '../src/modules/api-integration/tool-definition/index.js';
import { createLockFile, isLockFilePresent, removeLockFile, getLockFileInfo } from '../src/utils/lock-file.js';
import { decisionEngine } from '../src/modules/decision-engine/index.js'; // Import decisionEngine directly

// Mock necessary modules and functions
jest.mock('@modelcontextprotocol/sdk/server/index.js');
jest.mock('@modelcontextprotocol/sdk/server/stdio.js');
jest.mock('../src/modules/api-integration/resources.js');
jest.mock('../src/modules/api-integration/tool-definition/index.js', () => ({
  toolDefinitionProvider: {
    initialize: jest.fn().mockResolvedValue(undefined),
  }
}));
jest.mock('../src/utils/lock-file.js');
// Mock decision engine
jest.mock('../src/modules/decision-engine/index.js', () => ({
  decisionEngine: {
    initialize: jest.fn().mockResolvedValue(undefined), // Mock initialize method
    // Add mocks for other methods if needed
  }
}));


describe('LocalLamaMcpServer', () => {
  // Use the actual type instead of any
  let server: LocalLamaMcpServer;

  beforeEach(() => {
    // Clear mocks before each test
    jest.clearAllMocks();

    // Initialize the server before each test
    // Use 'any' cast locally for constructor due to complex mock dependencies
    server = new (LocalLamaMcpServer as any)();
  });

  it('should initialize correctly', () => {
    // Ensure the server and tool definition provider are initialized
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
    expect(processOnSpy).toHaveBeenCalledTimes(3); // Ensure exactly 3 handlers are set
  });

  it('should shut down gracefully on SIGINT', async () => {
    // Spy on shutdown and process.exit
    // Use 'any' cast for spying on private/mocked methods
    const shutdownSpy = jest.spyOn(server as any, 'shutdown');
    // Correct mock implementation signature for process.exit
    const processExitSpy = jest.spyOn(process, 'exit').mockImplementation((() => { throw new Error('process.exit called'); }) as (code?: string | number | null) => never);

    // Simulate SIGINT signal
    process.emit('SIGINT');

    // Wait for shutdown to complete
    await new Promise(resolve => setImmediate(resolve)); // Use setImmediate for faster async resolution

    expect(shutdownSpy).toHaveBeenCalledTimes(1);
    // Check that process.exit was called, catching the thrown error
    expect(processExitSpy).toThrow('process.exit called');
  });

  it('should handle uncaught exceptions', async () => {
    // Spy on shutdown and process.exit
    const shutdownSpy = jest.spyOn(server as any, 'shutdown');
    // Correct mock implementation signature for process.exit
    const processExitSpy = jest.spyOn(process, 'exit').mockImplementation((() => { throw new Error('process.exit called'); }) as (code?: string | number | null) => never);
    const testError = new Error('Test error');

    // Simulate uncaught exception
    process.emit('uncaughtException', testError);

    // Wait for shutdown to complete
    await new Promise(resolve => setImmediate(resolve));

    expect(shutdownSpy).toHaveBeenCalledTimes(1);
    expect(processExitSpy).toThrow('process.exit called');
  });

  it('should handle unhandled rejections', async () => {
    // Spy on shutdown and process.exit
    const shutdownSpy = jest.spyOn(server as any, 'shutdown');
    // Correct mock implementation signature for process.exit
    const processExitSpy = jest.spyOn(process, 'exit').mockImplementation((() => { throw new Error('process.exit called'); }) as (code?: string | number | null) => never);
    const testRejection = new Error('Test rejection');

    // Simulate unhandled rejection - requires reason and promise
    process.emit('unhandledRejection', testRejection, Promise.reject(testRejection));

    // Wait for shutdown to complete
    await new Promise(resolve => setImmediate(resolve));

    expect(shutdownSpy).toHaveBeenCalledTimes(1);
    expect(processExitSpy).toThrow('process.exit called');
  });

  it('should set up tool call handler', async () => {
    // Spy on setRequestHandler to verify tool call handler setup
    // Use 'any' cast to access mocked server property
    const setRequestHandlerSpy = jest.spyOn((server as any).server, 'setRequestHandler');

    // Mock the import statements (ensure mocks are correctly set up if needed elsewhere)
    jest.mock('../src/modules/api-integration/routing/index.js', () => ({
      routeTask: jest.fn().mockResolvedValue({})
    }));
    jest.mock('../src/modules/api-integration/cost-estimation/index.js', () => ({
      estimateCost: jest.fn().mockResolvedValue({})
    }));

    // Access private method using 'any' cast for testing
    await (server as any)['setupToolCallHandler']();

    expect(setRequestHandlerSpy).toHaveBeenCalledTimes(1);
  });

  it('should run the server', async () => {
    // Mock lock file and decision engine initialization
    (isLockFilePresent as jest.Mock).mockReturnValue(false);
    (createLockFile as jest.Mock).mockImplementation(() => {});
    // Access mocked decisionEngine initialize method correctly
    const decisionEngineInitializeMock = decisionEngine.initialize as jest.Mock;
    (setupResourceHandlers as jest.Mock).mockImplementation(() => {});
    // Mock the prototype correctly
    const connectMock = jest.fn().mockResolvedValue(undefined);
    (StdioServerTransport as jest.Mock).mockImplementation(() => ({
        connect: connectMock
    }));

    // Call public method - run() should be public on LocalLamaMcpServer
    // Cast locally if necessary due to constructor issues
    await (server as any).run();

    expect(isLockFilePresent).toHaveBeenCalledTimes(1);
    expect(createLockFile).toHaveBeenCalledTimes(1);
    // Check the mock directly
    expect(decisionEngineInitializeMock).toHaveBeenCalledTimes(1);
    expect(setupResourceHandlers).toHaveBeenCalledTimes(1);
    expect(StdioServerTransport).toHaveBeenCalledTimes(1);
    expect(connectMock).toHaveBeenCalledTimes(1); // Verify connect was called
  });

  it('should handle existing lock file', async () => {
    // Mock lock file presence and info retrieval
    (isLockFilePresent as jest.Mock).mockReturnValue(true);
    (getLockFileInfo as jest.Mock).mockReturnValue({ pid: 123, startTime: 'test' });
    // Correct mock implementation signature for process.exit
    const processExitSpy = jest.spyOn(process, 'exit').mockImplementation((() => { throw new Error('process.exit called'); }) as (code?: string | number | null) => never);

    // Call public method - run() should be public on LocalLamaMcpServer
    // Cast locally if necessary due to constructor issues
    await (server as any).run();

    expect(isLockFilePresent).toHaveBeenCalledTimes(1);
    expect(getLockFileInfo).toHaveBeenCalledTimes(1);
    expect(processExitSpy).toThrow('process.exit called');
  });

  it('should shut down the server', async () => {
    // Spy on server close and lock file removal
    // Use 'any' cast to access mocked server property
    const serverCloseSpy = jest.spyOn((server as any).server, 'close').mockResolvedValue(undefined);
    (removeLockFile as jest.Mock).mockImplementation(() => {});

    // Access private method using 'any' cast for testing
    await (server as any)['shutdown']();

    expect(serverCloseSpy).toHaveBeenCalledTimes(1);
    expect(removeLockFile).toHaveBeenCalledTimes(1);
  });
});