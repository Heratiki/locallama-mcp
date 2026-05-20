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
import { lmStudioModule } from './index.js';
import { buildCodeTaskExecutionOptions } from '../core/prompting/execution-profile.js';

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
  private lastExecutedModelId: string | undefined;

  async init(): Promise<void> {
    // Match Ollama behavior: refresh provider models on startup so routing and
    // execution use the same live model inventory.
    await lmStudioModule.initialize(true);
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

    if (modelId.startsWith('lm-studio:')) {
      const rawId = modelId.substring('lm-studio:'.length);
      return this.cachedModelIds.has(rawId);
    }

    return this.cachedModelIds.has(`lm-studio:${modelId}`);
  }

  async executeTask(
    modelId: string,
    task: string,
    options?: TaskExecutionOptions,
  ): Promise<TaskExecutionResult> {
    const id = modelId.startsWith('lm-studio:') ? modelId.substring('lm-studio:'.length) : modelId;
    await localProviderLifecycle.beforeExecution(this, id);
    const executionOptions = {
      ...buildCodeTaskExecutionOptions(task, 'lm-studio'),
      ...options,
    };
    const content = await lmStudioModule.executeTask(id, task, { ...executionOptions, timeoutMs: options?.timeoutMs });
    this.lastExecutedModelId = id;
    return { content, model: id };
  }

  async releaseResources(options?: { reason?: 'cross-provider-handoff' | 'same-provider-model-switch' | 'shutdown' | 'manual'; modelId?: string }): Promise<void> {
    const modelId = options?.modelId ?? this.lastExecutedModelId;
    if (!modelId) {
      return;
    }

    try {
      await lmStudioModule.unloadModel(modelId);
    } catch (error) {
      logger.warn(
        `Failed to unload LM Studio model ${modelId} during ${options?.reason ?? 'manual'}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  getCost(_modelId: string): { prompt: number; completion: number } {
    return { prompt: 0, completion: 0 };
  }

  async getVersion(): Promise<string | null> {
    if (!config.lmStudioEndpoint) return null;
    try {
      const response = await axios.get(`${config.lmStudioEndpoint}/models`, {
        timeout: 5000,
        headers: { Accept: 'application/json' }
      });
      const headers = response.headers;
      const versionHeader = 
        headers['x-lmstudio-version'] || 
        headers['x-version'] || 
        headers['server'];
      
      if (!versionHeader) return null;
      return String(versionHeader);
    } catch (error) {
      logger.debug(`Failed to fetch LM Studio version: ${error instanceof Error ? error.message : String(error)}`);
      return null;
    }
  }
}

export const lmStudioProvider: LLMProvider = new LMStudioProvider();
