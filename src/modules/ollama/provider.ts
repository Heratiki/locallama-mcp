import { logger } from '../../utils/logger.js';
import { config } from '../../config/index.js';
import axios from 'axios';
import {
  LLMProvider,
  ProviderModel,
  TaskExecutionOptions,
  TaskExecutionResult,
} from '../core/provider/types.js';
import { localProviderLifecycle } from '../core/provider/local-runtime-lifecycle.js';
import { ollamaModule } from './index.js';
import { buildCodeTaskExecutionOptions } from '../core/prompting/execution-profile.js';

/**
 * Thin adapter that exposes the existing `ollamaModule` as an `LLMProvider`.
 */
class OllamaProvider implements LLMProvider {
  readonly id = 'ollama';
  readonly displayName = 'Ollama';
  readonly costClass = 'local' as const;
  readonly isLocal = true;

  private cachedModelIds = new Set<string>();
  private lastExecutedModelId: string | undefined;

  async init(): Promise<void> {
    await ollamaModule.initialize(true);
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
    options?: TaskExecutionOptions,
  ): Promise<TaskExecutionResult> {
    const id = modelId.startsWith('ollama:') ? modelId.substring('ollama:'.length) : modelId;
    await localProviderLifecycle.beforeExecution(this, id);
    const executionOptions = {
      ...buildCodeTaskExecutionOptions(task, 'ollama'),
      ...options,
    };
    const content = await ollamaModule.executeTask(id, task, executionOptions);
    this.lastExecutedModelId = id;
    return { content, model: id };
  }

  async releaseResources(options?: { reason?: 'cross-provider-handoff' | 'shutdown' | 'manual'; modelId?: string }): Promise<void> {
    const modelId = options?.modelId ?? this.lastExecutedModelId;
    if (!modelId) {
      return;
    }

    try {
      await ollamaModule.unloadModel(modelId);
    } catch (error) {
      logger.warn(
        `Failed to unload Ollama model ${modelId} during ${options?.reason ?? 'manual'}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  getCost(_modelId: string): { prompt: number; completion: number } {
    return { prompt: 0, completion: 0 };
  }

  async getVersion(): Promise<string | null> {
    if (!config.ollamaEndpoint) return null;
    try {
      const response = await axios.get<{ version: string }>(`${config.ollamaEndpoint}/version`, {
        timeout: 5000,
        headers: { Accept: 'application/json' }
      });
      return response.data?.version || null;
    } catch (error) {
      logger.debug(`Failed to fetch Ollama version: ${error instanceof Error ? error.message : String(error)}`);
      return null;
    }
  }
}

export const ollamaProvider: LLMProvider = new OllamaProvider();
