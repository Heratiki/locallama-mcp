import { describe, expect, it, jest, beforeEach } from '@jest/globals';
import EventEmitter from 'events';

// --- mocks ---------------------------------------------------------------

const configMock = {
  llamaCppEndpoint: 'http://localhost:8080',
  llamaCppPort: 8080,
  llamaCppStartupTimeoutMs: 1000,
  llamaCppServerBin: '',
  llamaCppModelPath: '/models/m.gguf',
  llamaCppHealthProbeEnabled: false,
};

jest.unstable_mockModule('../../../dist/config/index.js', () => ({
  config: configMock,
}));

const loggerMock = {
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
};

jest.unstable_mockModule('../../../dist/utils/logger.js', () => ({
  logger: loggerMock,
}));

const spawnMock = jest.fn<any>();
jest.unstable_mockModule('child_process', () => ({
  spawn: spawnMock,
}));

jest.unstable_mockModule('axios', () => ({
  default: {
    get: jest.fn(),
  },
}));

const discoverMock = jest.fn<any>();
jest.unstable_mockModule('../../../dist/modules/llama-cpp/discovery.js', () => ({
  __esModule: true,
  discoverLlamaBinaries: discoverMock,
}));

// --- imports -------------------------------------------------------------

const { llamaCppModule } = await import('../../../dist/modules/llama-cpp/index.js');
const { default: axios } = await import('axios');

// -------------------------------------------------------------------------

function createMockProcess() {
  const mockProcess = new EventEmitter() as any;
  mockProcess.stdout = new EventEmitter();
  mockProcess.stdout.resume = jest.fn();
  mockProcess.stdout.pause = jest.fn();
  mockProcess.stderr = new EventEmitter();
  mockProcess.stderr.resume = jest.fn();
  mockProcess.stderr.pause = jest.fn();
  mockProcess.kill = jest.fn();
  mockProcess.pid = 1234;
  return mockProcess;
}

describe('llamaCppModule - Managed Spawn Integration', () => {
  beforeEach(() => {
    jest.resetAllMocks();
    
    // Set up mocks that were cleared by resetAllMocks
    discoverMock.mockResolvedValue({
      server: '/path/to/discovered/llama-server',
      cli: null,
      run: null,
      version: '1.2.3',
      supportsReasoningFormat: true,
      searchedPaths: [],
    });

    llamaCppModule.capabilities.managedProcess = false;
    llamaCppModule.capabilities.health = 'unknown';
    (configMock as any).llamaCppEndpoint = 'http://localhost:8080';
  });

  it('spawns server when existing endpoint is unreachable', async () => {
    const mockProcess = createMockProcess();
    spawnMock.mockReturnValue(mockProcess);

    // 1. Initial refreshModels fails
    (axios.get as jest.Mock)
      .mockRejectedValueOnce(new Error('ECONNREFUSED')) // endpoint unreachable
      .mockResolvedValueOnce({ status: 200, data: { data: [{ id: 'm1' }] } }) // readiness success
      .mockResolvedValueOnce({ status: 200, data: { data: [{ id: 'm1' }] } }); // final refreshModels

    await llamaCppModule.initialize();

    expect(llamaCppModule.capabilities.managedProcess).toBe(true);
    expect(llamaCppModule.capabilities.binaryDiscovered).toBe(true);
    expect(spawnMock).toHaveBeenCalled();
    expect(configMock.llamaCppEndpoint).toMatch(/http:\/\/localhost:\d+/);
  });
});
