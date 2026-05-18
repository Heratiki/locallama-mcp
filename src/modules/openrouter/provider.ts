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
 *
 * When `config.openRouterFreeOnly` is true (the default), only zero-cost models
 * are listed and any call to a paid model is rejected before hitting the API.
 * A simple sliding-window rate limiter enforces `config.openRouterRateLimitPerMinute`.
 */
class OpenRouterProvider implements LLMProvider {
  readonly id = 'openrouter';
  readonly displayName = 'OpenRouter';
  readonly costClass = 'paid' as const;
  readonly isLocal = false;

  private cachedCosts = new Map<string, { prompt: number; completion: number }>();
  private cachedModelIds = new Set<string>();

  /** Timestamps (ms) of recent API calls — used for rate limiting */
  private callTimestamps: number[] = [];

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
      const models = await this.listModels();
      return models.length > 0;
    } catch {
      return false;
    }
  }

  async listModels(): Promise<ProviderModel[]> {
    const models = config.openRouterFreeOnly
      ? await openRouterModule.getFreeModels(false)
      : await openRouterModule.getAvailableModels();
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

  /**
   * Check whether calling the API now would exceed the rate limit.
   * Prunes entries older than 60 s before deciding.
   */
  private checkRateLimit(): { allowed: boolean; retryAfterMs: number } {
    const limit = config.openRouterRateLimitPerMinute;
    if (limit === 0) return { allowed: true, retryAfterMs: 0 };

    const now = Date.now();
    const windowMs = 60_000;
    // Prune old entries
    this.callTimestamps = this.callTimestamps.filter((t) => now - t < windowMs);

    if (this.callTimestamps.length >= limit) {
      const oldest = this.callTimestamps[0];
      const retryAfterMs = windowMs - (now - oldest);
      return { allowed: false, retryAfterMs };
    }
    return { allowed: true, retryAfterMs: 0 };
  }

  async executeTask(
    modelId: string,
    task: string,
    _options?: TaskExecutionOptions,
  ): Promise<TaskExecutionResult> {
    const id = modelId.startsWith('openrouter:')
      ? modelId.substring('openrouter:'.length)
      : modelId;

    // Guard: free-only mode — reject non-free models before any API call
    if (config.openRouterFreeOnly) {
      const cost = this.cachedCosts.get(id) ?? this.cachedCosts.get(modelId);
      const EPSILON = 1e-11;
      if (cost && (cost.prompt > EPSILON || cost.completion > EPSILON)) {
        throw new Error(
          `OpenRouter model '${id}' is not free (prompt=${cost.prompt}, completion=${cost.completion}). ` +
          `Set OPENROUTER_FREE_ONLY=false to enable paid models.`,
        );
      }
    }

    // Guard: rate limit
    const { allowed, retryAfterMs } = this.checkRateLimit();
    if (!allowed) {
      throw new Error(
        `OpenRouter rate limit reached (${config.openRouterRateLimitPerMinute} calls/min). ` +
        `Retry after ${Math.ceil(retryAfterMs / 1000)}s.`,
      );
    }

    this.callTimestamps.push(Date.now());
    logger.debug(
      `OpenRouter call ${this.callTimestamps.length}/${config.openRouterRateLimitPerMinute} this minute for model ${id}`,
    );

    const content = await openRouterModule.executeTask(id, task);
    return { content, model: id };
  }

  getCost(modelId: string): { prompt: number; completion: number } {
    return this.cachedCosts.get(modelId) ?? { prompt: 0, completion: 0 };
  }
}

export const openRouterProvider: LLMProvider = new OpenRouterProvider();
