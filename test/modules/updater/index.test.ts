import { describe, expect, it, jest, beforeEach } from '@jest/globals';
import { EventEmitter } from 'events';

const mockExecSync = jest.fn();
const mockExecFile = jest.fn();
const mockHttpsGet = jest.fn();

jest.unstable_mockModule('child_process', () => ({
  execSync: mockExecSync,
  execFile: mockExecFile,
}));

jest.unstable_mockModule('https', () => ({
  default: { get: mockHttpsGet },
  get: mockHttpsGet,
}));

const updater = await import('../../../dist/modules/updater/index.js');

function mockRemoteSha(sha: string): void {
  mockHttpsGet.mockImplementation((_url, _options, callback) => {
    const response = new EventEmitter() as EventEmitter & {
      statusCode: number;
      resume: () => void;
    };
    response.statusCode = 200;
    response.resume = jest.fn();

    setImmediate(() => {
      callback(response);
      response.emit('data', Buffer.from(JSON.stringify({ sha })));
      response.emit('end');
    });

    return {
      on: jest.fn(),
      setTimeout: jest.fn(),
      destroy: jest.fn(),
    };
  });
}

function mockRemoteFailure(statusCode = 500): void {
  mockHttpsGet.mockImplementation((_url, _options, callback) => {
    const response = new EventEmitter() as EventEmitter & {
      statusCode: number;
      resume: () => void;
    };
    response.statusCode = statusCode;
    response.resume = jest.fn();

    setImmediate(() => {
      callback(response);
    });

    return {
      on: jest.fn(),
      setTimeout: jest.fn(),
      destroy: jest.fn(),
    };
  });
}

describe('getLocalSha', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns trimmed SHA string when git succeeds', async () => {
    mockExecSync.mockReturnValue(Buffer.from('abc1234\n'));

    const sha = await updater.getLocalSha();

    expect(sha).toBe('abc1234');
  });

  it('returns null when git is not available', async () => {
    mockExecSync.mockImplementation(() => {
      throw new Error('git not found');
    });

    const sha = await updater.getLocalSha();

    expect(sha).toBeNull();
  });
});

describe('getRemoteSha', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns the SHA from GitHub API response JSON', async () => {
    mockRemoteSha('def5678');

    const sha = await updater.getRemoteSha();

    expect(sha).toBe('def5678');
  });

  it('returns null when GitHub returns a non-200 status', async () => {
    mockRemoteFailure(503);

    const sha = await updater.getRemoteSha();

    expect(sha).toBeNull();
  });
});

describe('checkForUpdates', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns upToDate true when SHAs match', async () => {
    mockExecSync.mockReturnValue(Buffer.from('abc1234\n'));
    mockRemoteSha('abc1234');

    const result = await updater.checkForUpdates();

    expect(result.upToDate).toBe(true);
    expect(result.localSha).toBe('abc1234');
    expect(result.remoteSha).toBe('abc1234');
  });

  it('returns upToDate false when SHAs differ', async () => {
    mockExecSync.mockReturnValue(Buffer.from('abc1234\n'));
    mockRemoteSha('def5678');

    const result = await updater.checkForUpdates();

    expect(result.upToDate).toBe(false);
  });

  it('returns upToDate null when local SHA cannot be read', async () => {
    mockExecSync.mockImplementation(() => {
      throw new Error('git not found');
    });
    mockRemoteSha('def5678');

    const result = await updater.checkForUpdates();

    expect(result.upToDate).toBeNull();
    expect(result.localSha).toBeNull();
    expect(result.remoteSha).toBe('def5678');
    expect(result.error).toBe('Could not read local git SHA');
  });
});
