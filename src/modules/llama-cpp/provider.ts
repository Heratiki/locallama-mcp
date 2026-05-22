/**
 * LLMProvider adapter for llama.cpp (llama-server).
 *
 * Wraps llamaCppModule as the LLMProvider interface consumed by the
 * ProviderRegistry, routing layer, and benchmark engine.
 */

import { logger } from '../../utils/logger.js';
import { config } from '../../config/index.js';
import {
  LLMProvider,
  ProviderModel,
  TaskExecutionOptions,
  TaskExecutionResult,
} from '../core/provider/types.js';
import { localProviderLifecycle } from '../core/provider/local-runtime-lifecycle.js';
import { llamaCppModule } from './index.js';
import { buildCodeTaskExecutionOptions } from '../core/prompting/execution-profile.js';

class LlamaCppProvider implements LLMProvider {
  readonly id = 'llama-cpp';
  readonly displayName = 'llama.cpp';
  readonly costClass = 'local' as const;
  readonly isLocal = true;

  private cachedModelIds = new Set<string>();
  private lastExecutedModelId: string | undefined;

  async init(): Promise<void> {
    try {
      await llamaCppModule.initialize();
      const models = await this.listModels();
      this.cachedModelIds = new Set(models.map((m) => m.id));
      logger.debug(
        `llama.cpp provider initialized: mode=${llamaCppModule.capabilities.mode}, models=[${[...this.cachedModelIds].join(', ')}]`,
      );
    } catch (error) {
      logger.debug(
        `llama.cpp provider init failed: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  async isAvailable(): Promise<boolean> {
    if (!config.llamaCppEndpoint) return false;
    // A provider with no models is not available. A provider that fails the
    // health probe is not available.
    return llamaCppModule.capabilities.health === 'healthy' && llamaCppModule.capabilities.modelCount > 0;
  }

  async listModels(): Promise<ProviderModel[]> {
    const models = await llamaCppModule.getAvailableModels();
    return models.map((m) => ({
      id: m.id,
      displayName: m.name,
      contextWindow: m.contextWindow,
      costPerToken: m.costPerToken,
    }));
  }

  supportsModel(modelId: string): boolean {
    if (this.cachedModelIds.has(modelId)) return true;
    if (modelId.startsWith('llama-cpp:')) {
      const rawId = modelId.substring('llama-cpp:'.length);
      return this.cachedModelIds.has(rawId) || this.cachedModelIds.has(`llama-cpp:${rawId}`);
    }
    return false;
  }

  async executeTask(
    modelId: string,
    task: string,
    options?: TaskExecutionOptions,
  ): Promise<TaskExecutionResult> {
    const id = modelId.startsWith('llama-cpp:') ? modelId.substring('llama-cpp:'.length) : modelId;
    await localProviderLifecycle.beforeExecution(this, id);
    const executionOptions = {
      ...buildCodeTaskExecutionOptions(task, 'llama-cpp'),
      ...options,
    };
    const content = await llamaCppModule.executeTask(id, task, executionOptions);
    this.lastExecutedModelId = id;
    return { content, model: id };
  }

  /**
   * releaseResources — mode-aware documented no-op for Phase 1.
   *
   * single-model mode: cannot unload without restarting llama-server.
   * router mode: no stable public unload API exists as of llama.cpp b3xxx.
   *
   * When a verified unload API is available, call llamaCppModule.releaseResources()
   * with the modelId and implement the HTTP call in the module layer.
   */
  async releaseResources(options?: {
    reason?: 'cross-provider-handoff' | 'same-provider-model-switch' | 'shutdown' | 'manual';
    modelId?: string;
  }): Promise<void> {
    const modelId = options?.modelId ?? this.lastExecutedModelId;
    const mode = llamaCppModule.capabilities.mode;
    logger.debug(
      `llama.cpp releaseResources: mode=${mode}, modelId=${modelId ?? 'none'}, reason=${options?.reason ?? 'manual'} — no-op (no stable unload API)`,
    );
    await llamaCppModule.releaseResources(modelId);
  }

  getCost(_modelId: string): { prompt: number; completion: number } {
    return { prompt: 0, completion: 0 };
  }

  /**
   * Version detection via GET /health or /v1/models headers.
   * llama-server does not expose a dedicated /version endpoint; we return null
   * gracefully so the registry skips the version compatibility check.
   */
  async getVersion(): Promise<string | null> {
    return null;
  }
}

export const llamaCppProvider: LLMProvider = new LlamaCppProvider();
