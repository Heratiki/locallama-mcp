import { logger } from '../../../utils/logger.js';
import { getJobTracker } from '../../decision-engine/services/jobTracker.js';
import { ITaskExecutor } from '../types.js';
import { getProviderRegistry } from '../../core/provider/registry.js';
import { getModelRegistry } from '../../core/model/registry.js';
import type { TaskExecutionOptions } from '../../core/provider/types.js';
import { buildCodeTaskExecutionOptions } from '../../core/prompting/execution-profile.js';
import { estimateTokens } from '../../utils/tokenCount.js';

/**
 * Thrown when an estimated task token count exceeds the target model's
 * context window.  Callers (e.g. the MCP dispatcher) should catch this and
 * surface a structured error response rather than a generic message.
 */
export class ContextWindowError extends Error {
  readonly name = 'ContextWindowError' as const;
  constructor(
    public readonly modelId: string,
    public readonly estimatedTokens: number,
    public readonly contextWindow: number,
  ) {
    super(
      `Task exceeds context window for model '${modelId}': ` +
        `estimated ${estimatedTokens} tokens > limit ${contextWindow} tokens`,
    );
  }
}

let jobTracker: Awaited<ReturnType<typeof getJobTracker>>;

/**
 * Resolves `modelId` to a bare model id and a provider id.
 *
 * The legacy calling convention used prefixed ids like `lm-studio:<id>` or
 * `ollama:<id>`.  We strip those here so both legacy and registry paths work.
 */
function resolveModelId(modelId: string): { providerId: string | null; bareId: string } {
  if (modelId.startsWith('lm-studio:')) return { providerId: 'lm-studio', bareId: modelId.slice(10) };
  if (modelId.startsWith('ollama:')) return { providerId: 'ollama', bareId: modelId.slice(7) };
  if (modelId.startsWith('openrouter:')) return { providerId: 'openrouter', bareId: modelId.slice(11) };
  return { providerId: null, bareId: modelId };
}

/**
 * Provider-agnostic task executor.
 *
 * Dispatch priority:
 *  1. Look up the model in `ModelRegistry` → use its `providerId`.
 *  2. Fall back to the prefix convention (`lm-studio:<id>`, etc.).
 *  3. If neither resolves, try every local provider in turn (for bare ids with
 *     no prefix and no registry entry — backward-compat with old callers).
 */
export class TaskExecutor implements ITaskExecutor {
  async executeTask(modelId: string, task: string, jobId: string): Promise<string> {
    logger.info(`Executing task with model ${modelId} for job ${jobId}`);

    try {
      jobTracker = await getJobTracker();
    } catch (err) {
      logger.error(`Failed to initialize jobTracker: ${err instanceof Error ? err.message : String(err)}`);
      throw err;
    }

    try {
      void jobTracker.updateJobProgress(jobId, 25, 120_000);
    } catch (err) {
      logger.error(`Failed to update job progress (25%) for job ${jobId}: ${err instanceof Error ? err.message : String(err)}`);
    }

    let result: string;
    try {
      result = await this._dispatch(modelId, task);
    } catch (error) {
      logger.error(`Error executing task for job ${jobId}:`, error);
      try {
        void jobTracker.failJob(
          jobId,
          error instanceof Error ? error.message : 'Unknown error during execution',
        );
      } catch (failErr) {
        logger.error(`Failed to mark job ${jobId} as failed: ${failErr instanceof Error ? failErr.message : String(failErr)}`);
      }
      throw error;
    }

    try {
      void jobTracker.updateJobProgress(jobId, 75, 30_000);
    } catch (err) {
      logger.error(`Failed to update job progress (75%) for job ${jobId}: ${err instanceof Error ? err.message : String(err)}`);
    }

    logger.info(`Job ${jobId} completed successfully`);
    return result;
  }

  private async executeWithProvider(
    providerId: string,
    bareId: string,
    task: string,
    options: TaskExecutionOptions,
    source: string,
  ): Promise<string> {
    const registry = getProviderRegistry();
    const provider = registry.get(providerId);
    if (!provider) {
      throw new Error(`Provider '${providerId}' is not registered (${source})`);
    }

    if (!registry.isAvailable(provider.id)) {
      throw new Error(`Provider '${provider.id}' is temporarily unavailable (circuit open)`);
    }

    try {
      const executionOptions = { ...buildCodeTaskExecutionOptions(task, provider.id), ...options };
      const result = await provider.executeTask(bareId, task, executionOptions);
      registry.recordProviderSuccess(provider.id);
      return result.content;
    } catch (error) {
      registry.recordProviderFailure(provider.id);
      throw error;
    }
  }

