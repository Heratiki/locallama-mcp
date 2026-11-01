/**
 * Provider-agnostic LLM abstraction.
 *
 * Routing, benchmarking, and model selection should depend on this surface
 * rather than provider string literals. Each runtime (LM Studio, Ollama,
 * OpenRouter, ...) registers an `LLMProvider` implementation with the
 * `ProviderRegistry`.
 */

export type CostClass = 'local' | 'free' | 'paid';

/**
 * A lightweight description of a model exposed by a provider. Richer metadata
 * (capabilities, benchmark summaries) lives in the `ModelRegistry` introduced
 * in Section 2 of PLAN.md.
 */
export interface ProviderModel {
  id: string;
  displayName?: string;
  family?: string;
  contextWindow?: number;
  costPerToken?: { prompt: number; completion: number };
}

export interface TaskExecutionOptions {
  stream?: boolean;
  maxTokens?: number;
  temperature?: number;
  systemPrompt?: string;
  timeoutMs?: number;
  /** Cancel the model call. Providers that cannot abort ignore it. */
  signal?: AbortSignal;
}

/** AbortError for a call cancelled by the caller's signal (not a timeout). */
export function abortError(): Error {
  const err = new Error('The operation was aborted');
  err.name = 'AbortError';
  return err;
}

/**
 * Abort `controller` when `signal` aborts (now, if it already has). Also clears
 * the request's timeout timer once the controller aborts, so a cancelled call
 * leaves no timer behind.
 */
export function linkAbort(
  controller: AbortController,
  signal?: AbortSignal,
  timer?: ReturnType<typeof setTimeout>,
): void {
  if (timer !== undefined) {
    controller.signal.addEventListener('abort', () => clearTimeout(timer), { once: true });
  }
  if (!signal) return;
  if (signal.aborted) { controller.abort(); return; }
  signal.addEventListener('abort', () => controller.abort(), { once: true });
}

/**
 * Settle with `work` unless `signal` aborts first, then reject with an
 * AbortError. The underlying work is left to finish and its output is
 * discarded (PRD 01 5.10). With no signal, `work` is returned unchanged.
 */
export function raceAbort<T>(work: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return work;
  if (signal.aborted) {
    work.catch(() => undefined);
    return Promise.reject(abortError());
  }
  return new Promise<T>((resolve, reject) => {
    const onAbort = (): void => reject(abortError());
    signal.addEventListener('abort', onAbort, { once: true });
    work.then(
      (v) => { signal.removeEventListener('abort', onAbort); resolve(v); },
      (e) => { signal.removeEventListener('abort', onAbort); reject(e); },
    );
  });
}

export interface TaskExecutionResult {
  content: string;
  model: string;
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
  timeTakenMs?: number;
}

export interface LLMProvider {
  readonly id: string;
  readonly displayName: string;
  readonly costClass: CostClass;
  readonly isLocal: boolean;

  init(): Promise<void>;
  isAvailable(): Promise<boolean>;

  listModels(): Promise<ProviderModel[]>;
  supportsModel(modelId: string): boolean | Promise<boolean>;

  executeTask(
    modelId: string,
    task: string,
    options?: TaskExecutionOptions,
  ): Promise<TaskExecutionResult>;

  releaseResources?(options?: {
    reason?: 'cross-provider-handoff' | 'same-provider-model-switch' | 'shutdown' | 'manual';
    modelId?: string;
  }): Promise<void>;

  getCost(modelId: string): { prompt: number; completion: number };

  getVersion?(): Promise<string | null>;

  hasRateLimitBudget?(): boolean;

  /** Clean up resources (e.g. child processes) on server shutdown. */
  shutdown?(): Promise<void>;
}
