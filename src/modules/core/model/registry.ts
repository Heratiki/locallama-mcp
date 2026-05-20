import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { logger } from '../../../utils/logger.js';
import type { LLMProvider, ProviderModel } from '../provider/types.js';
import { CapabilityDetector } from '../capability-detector.js';
import type { PromptingStrategyService } from '../prompting/service.js';
import type {
  ModelMetadata,
  BenchmarkSummary,
  ModelOverride,
} from './types.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Default models.json lives in src/config/ (adjacent to prompting-strategies.json).
// At runtime this resolves relative to dist/modules/core/model/registry.js.
const DEFAULT_MODELS_JSON = path.resolve(
  __dirname,
  '../../../../config/models.json',
);

// ---------------------------------------------------------------------------
// Heuristic capability inference delegated to CapabilityDetector (Section 5).
// ---------------------------------------------------------------------------

function toMetadata(
  model: ProviderModel,
  provider: LLMProvider,
  promptingService?: PromptingStrategyService,
): ModelMetadata {
  const promptingStrategyId = promptingService
    ? promptingService.resolveStrategyId(model.id, model.family, provider.id)
    : 'default';
  return {
    id: model.id,
    providerId: provider.id,
    displayName: model.displayName ?? model.id,
    family: model.family,
    contextWindow: model.contextWindow ?? 4096,
    capabilities: CapabilityDetector.inferFromProviderModel(model),
    cost: model.costPerToken ?? provider.getCost(model.id),
    promptingStrategyId,
    lastSeen: Date.now(),
  };
}

// ---------------------------------------------------------------------------
// ModelRegistry
// ---------------------------------------------------------------------------

/**
 * Single authority for model metadata.
 *
 * Sources (applied in priority order):
 *  1. `models.json` override file
 *  2. Provider-declared (from `LLMProvider.listModels()`)
 *  3. Benchmark-derived (from `updateBenchmarkSummary()`)
 */
export class ModelRegistry {
  private models = new Map<string, ModelMetadata>();
  private overrides: ModelOverride[] = [];
  private promptingService: PromptingStrategyService | undefined;

  /**
   * Inject the PromptingStrategyService so that strategy ids are resolved from
   * the central JSON during model registration (Section 4 of PLAN.md).
   * Must be called before `seedFromProvider()` or `registerModel()`.
   */
  setPromptingService(svc: PromptingStrategyService): void {
    this.promptingService = svc;
  }

  // ---------------------------------------------------------------------------
  // Seeding from providers
  // ---------------------------------------------------------------------------

  /**
   * Register all models returned by a provider's `listModels()` call.
   * Merges into any existing entry (benchmark data is preserved).
   */
  seedFromProvider(provider: LLMProvider, providerModels: ProviderModel[]): void {
    for (const pm of providerModels) {
      const incoming = toMetadata(pm, provider, this.promptingService);
      const existing = this.models.get(pm.id);
      if (existing) {
        this.models.set(pm.id, {
          ...existing,
          ...incoming,
          // preserve empirical data that the new listing won't have
          benchmarkSummary: existing.benchmarkSummary,
          capabilities: {
            ...incoming.capabilities,
            scores: existing.capabilities.scores,
          },
        });
      } else {
        this.models.set(pm.id, incoming);
      }
      this.applyOverride(pm.id);
    }
  }

  // ---------------------------------------------------------------------------
  // Config-file overrides
  // ---------------------------------------------------------------------------

  /**
   * Load a JSON override file and merge each entry into any already-registered
   * model. If the file doesn't exist the call is a no-op (not an error).
   */
  async loadFromConfigFile(configPath?: string): Promise<void> {
    const filePath = configPath ?? DEFAULT_MODELS_JSON;
    try {
      const raw = await fs.readFile(filePath, 'utf-8');
      const parsed = JSON.parse(raw) as { models?: ModelOverride[] };
      this.overrides = Array.isArray(parsed.models) ? parsed.models : [];
      // Re-apply to models that are already registered
      for (const override of this.overrides) {
        this.applyOverride(override.id);
      }
      logger.debug(
        `ModelRegistry: loaded ${this.overrides.length} override(s) from ${filePath}`,
      );
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        logger.debug(
          `ModelRegistry: no models.json at ${filePath} — skipping overrides`,
        );
      } else {
        logger.warn(`ModelRegistry: failed to parse models.json: ${String(err)}`);
      }
    }
  }

  private applyOverride(modelId: string): void {
    const override = this.overrides.find((o) => o.id === modelId);
    if (!override) return;
    const existing = this.models.get(modelId);
    if (!existing) return;
    const { id: _id, ...rest } = override;
    this.models.set(modelId, { ...existing, ...rest });
  }

  // ---------------------------------------------------------------------------
  // Direct registration (used by legacy modelsDb bridge)
  // ---------------------------------------------------------------------------

  registerModel(metadata: ModelMetadata): void {
    this.models.set(metadata.id, metadata);
    this.applyOverride(metadata.id);
  }

  // ---------------------------------------------------------------------------
  // Reads
  // ---------------------------------------------------------------------------

  getModel(modelId: string): ModelMetadata | undefined {
    return this.models.get(modelId);
  }

  listAll(): ModelMetadata[] {
    return Array.from(this.models.values());
  }

  listByProvider(providerId: string): ModelMetadata[] {
    return this.listAll().filter((m) => m.providerId === providerId);
  }

  // ---------------------------------------------------------------------------
  // Benchmark feedback
  // ---------------------------------------------------------------------------

  /**
   * Update a model's benchmark summary and propagate scores into capability
   * flags. Called by the benchmark pipeline after a run completes.
   */
  updateBenchmarkSummary(modelId: string, summary: BenchmarkSummary): void {
    const existing = this.models.get(modelId);
    if (!existing) {
      logger.warn(`ModelRegistry.updateBenchmarkSummary: unknown model '${modelId}'`);
      return;
    }
    const updatedScores = {
      ...existing.capabilities.scores,
      ...summary.scores,
    };
    this.models.set(modelId, {
      ...existing,
      benchmarkSummary: summary,
      capabilities: {
        ...existing.capabilities,
        scores: updatedScores,
      },
    });
  }

  // ---------------------------------------------------------------------------
  // Staleness pruning
  // ---------------------------------------------------------------------------

  /**
   * Remove models whose `lastSeen` is older than `beforeMs` (unix ms).
   * Returns the count of pruned models.
   */
  pruneStale(beforeMs: number): number {
    let count = 0;
    for (const [id, model] of this.models) {
      if (model.lastSeen !== undefined && model.lastSeen < beforeMs) {
        this.models.delete(id);
        count++;
      }
    }
    if (count > 0) {
      logger.info(`ModelRegistry: pruned ${count} stale model(s)`);
    }
    return count;
  }

  // ---------------------------------------------------------------------------
  // Test helpers
  // ---------------------------------------------------------------------------

  /** Test-only: reset all state. Never call from production code. */
  clear(): void {
    this.models.clear();
    this.overrides = [];
  }
}

// ---------------------------------------------------------------------------
// Singleton
// ---------------------------------------------------------------------------

let singleton: ModelRegistry | undefined;

export function getModelRegistry(): ModelRegistry {
  if (!singleton) {
    singleton = new ModelRegistry();
  }
  return singleton;
}

/**
 * Test-only: replace the singleton (e.g. with a fresh instance per test).
 * Production code must never call this.
 */
export function _setModelRegistryForTests(
  registry: ModelRegistry | undefined,
): void {
  singleton = registry;
}
