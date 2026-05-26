import { describe, expect, it, jest, beforeEach } from '@jest/globals';
import net from 'net';
import EventEmitter from 'events';

// --- mocks ---------------------------------------------------------------

const configMock = {
  llamaCppPort: 8080,
  llamaCppStartupTimeoutMs: 1000,
  llamaCppServerBin: '/path/to/llama-server',
  llamaCppModelPath: '/path/to/model.gguf',
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

// --- imports -------------------------------------------------------------

const { LlamaServerManager } = await import('../../../dist/modules/llama-cpp/manager.js');
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

describe('LlamaServerManager', () => {
  beforeEach(() => {
    jest.resetAllMocks();
  });

  describe('findFreePort', () => {
    it('returns the requested port if it is free', async () => {
      const manager = new LlamaServerManager();
      const port = await manager.findFreePort(8080);
      expect(port).toBe(8080);
    });

    it('returns the next free port if the requested one is taken', async () => {
      const manager = new LlamaServerManager();
      
      const server = net.createServer();
      await new Promise<void>((resolve) => server.listen(8080, resolve));

      try {
        const port = await manager.findFreePort(8080);
        expect(port).toBeGreaterThan(8080);
      } finally {
        await new Promise<void>((resolve) => server.close(() => resolve()));
      }
    });
  });

  describe('spawnServer', () => {
    it('spawns the server and waits for readiness', async () => {
      const manager = new LlamaServerManager();
      const mockProcess = createMockProcess();
      spawnMock.mockReturnValue(mockProcess);

      (axios.get as jest.Mock).mockResolvedValue({ status: 200, data: { data: [] } });

      await manager.spawnServer('/bin/llama-server', '/models/m.gguf', 8081);
      
      expect(spawnMock).toHaveBeenCalled();
    });

    it('times out if server never becomes ready', async () => {
      const manager = new LlamaServerManager();
      const mockProcess = createMockProcess();
      spawnMock.mockReturnValue(mockProcess);

      (axios.get as jest.Mock).mockRejectedValue(new Error('ECONNREFUSED'));
      configMock.llamaCppStartupTimeoutMs = 100;

      const spawnPromise = manager.spawnServer('/bin/llama-server', '/models/m.gguf', 8081);
      await expect(spawnPromise).rejects.toThrow('llama-server failed to start within 100ms');
    });
  });

  describe('Crash Recovery', () => {
    it('attempts to restart the server on unexpected exit', async () => {
      jest.useFakeTimers();
      const manager = new LlamaServerManager();
      const mockProcess = createMockProcess();
      spawnMock.mockReturnValue(mockProcess);

      (axios.get as jest.Mock).mockResolvedValue({ status: 200, data: { data: [] } });

      await manager.spawnServer('/bin/llama-server', '/models/m.gguf', 8081);
      
      // Trigger exit
      mockProcess.emit('exit', 1, null);

      // Should wait 1s before first restart
      jest.advanceTimersByTime(1100);
      
      expect(spawnMock).toHaveBeenCalledTimes(2);
      jest.useRealTimers();
    });
  });
});
