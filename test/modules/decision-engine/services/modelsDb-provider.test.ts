import { describe, expect, it, jest } from '@jest/globals';
import fs from 'fs/promises';
import path from 'path';

/**
 * Issue #150 (fix round): modelsDb.loadBenchmarkData derived a record's
 * `provider` by splitting the model id (`modelId.split('-')[0]`), which
 * returns the WHOLE id for ollama-style ids without a dash (`llama3.2:3b`).
 * Those records are persisted, seeded into the ModelRegistry as stubs with
 * `providerId === model id`, and later surface as Model objects whose
 * provider is the model id — a provider no registry can execute.
 *
 * The provider of an imported record must come from the provider that
 * reported the model (the ModelRegistry), else 'unknown' — never the model id.
 */

const tmpRoot = '/tmp/opencode/issue-150-modelsdb';
const dbDir = path.join(tmpRoot, 'db');
const benchmarkDir = path.join(tmpRoot, 'benchmark');

// The service singleton resolves its DB location at construction time, so
// DB_DIR must be set before the module under test is imported.
process.env.DB_DIR = dbDir;

jest.unstable_mockModule('../../../../dist/utils/logger.js', () => ({
  logger: {
    debug: jest.fn(),
    error: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
  },
}));

jest.unstable_mockModule('../../../../dist/config/index.js', () => ({
  config: {
    cacheDir: dbDir,
    benchmark: { resultsPath: benchmarkDir },
  },
}));

const { getModelRegistry } = await import('../../../../dist/modules/core/model/index.js');
const { modelsDbService } = await import('../../../../dist/modules/decision-engine/services/modelsDb.js');

/** Register a model exactly the way provider seeding does (src/index.ts:719). */
function registerReportedModel(modelId: string, providerId: string): void {
  getModelRegistry().registerModel({
    id: modelId,
    providerId,
    displayName: modelId,
    contextWindow: 8192,
    capabilities: {
      chat: true,
      code: true,
      vision: false,
      toolUse: false,
      largeContext: false,
      maxContextTokens: 8192,
    },
    cost: { prompt: 0, completion: 0 },
    promptingStrategyId: 'default',
    lastSeen: Date.now(),
  });
}

async function writeComprehensiveResults(models: Record<string, unknown>): Promise<void> {
  await fs.mkdir(benchmarkDir, { recursive: true });
  const file = path.join(benchmarkDir, 'comprehensive-results-2026-11-01T00-00-00.000Z.json');
  await fs.writeFile(
    file,
    JSON.stringify(
      {
        timestamp: '2026-11-01T00:00:00.000Z',
        models,
        summary: { totalModels: Object.keys(models).length, averageSuccessRate: 0.8, averageQualityScore: 0.7 },
      },
      null,
      2,
    ),
  );
}

describe('modelsDb provider assignment for imported benchmark models (issue #150)', () => {
  it('never derives a record provider from the model id', async () => {
    await fs.rm(tmpRoot, { recursive: true, force: true });

    // Real startup order: providers seed the ModelRegistry before
    // modelsDbService.initialize() runs, so 'llama3.2:3b' is already
    // reported by 'ollama' when the import happens.
    registerReportedModel('llama3.2:3b', 'ollama');

    await writeComprehensiveResults({
      // Dashless ollama-style id: split('-')[0] would return the whole id.
      'llama3.2:3b': { successRate: 0.9, qualityScore: 0.8, avgResponseTime: 1200, benchmarkCount: 3, complexityScore: 0.3 },
      // No provider reported this one — must fall back to 'unknown'.
      'tinyllama:latest': { successRate: 0.7, qualityScore: 0.6, avgResponseTime: 900, benchmarkCount: 2, complexityScore: 0.2 },
    });

    await modelsDbService.initialize();

    const models = modelsDbService.getDatabase().models;

    expect(models['llama3.2:3b']).toBeTruthy();
    expect(models['llama3.2:3b']!.provider).toBe('ollama');
    expect(models['tinyllama:latest']).toBeTruthy();
    expect(models['tinyllama:latest']!.provider).toBe('unknown');

    // Invariant: never the model id, for any record.
    for (const [id, record] of Object.entries(models)) {
      expect(`${id} -> ${record.provider}`).not.toBe(`${id} -> ${id}`);
    }
  });
});
