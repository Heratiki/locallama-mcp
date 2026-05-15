import { describe, expect, it, jest, beforeEach } from '@jest/globals';
import os from 'os';
import path from 'path';
import fs from 'fs/promises';

jest.unstable_mockModule('../../../../dist/utils/logger.js', () => ({
  logger: {
    error: jest.fn(),
    warn: jest.fn(),
    info: jest.fn(),
    debug: jest.fn(),
  },
}));

const modelModule = await import('../../../../dist/modules/core/model/index.js');
const {
  ModelRegistry,
  getModelRegistry,
  _setModelRegistryForTests,
} = modelModule;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function fakeProvider(id: string, costClass: 'local' | 'free' | 'paid' = 'local') {
  return {
    id,
    displayName: id,
    costClass,
    isLocal: costClass === 'local',
    init: jest.fn(() => Promise.resolve()),
    isAvailable: jest.fn(() => Promise.resolve(true)),
    listModels: jest.fn(() => Promise.resolve([])),
    supportsModel: jest.fn(() => false),
    executeTask: jest.fn(() => Promise.resolve({ content: '', model: id })),
    getCost: jest.fn(() => ({ prompt: 0, completion: 0 })),
  };
}

function fakeProviderModel(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    displayName: id,
    family: 'llama',
    contextWindow: 8192,
    costPerToken: { prompt: 0, completion: 0 },
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ModelRegistry', () => {
  let registry: InstanceType<typeof ModelRegistry>;

  beforeEach(() => {
    registry = new ModelRegistry();
    _setModelRegistryForTests(registry);
  });

  describe('seedFromProvider', () => {
    it('registers models from a provider', () => {
      const provider = fakeProvider('lm-studio');
      const models = [fakeProviderModel('model-a'), fakeProviderModel('model-b')];
      registry.seedFromProvider(provider, models);

      expect(registry.getModel('model-a')).toBeDefined();
      expect(registry.getModel('model-a')?.providerId).toBe('lm-studio');
      expect(registry.getModel('model-b')).toBeDefined();
      expect(registry.listAll()).toHaveLength(2);
    });

    it('preserves benchmark data on re-seed', () => {
      const provider = fakeProvider('ollama');
      registry.seedFromProvider(provider, [fakeProviderModel('my-model')]);

      const summary = {
        lastRunAt: Date.now(),
        taskCategories: ['code'],
        scores: { code: 0.85 },
        successRate: 0.9,
      };
      registry.updateBenchmarkSummary('my-model', summary);

      // Re-seed (e.g. provider restarted)
      registry.seedFromProvider(provider, [fakeProviderModel('my-model')]);
      const model = registry.getModel('my-model');
      expect(model?.benchmarkSummary?.scores.code).toBe(0.85);
    });

    it('infers code capability from model id', () => {
      const provider = fakeProvider('lm-studio');
      registry.seedFromProvider(provider, [fakeProviderModel('qwen2.5-coder-7b')]);
      expect(registry.getModel('qwen2.5-coder-7b')?.capabilities.code).toBe(true);
    });

    it('infers largeContext for contextWindow >= 32768', () => {
      const provider = fakeProvider('ollama');
      registry.seedFromProvider(provider, [
        fakeProviderModel('big-model', { contextWindow: 32768 }),
        fakeProviderModel('small-model', { contextWindow: 4096 }),
      ]);
      expect(registry.getModel('big-model')?.capabilities.largeContext).toBe(true);
      expect(registry.getModel('small-model')?.capabilities.largeContext).toBe(false);
    });

    it('listByProvider returns only models for that provider', () => {
      const p1 = fakeProvider('lm-studio');
      const p2 = fakeProvider('ollama');
      registry.seedFromProvider(p1, [fakeProviderModel('model-a')]);
      registry.seedFromProvider(p2, [fakeProviderModel('model-b')]);

      expect(registry.listByProvider('lm-studio')).toHaveLength(1);
      expect(registry.listByProvider('ollama')).toHaveLength(1);
      expect(registry.listByProvider('openrouter')).toHaveLength(0);
    });
  });

  describe('loadFromConfigFile (JSON overrides)', () => {
    it('applies overrides from a JSON file', async () => {
      const provider = fakeProvider('lm-studio');
      registry.seedFromProvider(provider, [fakeProviderModel('my-model')]);

      const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'locallama-test-'));
      const configPath = path.join(tmpDir, 'models.json');
      await fs.writeFile(
        configPath,
        JSON.stringify({
          models: [{ id: 'my-model', promptingStrategyId: 'custom-v1', parameters: 7 }],
        }),
      );

      await registry.loadFromConfigFile(configPath);

      const model = registry.getModel('my-model');
      expect(model?.promptingStrategyId).toBe('custom-v1');
      expect(model?.parameters).toBe(7);

      await fs.rm(tmpDir, { recursive: true });
    });

    it('is a no-op when the file does not exist', async () => {
      const provider = fakeProvider('lm-studio');
      registry.seedFromProvider(provider, [fakeProviderModel('model-a')]);
      await expect(
        registry.loadFromConfigFile('/nonexistent/path/models.json'),
      ).resolves.not.toThrow();
      expect(registry.getModel('model-a')).toBeDefined();
    });

    it('applies overrides retroactively to models seeded after loadFromConfigFile', async () => {
      const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'locallama-test-'));
      const configPath = path.join(tmpDir, 'models.json');
      await fs.writeFile(
        configPath,
        JSON.stringify({ models: [{ id: 'late-model', parameters: 13 }] }),
      );

      // Load overrides first
      await registry.loadFromConfigFile(configPath);

      // Then seed (simulates provider listing arriving after config load)
      const provider = fakeProvider('ollama');
      registry.seedFromProvider(provider, [fakeProviderModel('late-model')]);

      expect(registry.getModel('late-model')?.parameters).toBe(13);

      await fs.rm(tmpDir, { recursive: true });
    });
  });

  describe('updateBenchmarkSummary', () => {
    it('stores the summary and propagates scores to capabilities', () => {
      const provider = fakeProvider('lm-studio');
      registry.seedFromProvider(provider, [fakeProviderModel('my-model')]);

      const summary = {
        lastRunAt: Date.now(),
        taskCategories: ['code'],
        scores: { code: 0.72, reasoning: 0.65 },
        successRate: 0.88,
        qualityScore: 0.75,
        avgResponseTime: 1200,
      };
      registry.updateBenchmarkSummary('my-model', summary);

      const model = registry.getModel('my-model');
      expect(model?.benchmarkSummary?.scores.code).toBe(0.72);
      expect(model?.capabilities.scores?.code).toBe(0.72);
      expect(model?.capabilities.scores?.reasoning).toBe(0.65);
    });

    it('warns and does nothing for an unknown model', () => {
      // Should not throw
      expect(() =>
        registry.updateBenchmarkSummary('ghost-model', {
          lastRunAt: Date.now(),
          taskCategories: [],
          scores: {},
        }),
      ).not.toThrow();
    });
  });

  describe('pruneStale', () => {
    it('removes models older than the cutoff', () => {
      const provider = fakeProvider('lm-studio');
      const old = { ...fakeProviderModel('old-model'), contextWindow: 4096 };
      const fresh = { ...fakeProviderModel('new-model'), contextWindow: 4096 };

      registry.seedFromProvider(provider, [old, fresh]);

      const cutoff = Date.now() + 1; // 1ms in the future → everything is "stale"
      // Override lastSeen so old is before cutoff and fresh is after
      const oldMeta = registry.getModel('old-model')!;
      const freshMeta = registry.getModel('new-model')!;
      registry.registerModel({ ...oldMeta, lastSeen: cutoff - 1000 });
      registry.registerModel({ ...freshMeta, lastSeen: cutoff + 1000 });

      const pruned = registry.pruneStale(cutoff);
      expect(pruned).toBe(1);
      expect(registry.getModel('old-model')).toBeUndefined();
      expect(registry.getModel('new-model')).toBeDefined();
    });

    it('returns 0 when nothing is stale', () => {
      const provider = fakeProvider('lm-studio');
      registry.seedFromProvider(provider, [fakeProviderModel('model-a')]);
      // cutoff is in the past — nothing should be pruned
      const pruned = registry.pruneStale(0);
      expect(pruned).toBe(0);
    });
  });

  describe('singleton (getModelRegistry)', () => {
    it('returns the same instance on repeated calls', () => {
      const r1 = getModelRegistry();
      const r2 = getModelRegistry();
      expect(r1).toBe(r2);
    });

    it('can be replaced for tests via _setModelRegistryForTests', () => {
      const fresh = new ModelRegistry();
      _setModelRegistryForTests(fresh);
      expect(getModelRegistry()).toBe(fresh);
    });
  });
});
