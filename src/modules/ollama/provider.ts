import { logger } from '../../utils/logger.js';
import { config } from '../../config/index.js';
import {
  LLMProvider,
  ProviderModel,
  TaskExecutionOptions,
  TaskExecutionResult,
} from '../core/provider/types.js';
import { ollamaModule } from './index.js';

/**
 * Thin adapter that exposes the existing `ollamaModule` as an `LLMProvider`.
 */
class OllamaProvider implements LLMProvider {
  readonly id = 'ollama';
  readonly displayName = 'Ollama';
  readonly costClass = 'local' as const;
  readonly isLocal = true;

  private cachedModelIds = new Set<string>();

  async init(): Promise<void> {
    await ollamaModule.initialize();
    try {
      const models = await this.listModels();
      this.cachedModelIds = new Set(models.map((m) => m.id));
    } catch (error) {
      logger.debug(
        `Ollama model cache warm-up failed: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  async isAvailable(): Promise<boolean> {
    if (!config.ollamaEndpoint) return false;
    try {
      const models = await ollamaModule.getAvailableModels();
      return models.length > 0;
    } catch {
      return false;
    }
  }

  async listModels(): Promise<ProviderModel[]> {
    const models = await ollamaModule.getAvailableModels();
    return models.map((m) => ({
      id: m.id,
      displayName: m.name,
      contextWindow: m.contextWindow,
      costPerToken: m.costPerToken,
    }));
  }

  supportsModel(modelId: string): boolean {
    if (this.cachedModelIds.has(modelId)) return true;
    return modelId.startsWith('ollama:');
  }

  async executeTask(
    modelId: string,
    task: string,
    _options?: TaskExecutionOptions,
  ): Promise<TaskExecutionResult> {
    const id = modelId.startsWith('ollama:') ? modelId.substring('ollama:'.length) : modelId;
    const content = await ollamaModule.executeTask(id, task);
    return { content, model: id };
  }

  getCost(_modelId: string): { prompt: number; completion: number } {
    return { prompt: 0, completion: 0 };
  }
}

export const ollamaProvider: LLMProvider = new OllamaProvider();