  /** Dispatch to the right provider without job tracking (pure routing). */
  private async _dispatch(modelId: string, task: string): Promise<string> {
    const { providerId: prefixProviderId, bareId } = resolveModelId(modelId);
    const registry = getProviderRegistry();
    const modelRegistry = getModelRegistry();
    const options: TaskExecutionOptions = {};
    let lastError: Error | undefined;

    // Context-window enforcement: reject early if the task is too large.
    const estimatedTokens = estimateTokens(task);
    const metaForCheck = modelRegistry.getModel(bareId) ?? modelRegistry.getModel(modelId);
    if (metaForCheck && estimatedTokens > metaForCheck.contextWindow) {
      throw new ContextWindowError(modelId, estimatedTokens, metaForCheck.contextWindow);
    }

    // 1. Registry lookup: model metadata tells us which provider to use.
    const meta = modelRegistry.getModel(bareId) ?? modelRegistry.getModel(modelId);
    if (meta) {
      if (registry.get(meta.providerId)) {
        logger.debug(`Dispatching ${bareId} via registry (provider: ${meta.providerId})`);
        try {
          return await this.executeWithProvider(meta.providerId, bareId, task, options, 'registry lookup');
        } catch (error) {
          lastError = error instanceof Error ? error : new Error(String(error));
          logger.warn(`Primary provider dispatch failed for ${bareId} via ${meta.providerId}: ${lastError.message}`);
        }
      }
    }

    // 2. Prefix convention: `lm-studio:<id>`, `ollama:<id>`, `openrouter:<id>`.
    if (prefixProviderId) {
      if (registry.get(prefixProviderId)) {
        logger.debug(`Dispatching ${bareId} via prefix (provider: ${prefixProviderId})`);
        try {
          return await this.executeWithProvider(prefixProviderId, bareId, task, options, 'prefixed model id');
        } catch (error) {
          lastError = error instanceof Error ? error : new Error(String(error));
          logger.warn(`Prefix provider dispatch failed for ${bareId} via ${prefixProviderId}: ${lastError.message}`);
        }
      }
    }

    // 3. Bare id — try all local providers in registration order, then any others.
    const localProviders = registry.listByCostClass('local');
    for (const provider of localProviders) {
      if (!registry.isAvailable(provider.id)) {
        logger.debug(`Skipping unavailable local provider ${provider.id} (circuit open)`);
        continue;
      }

      const supports = await provider.supportsModel(bareId);
      if (supports) {
        logger.debug(`Dispatching ${bareId} to local provider ${provider.id} (fallback probe)`);
        try {
          return await this.executeWithProvider(provider.id, bareId, task, options, 'local fallback probe');
        } catch (error) {
          lastError = error instanceof Error ? error : new Error(String(error));
          logger.warn(`Local fallback provider ${provider.id} failed for ${bareId}: ${lastError.message}`);
        }
      }
    }

    // 4. Try non-local providers (openrouter / free-tier).
    const otherProviders = registry.list().filter((p) => !p.isLocal);
    for (const provider of otherProviders) {
      if (!registry.isAvailable(provider.id)) {
        logger.debug(`Skipping unavailable provider ${provider.id} (circuit open)`);
        continue;
      }

      const supports = await provider.supportsModel(bareId);
      if (supports) {
        logger.debug(`Dispatching ${bareId} to provider ${provider.id} (fallback probe)`);
        try {
          return await this.executeWithProvider(provider.id, bareId, task, options, 'remote fallback probe');
        } catch (error) {
          lastError = error instanceof Error ? error : new Error(String(error));
          logger.warn(`Fallback provider ${provider.id} failed for ${bareId}: ${lastError.message}`);
        }
      }
    }

    if (lastError) {
      throw new Error(
        `Failed to execute model '${modelId}' after trying available providers: ${lastError.message}`,
      );
    }

    throw new Error(
      `No provider found for model '${modelId}'. Ensure it is available in a registered provider.`,
    );
  }
}

const taskExecutor = new TaskExecutor();

export { taskExecutor };

/** @deprecated Use taskExecutor.executeTask instead */
export const executeTask = taskExecutor.executeTask.bind(taskExecutor);
