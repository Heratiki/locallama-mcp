/**
 * Types for the Task Execution module
 */

export interface ITaskExecutor {
  /**
   * Execute a task using the selected model
   * This handles the actual execution of the task through the appropriate service
   */
  executeTask: (model: string, task: string, jobId: string) => Promise<string>;
  
  /**
   * Execute a task with an Ollama model
   */
  executeOllamaModel: (model: string, task: string) => Promise<string>;
  
  /**
   * Execute a task with an LM Studio model
   */
  executeLmStudioModel: (model: string, task: string) => Promise<string>;
  
  /**
   * Execute a task with a local model
   */
  executeLocalModel: (model: string, task: string) => Promise<string>;
}

export interface TaskExecutionOptions {
  /**
   * Whether to stream the response
   */
  stream?: boolean;
  
  /**
   * Maximum tokens to generate
   */
  maxTokens?: number;
  
  /**
   * Temperature for generation (0-1)
   */
  temperature?: number;
  
  /**
   * System prompt to use
   */
  systemPrompt?: string;
}

export interface TaskExecutionResult {
  /**
   * The generated content
   */
  content: string;
  
  /**
   * The model used for generation
   */
  model: string;
  
  /**
   * Tokens used for context
   */
  contextTokens?: number;
  
  /**
   * Tokens generated in the response
   */
  generatedTokens?: number;
  
  /**
   * Total tokens used (context + generated)
   */
  totalTokens?: number;
  
  /**
   * Time taken to complete the task (ms)
   */
  timeTaken?: number;
}