/**
 * Types for the Task Execution module
 */

export interface ITaskExecutor {
  /**
   * Execute a task using the selected model
   * This handles the actual execution of the task through the appropriate service
   */
  executeTask: (modelId: string, task: string, jobId: string) => Promise<string>;
}

export class TaskExecutor implements ITaskExecutor {
  private modelRegistry: ModelRegistry;

  constructor(modelRegistry: ModelRegistry) {
    this.modelRegistry = modelRegistry;
  }

  async executeTask(modelId: string, task: string, jobId: string): Promise<string> {
    const model = this.modelRegistry.getModel(modelId);
    if (!model) {
      throw new Error(`Model not found: ${modelId}`);
    }
    // Logic to execute task based on model capabilities
    return `Task executed for model ${model.name}`;
  }
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