import { describe, expect, it, jest, beforeEach } from '@jest/globals';
import EventEmitter from 'events';

// --- mocks ----------------------------------------------------------------

const configMock = {
  llamaCppEndpoint: '',
  llamaCppModelPath: '/models/test.gguf',
  llamaCppCliBin: '',
  llamaCppServerBin: '',
  llamaCppPort: 8080,
  llamaCppStartupTimeoutMs: 1000,
  llamaCppHealthProbeEnabled: false,
  llamaCppMaxCtx: undefined as number | undefined,
  llamaCppServerFlags: [] as string[],
  providerTimeoutMs: 5000,
  defaultModelConfig: { temperature: 0.7, maxTokens: 512 },
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

const discoverMock = jest.fn<any>();
jest.unstable_mockModule('../../../dist/modules/llama-cpp/discovery.js', () => ({
  discoverLlamaBinaries: discoverMock,
}));

const readGgufMetadataMock = jest.fn<any>();
jest.unstable_mockModule('../../../dist/modules/llama-cpp/gguf.js', () => ({
  readGgufMetadata: readGgufMetadataMock,
}));

jest.unstable_mockModule('axios', () => ({
  default: {
    get: jest.fn(),
    post: jest.fn(),
    isAxiosError: jest.fn(() => false),
  },
}));

// --- imports -------------------------------------------------------------

const { llamaCppModule } = await import('../../../dist/modules/llama-cpp/index.js');

// -------------------------------------------------------------------------

function makeCliProcess(stdoutOutput: string, exitCode = 0) {
  const proc = new EventEmitter() as any;
  proc.stdout = new EventEmitter();
  proc.stderr = new EventEmitter();
  proc.kill = jest.fn();
  proc.pid = 9999;
  setTimeout(() => {
    proc.stdout.emit('data', Buffer.from(stdoutOutput));
    proc.emit('exit', exitCode, null);
  }, 10);
  return proc;
}

const DEFAULT_METADATA = {
  architecture: 'llama',
  name: 'Llama-3-8B',
  chatTemplate: null,
  contextLength: 4096,
  isReasoningModel: false,
  recommendedFlags: ['--ctx-size', '4096'],
};

describe('llamaCppModule.executeTaskViaCli', () => {
  beforeEach(() => {
    jest.resetAllMocks();
    configMock.llamaCppEndpoint = '';
    configMock.llamaCppModelPath = '/models/test.gguf';
    configMock.llamaCppServerFlags = [];

    discoverMock.mockResolvedValue({
      server: null,
      cli: '/usr/local/bin/llama-cli',
      run: null,
      version: '1.0',
      supportsReasoningFormat: true,
      searchedPaths: [],
    });

    readGgufMetadataMock.mockResolvedValue(DEFAULT_METADATA);

    llamaCppModule.capabilities.managedProcess = false;
    llamaCppModule.capabilities.modelMetadata = DEFAULT_METADATA;
    llamaCppModule.modelMetadata = DEFAULT_METADATA;
    llamaCppModule.binaries = {
      server: null,
      cli: '/usr/local/bin/llama-cli',
      run: null,
      version: '1.0',
      supportsReasoningFormat: true,
      searchedPaths: [],
    };
  });

  it('tracer bullet: spawns llama-cli and returns captured stdout', async () => {
    spawnMock.mockReturnValue(makeCliProcess('Hello from the model!\n'));

    const result = await llamaCppModule.executeTaskViaCli('m1', 'Say hello', {
      timeoutMs: 2000,
    });

    expect(spawnMock).toHaveBeenCalledWith(
      '/usr/local/bin/llama-cli',
      expect.arrayContaining(['--model', '/models/test.gguf']),
      expect.any(Object),
    );
    expect(result.content).toBe('Hello from the model!');
  });

  it('strips llama-cli debug/progress lines from output', async () => {
    const rawOutput = [
      'llama_load_model_from_file: using CPU backend',
      '[debug] something internal',
      'This is the actual response text.',
      'llama_perf_sampler_print:    mirostat_mu = 0.000000',
      'More response here.',
    ].join('\n');

    spawnMock.mockReturnValue(makeCliProcess(rawOutput));

    const result = await llamaCppModule.executeTaskViaCli('m1', 'task', { timeoutMs: 2000 });

    expect(result.content).toContain('This is the actual response text.');
    expect(result.content).toContain('More response here.');
    expect(result.content).not.toContain('llama_load_model_from_file');
    expect(result.content).not.toContain('[debug]');
  });

  it('includes --reasoning-format none for reasoning models', async () => {
    const reasoningMeta = {
      ...DEFAULT_METADATA,
      isReasoningModel: true,
      recommendedFlags: ['--reasoning-format', 'none', '--ctx-size', '4096'],
    };
    llamaCppModule.modelMetadata = reasoningMeta;
    llamaCppModule.capabilities.modelMetadata = reasoningMeta;

    spawnMock.mockReturnValue(makeCliProcess('response text'));

    await llamaCppModule.executeTaskViaCli('m1', 'task', { timeoutMs: 2000 });

    const spawnArgs = spawnMock.mock.calls[0][1] as string[];
    expect(spawnArgs).toContain('--reasoning-format');
    expect(spawnArgs).toContain('none');
  });

  it('kills process with SIGKILL on timeout', async () => {
    const proc = new EventEmitter() as any;
    proc.stdout = new EventEmitter();
    proc.stderr = new EventEmitter();
    proc.kill = jest.fn();
    proc.pid = 9999;
    // Never emits exit — simulates hung process

    spawnMock.mockReturnValue(proc);

    await expect(
      llamaCppModule.executeTaskViaCli('m1', 'task', { timeoutMs: 100 }),
    ).rejects.toThrow(/timeout/i);

    expect(proc.kill).toHaveBeenCalledWith('SIGKILL');
  });

  it('throws when CLI binary is not available', async () => {
    llamaCppModule.binaries = {
      server: null, cli: null, run: null,
      version: null, supportsReasoningFormat: false, searchedPaths: [],
    };

    await expect(
      llamaCppModule.executeTaskViaCli('m1', 'task', { timeoutMs: 2000 }),
    ).rejects.toThrow(/llama-cli/i);
  });

  it('throws when model path is not configured', async () => {
    configMock.llamaCppModelPath = undefined as any;

    await expect(
      llamaCppModule.executeTaskViaCli('m1', 'task', { timeoutMs: 2000 }),
    ).rejects.toThrow(/model/i);
  });

  it('throws when CLI process exits with non-zero code', async () => {
    spawnMock.mockReturnValue(makeCliProcess('', 1));

    await expect(
      llamaCppModule.executeTaskViaCli('m1', 'task', { timeoutMs: 2000 }),
    ).rejects.toThrow();
  });
});
