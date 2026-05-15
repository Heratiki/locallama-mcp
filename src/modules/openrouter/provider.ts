import { logger } from '../../utils/logger.js';
import { config } from '../../config/index.js';
import {
  LLMProvider,
  ProviderModel,
  TaskExecutionOptions,
  TaskExecutionResult,
} from '../core/provider/types.js';
import { openRouterModule } from './index.js';

/**
 * Thin adapter that exposes the existing `openRouterModule` as an `LLMProvider`.
 *
 * The provider's `costClass` is `'paid'` even though OpenRouter hosts both
 * free and paid models; per-model cost is reported by `getCost(modelId)` and
 * the `costClass` distinction at the response level is handled in PLAN.md §7.
 */
class OpenRouterProvider implements LLMProvider {
  readonly id = 'openrouter';
  readonly displayName = 'OpenRouter';
  readonly costClass = 'paid' as const;
  readonly isLocal = false;

  private cachedCosts = new Map<string, { prompt: number; completion: number }>();
  private cachedModelIds = new Set<string>();

  async init(): Promise<void> {
    await openRouterModule.initialize();
    try {
      const models = await this.listModels();
      this.cachedModelIds = new Set(models.map((m) => m.id));
      for (const m of models) {
        if (m.costPerToken) this.cachedCosts.set(m.id, m.costPerToken);
      }
    } catch (error) {
      logger.debug(
        `OpenRouter model cache warm-up failed: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  async isAvailable(): Promise<boolean> {
    if (!config.openRouterApiKey) return false;
    try {
      const models = await openRouterModule.getAvailableModels();
      return models.length > 0;
    } catch {
      return false;
    }
  }

  async listModels(): Promise<ProviderModel[]> {
    const models = await openRouterModule.getAvailableModels();
    return models.map((m) => ({
      id: m.id,
      displayName: m.name,
      contextWindow: m.contextWindow,
      costPerToken: m.costPerToken,
    }));
  }

  supportsModel(modelId: string): boolean {
    if (this.cachedModelIds.has(modelId)) return true;
    return modelId.startsWith('openrouter:');
  }

  async executeTask(
    modelId: string,
    task: string,
    _options?: TaskExecutionOptions,
  ): Promise<TaskExecutionResult> {
    const id = modelId.startsWith('openrouter:')
      ? modelId.substring('openrouter:'.length)
      : modelId;
    const content = await openRouterModule.executeTask(id, task);
    return { content, model: id };
  }

  getCost(modelId: string): { prompt: number; completion: number } {
    return this.cachedCosts.get(modelId) ?? { prompt: 0, completion: 0 };
  }
}

export const openRouterProvider: LLMProvider = new OpenRouterProvider();
