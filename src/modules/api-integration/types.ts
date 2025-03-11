import { Tool } from '@modelcontextprotocol/sdk/types.js';

export interface IToolDefinitionProvider {
  /**
   * Initialize the tool definition provider with a server instance
   * @param server The MCP server instance
   */
  initialize(server: any): void;

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
  initializeRetriv(args: any): Promise<any>;
}

export interface IOpenRouterIntegration {
  /**
   * Check if OpenRouter API key is configured
   */
  isOpenRouterConfigured(): boolean;

  /**
   * Get a list of free models from OpenRouter
   */
  getFreeModels(): Promise<any>;

  /**
   * Clear OpenRouter tracking data
   */
  clearTrackingData(): Promise<void>;

  /**
   * Update the prompting strategy for a model
   */
  updatePromptingStrategy(model: string, config: any, successRate: number, qualityScore: number): Promise<void>;
}

export interface ICostEstimator {
  /**
   * Estimate the cost for a task
   * @param args Parameters for cost estimation
   */
  estimateCost(args: { contextLength: number; outputLength: number; model?: string }): Promise<any>;
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
  completeJob(jobId: string): void;

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
  getJob(jobId: string): any;
}

export interface IRouter {
  /**
   * Route a task to the appropriate model
   */
  routeTask(args: { 
    task: string; 
    contextLength: number; 
    expectedOutputLength: number; 
    complexity: number; 
    priority: string 
  }): Promise<any>;

  /**
   * Perform preemptive routing of a task
   */
  preemptiveRouting(args: { 
    task: string; 
    contextLength: number; 
    expectedOutputLength: number; 
    complexity: number; 
    priority: string 
  }): Promise<any>;
}