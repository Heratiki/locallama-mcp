import { Tool } from '@modelcontextprotocol/sdk/types.js';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';

export interface IToolDefinitionProvider {
  /**
   * Initialize the tool definition provider with a server instance
   * @param server The MCP server instance
   */
  initialize(server: Server): void;

  /**
   * Get all available tools
   * @returns Array of tool definitions
   */
  getAvailableTools(): Tool[];
}

export interface ITaskExecutor {
  /**
   * Execute a task using the selected model
   * @param model The model to use for execution
   * @param task The task to execute
   * @param jobId The unique identifier for this execution job
   * @returns A promise that resolves to the execution result
   */
  executeTask(model: string, task: string, jobId: string): Promise<string>;
}

export interface IRetrivIntegration {
  /**
   * Check if Python is available on the system
   */
  isPythonAvailable(): boolean;

  /**
   * Check if a specific Python module is installed
   * @param moduleName The name of the module to check
   */
  isPythonModuleInstalled(moduleName: string): boolean;

  /**
   * Generate a requirements.txt file for Retriv dependencies
   */
  generateRequirementsTxt(): string;

  /**
   * Initialize Retriv with the given arguments
   * @param args Configuration arguments for Retriv
   */
  initializeRetriv(args: RetrivInitArgs): Promise<RetrivInitResult>;
}

export interface RetrivInitArgs {
  directories: string[];
  exclude_patterns?: string[];
  install_dependencies?: boolean;
  force_reindex?: boolean;
  retriever_type?: 'sparse' | 'dense' | 'hybrid';
  text_preprocessing?: {
    min_df?: number;
    tokenizer?: string | null;
    stemmer?: string | null;
    stopwords?: string | null;
    do_lowercasing?: boolean;
    do_ampersand_normalization?: boolean;
    do_special_chars_normalization?: boolean;
    do_acronyms_normalization?: boolean;
    do_punctuation_removal?: boolean;
  };
}

export interface RetrivInitResult {
  status: 'success' | 'error' | 'warning';
  message: string;
  indexedFiles?: number;
  excludedFiles?: number;
}

export interface IOpenRouterIntegration {
  /**
   * Check if OpenRouter API key is configured
   */
  isOpenRouterConfigured(): boolean;

  /**
   * Get a list of free models from OpenRouter
   */
  getFreeModels(): Promise<OpenRouterModel[]>;

  /**
   * Clear OpenRouter tracking data
   */
  clearTrackingData(): Promise<void>;

  /**
   * Update the prompting strategy for a model
   */
  updatePromptingStrategy(
    model: string, 
    config: PromptingStrategyConfig, 
    successRate: number, 
    qualityScore: number
  ): Promise<void>;
}

export interface OpenRouterModel {
  id: string;
  name: string;
  isFree: boolean;
  provider?: string;
  contextLength?: number;
  pricing?: {
    prompt: number;
    completion: number;
  };
}

export interface PromptingStrategyConfig {
  temperature?: number;
  top_p?: number;
  system_prompt?: string;
  context_window?: number;
}

export interface ICostEstimator {
  /**
   * Estimate the cost for a task
   * @param args Parameters for cost estimation
   */
  estimateCost(args: CostEstimationArgs): Promise<CostEstimationResult>;
}

export interface CostEstimationArgs {
  contextLength: number;
  outputLength: number;
  model?: string;
}

export interface CostEstimationResult {
  estimatedCost: number;
  currency: string;
  model: string;
  tokenCount: {
    input: number;
    output: number;
    total: number;
  };
}

export interface IJobManager {
  /**
   * Create a new job
   */
  createJob(jobId: string, task: string, model: string): void;

  /**
   * Update the progress of a job
   */
  updateJobProgress(jobId: string, progress: number, timeout?: number): void;

  /**
   * Mark a job as completed
   */
  completeJob(jobId: string, results?: string[]): void;

  /**
   * Mark a job as failed
   */
  failJob(jobId: string, message: string): void;

  /**
   * Cancel a job
   */
  cancelJob(jobId: string): void;

  /**
   * Get job details
   */
  getJob(jobId: string): Job | null;
}

export interface Job {
  id: string;
  task: string;
  model: string;
  status: 'pending' | 'in_progress' | 'completed' | 'failed' | 'cancelled';
  progress: number;
  startTime: number;
  endTime?: number;
  error?: string;
}

export interface IRouter {
  /**
   * Route a task to the appropriate model
   */
  routeTask(args: RoutingArgs): Promise<RoutingResult>;

  /**
   * Perform preemptive routing of a task
   */
  preemptiveRouting(args: RoutingArgs): Promise<RoutingResult>;
}

export interface RoutingArgs {
  task: string;
  contextLength: number;
  expectedOutputLength: number;
  complexity: number;
  priority: 'speed' | 'quality' | 'cost' | 'balance';
}

export interface RoutingResult {
  model: string;
  provider: 'local' | 'free' | 'paid';
  estimatedCost?: number;
  jobId: string;
  rationale: string;
}