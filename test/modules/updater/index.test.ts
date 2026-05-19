import { describe, expect, it, jest, beforeEach, afterEach } from '@jest/globals';

// We test the pure logic; shell/network calls are mocked.
jest.mock('child_process');
jest.mock('https');

import { execSync } from 'child_process';
import * as https from 'https';

const mockExecSync = execSync as jest.MockedFunction<typeof execSync>;

describe('getLocalSha', () => {
  beforeEach(() => { jest.clearAllMocks(); });

  it('returns trimmed SHA string when git succeeds', async () => {
    mockExecSync.mockReturnValue(Buffer.from('abc1234\n'));
    const { getLocalSha } = await import('../../../dist/modules/updater/index.js');
    const sha = await getLocalSha();
    expect(sha).toBe('abc1234');
  });

  it('returns null when git is not available', async () => {
    mockExecSync.mockImplementation(() => { throw new Error('git not found'); });
    const { getLocalSha } = await import('../../../dist/modules/updater/index.js');
    const sha = await getLocalSha();
    expect(sha).toBeNull();
  });
});

describe('checkForUpdates', () => {
  beforeEach(() => { jest.clearAllMocks(); });

  it('returns upToDate true when SHAs match', async () => {
    mockExecSync.mockReturnValue(Buffer.from('abc1234\n'));
    // getRemoteSha is tested via integration; mock it at module boundary
    const updater = await import('../../../dist/modules/updater/index.js');
    jest.spyOn(updater, 'getRemoteSha').mockResolvedValue('abc1234');
    const result = await updater.checkForUpdates();
    expect(result.upToDate).toBe(true);
    expect(result.localSha).toBe('abc1234');
    expect(result.remoteSha).toBe('abc1234');
  });

  it('returns upToDate false when SHAs differ', async () => {
    mockExecSync.mockReturnValue(Buffer.from('abc1234\n'));
    const updater = await import('../../../dist/modules/updater/index.js');
    jest.spyOn(updater, 'getRemoteSha').mockResolvedValue('def5678');
    const result = await updater.checkForUpdates();
    expect(result.upToDate).toBe(false);
  });

  it('returns upToDate null on error', async () => {
    mockExecSync.mockImplementation(() => { throw new Error('git not found'); });
    const updater = await import('../../../dist/modules/updater/index.js');
    jest.spyOn(updater, 'getRemoteSha').mockRejectedValue(new Error('network'));
    const result = await updater.checkForUpdates();
    expect(result.upToDate).toBeNull();
    expect(result.error).toBeDefined();
  });
});
