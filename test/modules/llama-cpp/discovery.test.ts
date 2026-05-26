import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import path from 'path';

// --- mocks ---------------------------------------------------------------

const configMock = {
  llamaCppServerBin: '',
  llamaCppCliBin: '',
  llamaCppModelPath: '',
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

// Mock fs/promises
const fsMock = {
  access: jest.fn<any>(),
  readdir: jest.fn<any>(),
};
jest.unstable_mockModule('fs/promises', () => fsMock);

// Mock child_process
const execMock = jest.fn<any>();
jest.unstable_mockModule('child_process', () => ({
  exec: execMock,
}));

// --- imports -------------------------------------------------------------

const { discoverLlamaBinaries } = await import('../../../dist/modules/llama-cpp/discovery.js');

// -------------------------------------------------------------------------

describe('discoverLlamaBinaries', () => {
  beforeEach(() => {
    jest.resetAllMocks();
    configMock.llamaCppServerBin = '';
    configMock.llamaCppCliBin = '';
    configMock.llamaCppModelPath = '';
    
    // Default: no files exist
    fsMock.access.mockRejectedValue(new Error('ENOENT'));
    
    // Default: exec fails
    execMock.mockImplementation((_cmd: string, callback: any) => {
      callback(new Error('command not found'), '', '');
    });
  });

  it('respects LLAMA_CPP_SERVER_BIN env var (Priority 1)', async () => {
    configMock.llamaCppServerBin = '/custom/path/llama-server';
    fsMock.access.mockImplementation(async (p: string) => {
      if (p === '/custom/path/llama-server') return;
      throw new Error('ENOENT');
    });
    
    execMock.mockImplementation((_cmd: string, callback: any) => {
      callback(null, 'version 1.2.3\nflags: --reasoning-format', '');
    });

    const result = await discoverLlamaBinaries();
    expect(result.server).toBe('/custom/path/llama-server');
    expect(result.version).toBe('version 1.2.3');
    expect(result.supportsReasoningFormat).toBe(true);
  });

  it('scans PATH for binaries (Priority 2)', async () => {
    const originalPath = process.env.PATH;
    process.env.PATH = '/usr/bin:/usr/local/bin';
    
    fsMock.access.mockImplementation(async (p: string) => {
      if (p === '/usr/local/bin/llama-server') return;
      throw new Error('ENOENT');
    });

    try {
      const result = await discoverLlamaBinaries();
      expect(result.server).toBe('/usr/local/bin/llama-server');
      expect(result.searchedPaths).toContain('/usr/local/bin/llama-server');
    } finally {
      process.env.PATH = originalPath;
    }
  });

  it('checks well-known locations (Priority 3)', async () => {
    // Force linux for this test
    const originalPlatform = process.platform;
    Object.defineProperty(process, 'platform', { value: 'linux' });

    fsMock.access.mockImplementation(async (p: string) => {
      if (p === '/usr/local/bin/llama-server') return;
      throw new Error('ENOENT');
    });

    try {
      const result = await discoverLlamaBinaries();
      expect(result.server).toBe('/usr/local/bin/llama-server');
    } finally {
      Object.defineProperty(process, 'platform', { value: originalPlatform });
    }
  });

  it('checks sibling of LLAMA_CPP_MODEL (Priority 4)', async () => {
    configMock.llamaCppModelPath = '/models/llama-3-8b.gguf';
    fsMock.access.mockImplementation(async (p: string) => {
      if (p === '/models/llama-server') return;
      throw new Error('ENOENT');
    });

    const result = await discoverLlamaBinaries();
    expect(result.server).toBe('/models/llama-server');
  });

  it('handles Windows .exe suffix', async () => {
    const originalPlatform = process.platform;
    Object.defineProperty(process, 'platform', { value: 'win32' });
    
    fsMock.access.mockImplementation(async (p: string) => {
      if (p.endsWith('llama-server.exe')) return;
      throw new Error('ENOENT');
    });

    try {
      const result = await discoverLlamaBinaries();
      expect(result.server).toMatch(/\.exe$/);
    } finally {
      Object.defineProperty(process, 'platform', { value: originalPlatform });
    }
  });

  it('returns nulls and searchedPaths when nothing found', async () => {
    const result = await discoverLlamaBinaries();
    expect(result.server).toBeNull();
    expect(result.cli).toBeNull();
    expect(result.searchedPaths.length).toBeGreaterThan(0);
  });
});
