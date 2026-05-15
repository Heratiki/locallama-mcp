import { logger } from '../../utils/logger.js';
import { config } from '../../config/index.js';
import {
  LLMProvider,
  ProviderModel,
  TaskExecutionOptions,
  TaskExecutionResult,
} from '../core/provider/types.js';
import { lmStudioModule } from './index.js';

/**
 * Thin adapter that exposes the existing `lmStudioModule` as an `LLMProvider`.
 * The underlying HTTP/API code is unchanged; this is the surface routing and
 * benchmarking layers will use.
 */
class LMStudioProvider implements LLMProvider {
  readonly id = 'lm-studio';
  readonly displayName = 'LM Studio';
  readonly costClass = 'local' as const;
  readonly isLocal = true;

  private cachedModelIds = new Set<string>();

  async init(): Promise<void> {
    await lmStudioModule.initialize();
    try {
      const models = await this.listModels();
      this.cachedModelIds = new Set(models.map((m) => m.id));
    } catch (error) {
      logger.debug(
        `LM Studio model cache warm-up failed: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  async isAvailable(): Promise<boolean> {
    if (!config.lmStudioEndpoint) return false;
    try {
      const models = await lmStudioModule.getAvailableModels();
      return models.length > 0;
    } catch {
      return false;
    }
  }

  async listModels(): Promise<ProviderModel[]> {
    const models = await lmStudioModule.getAvailableModels();
    return models.map((m) => ({
      id: m.id,
      displayName: m.name,
      contextWindow: m.contextWindow,
      costPerToken: m.costPerToken,
    }));
  }

  supportsModel(modelId: string): boolean {
    if (this.cachedModelIds.has(modelId)) return true;
    return modelId.startsWith('lm-studio:');
  }

  async executeTask(
    modelId: string,
    task: string,
    _options?: TaskExecutionOptions,
  ): Promise<TaskExecutionResult> {
    const id = modelId.startsWith('lm-studio:') ? modelId.substring('lm-studio:'.length) : modelId;
    const content = await lmStudioModule.executeTask(id, task);
    return { content, model: id };
  }

  getCost(_modelId: string): { prompt: number; completion: number } {
    return { prompt: 0, completion: 0 };
  }
}

export const lmStudioProvider: LLMProvider = new LMStudioProvider();
