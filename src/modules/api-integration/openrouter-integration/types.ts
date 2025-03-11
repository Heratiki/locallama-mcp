/**
 * Types for the OpenRouter Integration module
 */

export interface IOpenRouterIntegration {
  /**
   * Check if OpenRouter API key is configured
   */
  isOpenRouterConfigured: () => boolean;
  
  /**
   * Execute a task via OpenRouter
   */
  executeTask: (model: string, task: string) => Promise<string>;
  
  /**
   * Get list of free models from OpenRouter
   */
  getFreeModels: (forceUpdate?: boolean) => Promise<OpenRouterModel[]>;
  
  /**
   * Clear OpenRouter tracking data
   */
  clearTrackingData: () => Promise<void>;
  
  /**
   * Update prompting strategy for a model
   */
  updatePromptingStrategy: (
    modelId: string, 
    strategy: PromptingStrategy, 
    successRate: number, 
    qualityScore: number
  ) => Promise<void>;
  
  /**
   * Benchmark free models available from OpenRouter
   */
  benchmarkFreeModels: (benchmarkConfig: OpenRouterBenchmarkConfig) => Promise<OpenRouterBenchmarkResult>;
}

export interface OpenRouterModel {
  /**
   * Model ID
   */
  id: string;
  
  /**
   * Display name of the model
   */
  name: string;
  
  /**
   * Whether the model is free to use
   */
  isFree: boolean;
  
  /**
   * Context window size (max tokens)
   */
  contextWindow: number;
  
  /**
   * Cost per 1K tokens for input
   */
  inputCostPer1K?: number;
  
  /**
   * Cost per 1K tokens for output
   */
  outputCostPer1K?: number;
  
  /**
   * Provider of the model
   */
  provider?: string;
}

export interface PromptingStrategy {
  /**
   * System prompt to use
   */
  systemPrompt: string;
  
  /**
   * User prompt template
   */
  userPrompt: string;
  
  /**
   * Assistant prompt template
   */
  assistantPrompt: string;
  
  /**
   * Whether to use chat format
   */
  useChat: boolean;
}

export interface OpenRouterBenchmarkConfig {
  /**
   * Array of tasks to benchmark
   */
  tasks: OpenRouterBenchmarkTask[];
  
  /**
   * Number of runs per task
   */
  runsPerTask?: number;
  
  /**
   * Whether to run tasks in parallel
   */
  parallel?: boolean;
  
  /**
   * Maximum number of parallel tasks
   */
  maxParallelTasks?: number;
}

export interface OpenRouterBenchmarkTask {
  /**
   * Unique identifier for the task
   */
  taskId: string;
  
  /**
   * The coding task to benchmark
   */
  task: string;
  
  /**
   * Length of the context in tokens
   */
  contextLength: number;
  
  /**
   * Expected output length in tokens
   */
  expectedOutputLength?: number;
  
  /**
   * Task complexity (0-1)
   */
  complexity?: number;
}

export interface OpenRouterBenchmarkResult {
  /**
   * Results for each model
   */
  results: Record<string, ModelBenchmarkResult>;
  
  /**
   * Summary of all benchmarks
   */
  summary: BenchmarkSummary;
}

export interface ModelBenchmarkResult {
  /**
   * Average time taken (ms)
   */
  averageTime: number;
  
  /**
   * Success rate (0-1)
   */
  successRate: number;
  
  /**
   * Average quality score (0-1)
   */
  averageQuality: number;
  
  /**
   * Tasks that completed successfully
   */
  successfulTasks: number;
  
  /**
   * Total tasks attempted
   */
  totalTasks: number;
}

export interface BenchmarkSummary {
  /**
   * Best model for quality
   */
  bestQualityModel: string;
  
  /**
   * Best model for speed
   */
  bestSpeedModel: string;
  
  /**
   * Total time spent benchmarking (ms)
   */
  totalTime: number;
  
  /**
   * Number of models tested
   */
  modelsCount: number;
}