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

  /** Clean up resources (e.g. child processes) on server shutdown. */
  shutdown?(): Promise<void>;
}
