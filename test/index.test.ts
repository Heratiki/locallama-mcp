import { LocalLamaMcpServer } from '../src/index';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { setupResourceHandlers } from '../src/modules/api-integration/resources.js';
import { toolDefinitionProvider } from '../src/modules/api-integration/tool-definition/index.js';
import { logger } from '../src/utils/logger.js';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { createLockFile, isLockFilePresent, removeLockFile, getLockFileInfo } from '../src/utils/lock-file.js';

// Mock necessary modules and functions
jest.mock('@modelcontextprotocol/sdk/server/index.js');
jest.mock('@modelcontextprotocol/sdk/server/stdio.js');
jest.mock('../src/modules/api-integration/resources.js');
jest.mock('../src/modules/api-integration/tool-definition/index.js');
jest.mock('../src/utils/logger.js');
jest.mock('fs');
jest.mock('path');
jest.mock('url');
jest.mock('../src/utils/lock-file.js');

describe('LocalLamaMcpServer', () => {
  let server: LocalLamaMcpServer;

  beforeEach(() => {
    // Clear mocks before each test
    jest.clearAllMocks();

    // Initialize the server before each test
    server = new LocalLamaMcpServer();
  });

  it('should initialize correctly', () => {
    // Ensure the server and tool definition provider are initialized
    expect(Server).toHaveBeenCalledTimes(1);
    expect(toolDefinitionProvider.initialize).toHaveBeenCalledTimes(1);
  });

  it('should set up process signal handlers', () => {
    // Spy on process.on to verify signal handlers are set up
    const processOnSpy = jest.spyOn(process, 'on');
    server['setupProcessSignalHandlers']();
    expect(processOnSpy).toHaveBeenCalledTimes(3);
  });

  it('should shut down gracefully on SIGINT', async () => {
    // Spy on shutdown and process.exit
    const shutdownSpy = jest.spyOn(server as any, 'shutdown');
    const processExitSpy = jest.spyOn(process, 'exit').mockImplementation(() => { /* do nothing */ });

    // Simulate SIGINT signal
    process.emit('SIGINT');

    // Wait for shutdown to complete
    await new Promise(resolve => setTimeout(resolve, 0));

    expect(shutdownSpy).toHaveBeenCalledTimes(1);
    expect(processExitSpy).toHaveBeenCalledWith(0);
  });

  it('should handle uncaught exceptions', async () => {
    // Spy on shutdown and process.exit
    const shutdownSpy = jest.spyOn(server as any, 'shutdown');
    const processExitSpy = jest.spyOn(process, 'exit').mockImplementation(() => { /* do nothing */ });

    // Simulate uncaught exception
    process.emit('uncaughtException', new Error('Test error'));

    // Wait for shutdown to complete
    await new Promise(resolve => setTimeout(resolve, 0));

    expect(shutdownSpy).toHaveBeenCalledTimes(1);
    expect(processExitSpy).toHaveBeenCalledWith(1);
  });

  it('should handle unhandled rejections', async () => {
    // Spy on shutdown and process.exit
    const shutdownSpy = jest.spyOn(server as any, 'shutdown');
    const processExitSpy = jest.spyOn(process, 'exit').mockImplementation(() => { /* do nothing */ });

    // Simulate unhandled rejection
    process.emit('unhandledRejection', new Error('Test rejection'));

    // Wait for shutdown to complete
    await new Promise(resolve => setTimeout(resolve, 0));

    expect(shutdownSpy).toHaveBeenCalledTimes(1);
    expect(processExitSpy).toHaveBeenCalledWith(1);
  });

  it('should set up tool call handler', async () => {
    // Spy on setRequestHandler to verify tool call handler setup
    const setRequestHandlerSpy = jest.spyOn((server as any).server, 'setRequestHandler');

    // Mock the import statements
    jest.mock('../src/modules/api-integration/routing/index.js', () => ({
      routeTask: jest.fn().mockResolvedValue({})
    }));
    jest.mock('../src/modules/api-integration/cost-estimation/index.js', () => ({
      estimateCost: jest.fn().mockResolvedValue({})
    }));

    await server['setupToolCallHandler']();

    expect(setRequestHandlerSpy).toHaveBeenCalledTimes(1);
  });

  it('should run the server', async () => {
    // Mock lock file and decision engine initialization
    (isLockFilePresent as jest.Mock).mockReturnValue(false);
    (createLockFile as jest.Mock).mockImplementation(() => {});
    const decisionEngineInitializeSpy = jest.spyOn(await import('../src/modules/decision-engine/index.js'), 'decisionEngine', 'get').mockReturnValue({
      initialize: jest.fn().mockResolvedValue({})
    });
    (setupResourceHandlers as jest.Mock).mockImplementation(() => {});
    (StdioServerTransport as jest.Mock).prototype.connect = jest.fn().mockResolvedValue(undefined);

    await server.run();

    expect(isLockFilePresent).toHaveBeenCalledTimes(1);
    expect(createLockFile).toHaveBeenCalledTimes(1);
    expect(decisionEngineInitializeSpy.initialize).toHaveBeenCalledTimes(1);
    expect(setupResourceHandlers).toHaveBeenCalledTimes(1);
    expect(StdioServerTransport).toHaveBeenCalledTimes(1);
  });

  it('should handle existing lock file', async () => {
    // Mock lock file presence and info retrieval
    (isLockFilePresent as jest.Mock).mockReturnValue(true);
    (getLockFileInfo as jest.Mock).mockReturnValue({ pid: 123, startTime: 'test' });
    const processExitSpy = jest.spyOn(process, 'exit').mockImplementation(() => { /* do nothing */ });

    await server.run();

    expect(isLockFilePresent).toHaveBeenCalledTimes(1);
    expect(getLockFileInfo).toHaveBeenCalledTimes(1);
    expect(processExitSpy).toHaveBeenCalledWith(0);
  });

  it('should shut down the server', async () => {
    // Spy on server close and lock file removal
    const serverCloseSpy = jest.spyOn((server as any).server, 'close').mockResolvedValue(undefined);
    (removeLockFile as jest.Mock).mockImplementation(() => {});

    await server['shutdown']();

    expect(serverCloseSpy).toHaveBeenCalledTimes(1);
    expect(removeLockFile).toHaveBeenCalledTimes(1);
  });
});