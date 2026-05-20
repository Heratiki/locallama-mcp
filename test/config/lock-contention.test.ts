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
  it('calls process.exit(1) when createLockFile is called while a lock already exists', async () => {
    const lockModule = await importFreshModule(
      path.resolve(originalCwd, 'dist/utils/lock-file.js'),
      `lock-contention-a=${Date.now()}`
    );

    // First call should create the lock file without error
    lockModule.createLockFile({ port: 0 });
    expect(fs.existsSync(path.join(tempDir, 'locallama.lock'))).toBe(true);

    // Mock process.exit so the test process doesn't actually exit
    const exitSpy = jest.spyOn(process, 'exit').mockImplementation(
      ((code?: number) => { throw new Error(`process.exit(${code}) called`); }) as typeof process.exit
    );

    try {
      // Second call should fail — lock file already exists (EEXIST)
      expect(() => lockModule.createLockFile({ port: 0 })).toThrow();
      expect(exitSpy).toHaveBeenCalledWith(1);
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
