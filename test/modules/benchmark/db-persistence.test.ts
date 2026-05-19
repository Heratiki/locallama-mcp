import fs from 'fs';
import os from 'os';
import path from 'path';
import { pathToFileURL } from 'url';
import { afterAll, beforeAll, describe, expect, it, jest } from '@jest/globals';

const originalCwd = process.cwd();
const originalBenchmarkDbPath = process.env.BENCHMARK_DB_PATH;

// Mock logger to avoid writing log files during the test
jest.unstable_mockModule('../../../dist/utils/logger.js', () => ({
  logger: {
    error: jest.fn(),
    warn: jest.fn(),
    info: jest.fn(),
    debug: jest.fn(),
  },
}));

function importFreshModule(modulePath: string, cacheKey: string) {
  const moduleUrl = new URL(`${pathToFileURL(modulePath).href}?${cacheKey}`);
  return import(moduleUrl.href);
}

let tempDbDir: string;
// Hold references so afterAll can close the connections and prevent EBUSY on Windows
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let dbModule1: any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let dbModule2: any;

beforeAll(async () => {
  tempDbDir = fs.mkdtempSync(path.join(os.tmpdir(), 'locallama-db-'));
  // Set env var BEFORE imports so each fresh module reads the correct DB path
  process.env.BENCHMARK_DB_PATH = path.join(tempDbDir, 'test-benchmark.db');

  const ts = Date.now();
  dbModule1 = await importFreshModule(
    path.resolve(originalCwd, 'dist/modules/benchmark/storage/benchmarkDb.js'),
    `db-write=${ts}`
  );
  dbModule2 = await importFreshModule(
    path.resolve(originalCwd, 'dist/modules/benchmark/storage/benchmarkDb.js'),
    `db-read=${ts + 1}`
  );
});

afterAll(async () => {
  // Close both SQLite connections to release file locks (important on Windows)
  try {
    const db1 = await dbModule1?.initBenchmarkDb();
    if (db1) await db1.close();
  } catch { /* ignore */ }
  try {
    const db2 = await dbModule2?.initBenchmarkDb();
    if (db2) await db2.close();
  } catch { /* ignore */ }

  fs.rmSync(tempDbDir, { recursive: true, force: true });

  if (originalBenchmarkDbPath === undefined) {
    delete process.env.BENCHMARK_DB_PATH;
  } else {
    process.env.BENCHMARK_DB_PATH = originalBenchmarkDbPath;
  }
});

describe('benchmark DB persistence across restarts', () => {
  it('retains saved results after the DB module is re-imported (simulated restart)', async () => {
    const timestamp = new Date().toISOString();

    // Minimal valid BenchmarkResult — paid.model is empty so the paid row is skipped
    const result = {
      taskId: 'persist-test-task',
      task: 'Test persistence task',
      contextLength: 100,
      outputLength: 50,
      complexity: 0.5,
      timestamp,
      local: {
        model: 'persist-local-model',
        timeTaken: 1000,
        successRate: 1.0,
        qualityScore: 0.9,
        tokenUsage: { prompt: 10, completion: 20, total: 30 },
        output: 'test output',
      },
      paid: {
        model: '',
        timeTaken: 0,
        successRate: 0,
        qualityScore: 0,
        tokenUsage: { prompt: 0, completion: 0, total: 0 },
        cost: 0,
      },
    };

    // --- First "instance": write the result ---
    await dbModule1.saveBenchmarkResult(result);

    // --- Second "instance" (fresh module = simulated restart): query the result ---
    const stats = await dbModule2.getRecentModelResults('persist-local-model', 30);

    expect(stats).not.toBeNull();
    expect(stats!.benchmarkCount).toBeGreaterThanOrEqual(1);
    expect(stats!.avgSuccessRate).toBeCloseTo(1.0, 5);
    expect(stats!.avgQualityScore).toBeCloseTo(0.9, 5);
  });
});
