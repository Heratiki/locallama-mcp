/**
 * Core model metadata types for Section 2 of PLAN.md.
 *
 * `ModelRegistry` is the single authority for model information. All routing,
 * benchmarking, and capability-detection layers consume these types rather than
 * the legacy `Model` / `ModelPerformanceData` shapes.
 */

export interface ModelCapabilities {
  chat: boolean;
  code: boolean;
  vision: boolean;
  toolUse: boolean;
  /** contextWindow >= 32768 */
  largeContext: boolean;
  maxContextTokens: number;
  /** Empirical scores 0..1, populated by benchmark pipeline. undefined = not measured yet. */
  scores?: {
    code?: number;
    reasoning?: number;
    speed?: number;
  };
}

export interface BenchmarkSummary {
  /** Unix ms of the last benchmark run */
  lastRunAt: number;
  /** Which task categories were benchmarked (e.g. 'code', 'chat', 'tool-use') */
  taskCategories: string[];
  scores: {
    code?: number;
    reasoning?: number;
    speed?: number;
  };
  successRate?: number;
  qualityScore?: number;
  avgResponseTime?: number;
}

export interface ModelMetadata {
  /** Unique model id as returned by the provider (e.g. 'qwen2.5-coder-7b') */
  id: string;
  /** Matches `LLMProvider.id` */
  providerId: string;
  displayName: string;
  /** Model family string, e.g. 'llama', 'qwen', 'mistral' */
  family?: string;
  /** Parameter count in billions, if known */
  parameters?: number;
  contextWindow: number;
  capabilities: ModelCapabilities;
  /** Cost per 1 000 tokens; zero for local/free models */
  cost: { prompt: number; completion: number };
  /** References a strategy id in prompting-strategies.json */
  promptingStrategyId: string;
  /** Latest aggregated benchmark scores; undefined until first benchmark run */
  benchmarkSummary?: BenchmarkSummary;
  /** Unix ms timestamp of when this model was last observed from the provider */
  lastSeen?: number;
}

/**
 * A partial override that can come from `src/config/models.json`.
 * `id` is required so the registry knows which model to patch.
 */
export type ModelOverride = Partial<Omit<ModelMetadata, 'id'>> & { id: string };
