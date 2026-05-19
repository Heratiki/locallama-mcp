import fs from 'fs';
import os from 'os';
import path from 'path';
import { pathToFileURL } from 'url';
import { afterEach, describe, expect, it } from '@jest/globals';

const originalCwd = process.cwd();
const originalRootDir = process.env.LOCALLAMA_ROOT_DIR;

function importFreshModule(modulePath: string, cacheKey: string) {
  const moduleUrl = new URL(`${pathToFileURL(modulePath).href}?${cacheKey}`);
  return import(moduleUrl.href);
}

afterEach(() => {
  process.chdir(originalCwd);

  if (originalRootDir === undefined) {
    delete process.env.LOCALLAMA_ROOT_DIR;
  } else {
    process.env.LOCALLAMA_ROOT_DIR = originalRootDir;
  }
});

describe('root path resolution', () => {
  it('uses LOCALLAMA_ROOT_DIR for config defaults and lock-file placement even when cwd differs', async () => {
    const tempRootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'locallama-root-'));
    const foreignCwd = fs.mkdtempSync(path.join(os.tmpdir(), 'locallama-cwd-'));

    process.env.LOCALLAMA_ROOT_DIR = tempRootDir;
    process.chdir(foreignCwd);

    const configModule = await importFreshModule(
      path.resolve(originalCwd, 'dist/config/index.js'),
      `config=${Date.now()}`
    );
    const lockModule = await importFreshModule(
      path.resolve(originalCwd, 'dist/utils/lock-file.js'),
      `lock=${Date.now()}`
    );

    try {
      expect(configModule.config.rootDir).toBe(tempRootDir);
      expect(configModule.config.cacheDir).toBe(path.join(tempRootDir, '.cache'));
      expect(configModule.config.benchmark.resultsPath).toBe(path.join(tempRootDir, 'benchmark-results'));
      expect(configModule.config.python.virtualEnv).toBe(path.join(tempRootDir, '.venv'));

      lockModule.createLockFile({ port: 0 });
      expect(fs.existsSync(path.join(tempRootDir, 'locallama.lock'))).toBe(true);
      expect(fs.existsSync(path.join(foreignCwd, 'locallama.lock'))).toBe(false);
    } finally {
      lockModule.removeLockFile();
      process.chdir(originalCwd);
      fs.rmSync(tempRootDir, { recursive: true, force: true });
      fs.rmSync(foreignCwd, { recursive: true, force: true });
    }
  });
});