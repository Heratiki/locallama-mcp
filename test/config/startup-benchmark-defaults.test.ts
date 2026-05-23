/**
 * Tests for startupBenchmarkTargets default (issue #97) and benchmarkFreshnessHours config.
 *
 * Strategy: the config module singleton is cached by Jest's ESM VM, so the initial `config`
 * value reflects whichever process.env was active on first load.  We avoid that by testing
 * through `reloadConfig()`, which is the only stable way to assert individual field values
 * against a controlled .env inside a cached module (same pattern as reload-config.test.ts).
 */
import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { pathToFileURL } from 'url';
import { randomUUID } from 'crypto';

const originalRootDir = process.env.LOCALLAMA_ROOT_DIR;
const originalStartupTargets = process.env.STARTUP_BENCHMARK_TARGETS;
const originalFreshnessHours = process.env.BENCHMARK_FRESHNESS_HOURS;

function importFreshConfigModule(cacheKey: string) {
  const modulePath = path.resolve(process.cwd(), 'dist/config/index.js');
  const moduleUrl = new URL(`${pathToFileURL(modulePath).href}?${cacheKey}`);
  return import(moduleUrl.href);
}

function restoreEnv(key: string, value: string | undefined) {
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
}

// Minimal .env that satisfies validateConfigValues() (valid endpoint URLs only).
const BASE_ENV_CONTENT =
  'LM_STUDIO_ENDPOINT=http://localhost:1234/v1\n' +
  'OLLAMA_ENDPOINT=http://localhost:11434/api\n' +
  'LOCAL_LLAMA_ENDPOINT=http://localhost:12345/api\n';

let tempRoot: string;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let configModule: any;

beforeAll(async () => {
  tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'locallama-startup-cfg-'));
  fs.writeFileSync(path.join(tempRoot, '.env'), BASE_ENV_CONTENT, 'utf8');
  process.env.LOCALLAMA_ROOT_DIR = tempRoot;
  // Delete env vars that could bleed into config at module init time
  delete process.env.STARTUP_BENCHMARK_TARGETS;
  delete process.env.BENCHMARK_FRESHNESS_HOURS;
  configModule = await importFreshConfigModule(`startup-cfg-${randomUUID()}`);
});

afterAll(() => {
  fs.rmSync(tempRoot, { recursive: true, force: true });
  restoreEnv('LOCALLAMA_ROOT_DIR', originalRootDir);
  restoreEnv('STARTUP_BENCHMARK_TARGETS', originalStartupTargets);
  restoreEnv('BENCHMARK_FRESHNESS_HOURS', originalFreshnessHours);
});

// Helper: write a .env with base content plus extra lines and trigger a reload.
function reloadWith(extraLines: string[]) {
  const content = BASE_ENV_CONTENT + extraLines.join('\n') + (extraLines.length ? '\n' : '');
  fs.writeFileSync(path.join(tempRoot, '.env'), content, 'utf8');
  // Align process.env with what we wrote so values not in .env are controlled
  delete process.env.STARTUP_BENCHMARK_TARGETS;
  delete process.env.BENCHMARK_FRESHNESS_HOURS;
  return configModule.reloadConfig() as { activeConfig: { startupBenchmarkTargets: string[]; benchmarkFreshnessHours: number } };
}

describe('startupBenchmarkTargets default', () => {
  it('defaults to [] when STARTUP_BENCHMARK_TARGETS is absent from .env', () => {
    const result = reloadWith([]);
    expect(result.activeConfig.startupBenchmarkTargets).toEqual([]);
  });

  it('defaults to [] regardless of OPENROUTER_API_KEY presence', () => {
    const result = reloadWith(['OPENROUTER_API_KEY=sk-or-test']);
    expect(result.activeConfig.startupBenchmarkTargets).toEqual([]);
  });

  it('honours STARTUP_BENCHMARK_TARGETS=local from .env', () => {
    const result = reloadWith(['STARTUP_BENCHMARK_TARGETS=local']);
    expect(result.activeConfig.startupBenchmarkTargets).toEqual(['local']);
  });

  it('honours STARTUP_BENCHMARK_TARGETS=none yielding []', () => {
    const result = reloadWith(['STARTUP_BENCHMARK_TARGETS=none']);
    expect(result.activeConfig.startupBenchmarkTargets).toEqual([]);
  });

  it('honours STARTUP_BENCHMARK_TARGETS=local,free', () => {
    const result = reloadWith(['STARTUP_BENCHMARK_TARGETS=local,free']);
    expect(result.activeConfig.startupBenchmarkTargets).toEqual(['local', 'free']);
  });
});

describe('benchmarkFreshnessHours config', () => {
  it('defaults to 24 when absent from .env', () => {
    const result = reloadWith([]);
    expect(result.activeConfig.benchmarkFreshnessHours).toBe(24);
  });

  it('reads BENCHMARK_FRESHNESS_HOURS=48 from .env', () => {
    const result = reloadWith(['BENCHMARK_FRESHNESS_HOURS=48']);
    expect(result.activeConfig.benchmarkFreshnessHours).toBe(48);
  });

  it('clamps BENCHMARK_FRESHNESS_HOURS=0 to minimum 1', () => {
    const result = reloadWith(['BENCHMARK_FRESHNESS_HOURS=0']);
    expect(result.activeConfig.benchmarkFreshnessHours).toBeGreaterThanOrEqual(1);
  });
});
