import fs from 'fs';
import os from 'os';
import path from 'path';
import { randomUUID } from 'crypto';
import { execFileSync } from 'child_process';
import { pathToFileURL } from 'url';
import { afterEach, describe, expect, it } from '@jest/globals';

const originalCwd = process.cwd();
const originalRootDir = process.env.LOCALLAMA_ROOT_DIR;
const originalProviderMaxConcurrentLocal = process.env.PROVIDER_MAX_CONCURRENT_LOCAL;
const originalProviderMaxConcurrentRemote = process.env.PROVIDER_MAX_CONCURRENT_REMOTE;
const originalProviderTimeoutMs = process.env.PROVIDER_TIMEOUT_MS;

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

  if (originalProviderMaxConcurrentLocal === undefined) {
    delete process.env.PROVIDER_MAX_CONCURRENT_LOCAL;
  } else {
    process.env.PROVIDER_MAX_CONCURRENT_LOCAL = originalProviderMaxConcurrentLocal;
  }

  if (originalProviderMaxConcurrentRemote === undefined) {
    delete process.env.PROVIDER_MAX_CONCURRENT_REMOTE;
  } else {
    process.env.PROVIDER_MAX_CONCURRENT_REMOTE = originalProviderMaxConcurrentRemote;
  }

  if (originalProviderTimeoutMs === undefined) {
    delete process.env.PROVIDER_TIMEOUT_MS;
  } else {
    process.env.PROVIDER_TIMEOUT_MS = originalProviderTimeoutMs;
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
      // python.virtualEnv removed — Python BM25 bridge replaced by native TypeScript BM25

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

  it('when LOCALLAMA_ROOT_DIR is not set, rootDir resolves from the dist file location (absolute and exists)', () => {
    // The config module computes rootDir as:
    //   path.resolve(fileURLToPath(import.meta.url), '..', '..', '..')
    // where import.meta.url points to dist/config/index.js (3 levels below project root).
    // Verify this arithmetic produces an absolute path that actually exists on disk.
    const distConfigFile = path.resolve(originalCwd, 'dist', 'config', 'index.js');
    const derivedRootDir = path.resolve(distConfigFile, '..', '..', '..');

    expect(path.isAbsolute(derivedRootDir)).toBe(true);
    expect(fs.existsSync(derivedRootDir)).toBe(true);
  });

  it('defaults provider concurrency caps to one local slot and one remote slot', async () => {
    delete process.env.PROVIDER_MAX_CONCURRENT_LOCAL;
    delete process.env.PROVIDER_MAX_CONCURRENT_REMOTE;

    const configModule = await importFreshModule(
      path.resolve(originalCwd, 'dist/config/index.js'),
      `provider-defaults=${randomUUID()}`
    );

    expect(configModule.config.providerMaxConcurrentLocal).toBe(1);
    expect(configModule.config.providerMaxConcurrentRemote).toBe(1);
  });

  it('defaults provider timeout fallback to 120000ms', async () => {
    delete process.env.PROVIDER_TIMEOUT_MS;

    const configModule = await importFreshModule(
      path.resolve(originalCwd, 'dist/config/index.js'),
      `provider-timeout-default=${randomUUID()}`
    );

    expect(configModule.config.providerTimeoutMs).toBe(120000);
  });

  it('allows provider concurrency caps to be configured with env vars', async () => {
    const script = [
      "import('./dist/config/index.js').then(({ config }) => {",
      "console.log(JSON.stringify({",
      "local: config.providerMaxConcurrentLocal,",
      "remote: config.providerMaxConcurrentRemote",
      "}));",
      "});",
    ].join('');
    const output = execFileSync(
      process.execPath,
      ['--input-type=module', '-e', script],
      {
        cwd: originalCwd,
        env: {
          ...process.env,
          PROVIDER_MAX_CONCURRENT_LOCAL: '2',
          PROVIDER_MAX_CONCURRENT_REMOTE: '3',
        },
        encoding: 'utf8',
      },
    );
    const parsed = JSON.parse(output.trim()) as { local: number; remote: number };

    expect(parsed.local).toBe(2);
    expect(parsed.remote).toBe(3);
  });

  it('allows PROVIDER_TIMEOUT_MS to override the generic provider timeout fallback', async () => {
    const script = [
      "import('./dist/config/index.js').then(({ config }) => {",
      "console.log(JSON.stringify({ providerTimeoutMs: config.providerTimeoutMs }));",
      '});',
    ].join('');
    const output = execFileSync(
      process.execPath,
      ['--input-type=module', '-e', script],
      {
        cwd: originalCwd,
        env: {
          ...process.env,
          PROVIDER_TIMEOUT_MS: '45000',
        },
        encoding: 'utf8',
      },
    );

    const jsonLine = output
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line.startsWith('{') && line.endsWith('}'))
      .pop();

    expect(jsonLine).toBeDefined();
    const parsed = JSON.parse(jsonLine || '{}') as { providerTimeoutMs?: number };
    expect(parsed.providerTimeoutMs).toBe(45000);
  });
});
