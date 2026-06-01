import fs from 'fs';
import os from 'os';
import path from 'path';
import { pathToFileURL } from 'url';
import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';

const originalCwd = process.cwd();
const originalRootDir = process.env.LOCALLAMA_ROOT_DIR;

function importFreshModule(modulePath: string, cacheKey: string) {
  const moduleUrl = new URL(`${pathToFileURL(modulePath).href}?${cacheKey}`);
  return import(moduleUrl.href);
}

let tempDir: string;

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'locallama-lock-'));
  process.env.LOCALLAMA_ROOT_DIR = tempDir;
});

afterEach(() => {
  const lockPath = path.join(tempDir, 'locallama.lock');
  if (fs.existsSync(lockPath)) {
    fs.rmSync(lockPath);
  }
  fs.rmSync(tempDir, { recursive: true, force: true });

  if (originalRootDir === undefined) {
    delete process.env.LOCALLAMA_ROOT_DIR;
  } else {
    process.env.LOCALLAMA_ROOT_DIR = originalRootDir;
  }
});

describe('lock file contention', () => {
  it('overwrites an existing lock file without exiting (stdio MCP: no cross-process singleton)', async () => {
    const lockModule = await importFreshModule(
      path.resolve(originalCwd, 'dist/utils/lock-file.js'),
      `lock-contention-a=${Date.now()}`
    );
    const lockPath = path.join(tempDir, 'locallama.lock');

    // Seed a lock file from a different (stale) instance.
    fs.writeFileSync(lockPath, JSON.stringify({ pid: 999999999, connectionInfo: 'stale' }));

    // process.exit must never be called: a new stdio instance must always start.
    const exitSpy = jest.spyOn(process, 'exit').mockImplementation(
      ((code?: number) => { throw new Error(`process.exit(${code}) called`); }) as typeof process.exit
    );

    try {
      // Second call should overwrite the existing lock with our own pid, not exit.
      expect(() => lockModule.createLockFile({ connectionInfo: 'mine' })).not.toThrow();
      expect(exitSpy).not.toHaveBeenCalled();
      const info = JSON.parse(fs.readFileSync(lockPath, 'utf8'));
      expect(info.pid).toBe(process.pid);
      expect(info.connectionInfo).toBe('mine');
    } finally {
      exitSpy.mockRestore();
      lockModule.removeLockFile();
    }
  });

  it('isLockFileProcessRunning() returns true for the current process PID', async () => {
    const lockModule = await importFreshModule(
      path.resolve(originalCwd, 'dist/utils/lock-file.js'),
      `lock-contention-b=${Date.now()}`
    );

    // Write a lock file that contains the current (live) process PID
    const lockData = JSON.stringify({ pid: process.pid, startTime: new Date().toISOString() });
    fs.writeFileSync(path.join(tempDir, 'locallama.lock'), lockData);

    try {
      expect(lockModule.isLockFileProcessRunning()).toBe(true);
    } finally {
      lockModule.removeLockFile();
    }
  });

  it('removeLockFile() leaves a lock owned by a different live process intact', async () => {
    const lockModule = await importFreshModule(
      path.resolve(originalCwd, 'dist/utils/lock-file.js'),
      `lock-contention-own=${Date.now()}`
    );
    const lockPath = path.join(tempDir, 'locallama.lock');

    // Lock owned by another live process (use the parent pid, guaranteed alive).
    fs.writeFileSync(lockPath, JSON.stringify({ pid: process.ppid, startTime: new Date().toISOString() }));

    lockModule.removeLockFile();
    expect(fs.existsSync(lockPath)).toBe(true); // not ours -> untouched
  });

  it('removeLockFile() removes a lock owned by the current process', async () => {
    const lockModule = await importFreshModule(
      path.resolve(originalCwd, 'dist/utils/lock-file.js'),
      `lock-contention-own2=${Date.now()}`
    );
    const lockPath = path.join(tempDir, 'locallama.lock');

    lockModule.createLockFile({ connectionInfo: 'mine' });
    expect(fs.existsSync(lockPath)).toBe(true);
    lockModule.removeLockFile();
    expect(fs.existsSync(lockPath)).toBe(false);
  });

  it('isLockFileProcessRunning() returns false for a dead PID', async () => {
    const lockModule = await importFreshModule(
      path.resolve(originalCwd, 'dist/utils/lock-file.js'),
      `lock-contention-c=${Date.now()}`
    );

    // PID 999999999 is far beyond any realistic process ID and is guaranteed not to exist
    const lockData = JSON.stringify({ pid: 999999999, startTime: new Date().toISOString() });
    fs.writeFileSync(path.join(tempDir, 'locallama.lock'), lockData);

    try {
      expect(lockModule.isLockFileProcessRunning()).toBe(false);
    } finally {
      lockModule.removeLockFile();
    }
  });
});
