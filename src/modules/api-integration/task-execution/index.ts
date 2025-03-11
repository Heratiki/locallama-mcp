import { logger } from '../../../utils/logger.js';
import { config } from '../../../config/index.js';
import { jobTracker } from '../../decision-engine/services/jobTracker.js';
import { openRouterModule } from '../../openrouter/index.js';
import { ITaskExecutor } from '../types.js';
import { getCodeSearchEngine, indexDocuments } from '../../cost-monitor/codeSearchEngine.js';

/**
 * Task Executor class implementing the ITaskExecutor interface
 * Handles execution of tasks with different models
 */
export class TaskExecutor implements ITaskExecutor {
  /**
   * Execute a task using the selected model
   * This handles the actual execution of the task through the appropriate service
   */
  async executeTask(model: string, task: string, jobId: string): Promise<string> {
    try {
      logger.info(`Executing task with model ${model} for job ${jobId}`);
      
      // Update job progress to executing (25%)
      jobTracker.updateJobProgress(jobId, 25, 120000);
      
      let result;
      
      // Determine the execution path based on model provider
      if (model.startsWith('openrouter:')) {
        // Handle OpenRouter execution via explicit prefix
        try {
          // Update progress to 50% before API call
          jobTracker.updateJobProgress(jobId, 50, 60000);
          
          // Execute the task via OpenRouter
          result = await openRouterModule.executeTask(model.replace('openrouter:', ''), task);
          
          // Update progress to 75% after successful API call
          jobTracker.updateJobProgress(jobId, 75, 30000);
        } catch (error) {
          logger.error(`Failed to execute task with OpenRouter: ${error}`);
          throw error;
        }
      } else if (model.includes('/')) {
        // Handle OpenRouter models with provider/model format (e.g., google/gemini-exp-1206:free)
        try {
          // Update progress to 50% before API call
          jobTracker.updateJobProgress(jobId, 50, 60000);
          
          // Execute the task via OpenRouter
          result = await openRouterModule.executeTask(model, task);
          
          // Update progress to 75% after successful API call
          jobTracker.updateJobProgress(jobId, 75, 30000);
        } catch (error) {
          logger.error(`Failed to execute task with OpenRouter model ${model}: ${error}`);
          throw error;
        }
      } else {
        // For all other model types (local, ollama, lm-studio), handle execution directly
        try {
          // Update progress to 50% before execution
          jobTracker.updateJobProgress(jobId, 50, 60000);
          
          // Extract provider and model name
          const modelParts = model.split(':');
          const provider = modelParts[0];
          const modelName = modelParts.slice(1).join(':');
          
          // Execute based on provider type
          switch (provider) {
            case 'ollama':
              result = await this.executeOllamaModel(modelName, task);
              break;
            case 'lm-studio':
              result = await this.executeLmStudioModel(modelName, task);
              break;
            case 'local':
              result = await this.executeLocalModel(modelName, task);
              break;
            default:
              throw new Error(`Unsupported model provider: ${model}`);
          }
          
          // Update progress to 75% after execution
          jobTracker.updateJobProgress(jobId, 75, 30000);
        } catch (error) {
          logger.error(`Failed to execute task with model ${model}: ${error}`);
          throw error;
        }
      }
      
      // Process and format result if needed
      const formattedResult = typeof result === 'string' ? result : JSON.stringify(result);
      
      // Index the result in Retriv if possible
      try {
        const codeSearchEngine = await getCodeSearchEngine();
        await indexDocuments([
          { 
            content: formattedResult, 
            path: `job_${jobId}`, 
            language: 'code' 
          }
        ]);
        logger.info(`Successfully indexed result for job ${jobId} in Retriv`);
      } catch (error) {
        logger.warn(`Failed to index result in Retriv: ${error}`);
        // Continue even if indexing fails
      }
      
      // Complete the job (100%)
      jobTracker.completeJob(jobId);
      logger.info(`Job ${jobId} completed successfully`);
      
      return formattedResult;
    } catch (error) {
      logger.error(`Error executing task for job ${jobId}:`, error);
      jobTracker.failJob(jobId, error instanceof Error ? error.message : 'Unknown error during execution');
      throw error;
    }
  }
  
  /**
   * Execute a task with an Ollama model
   */
  async executeOllamaModel(model: string, task: string): Promise<string> {
    logger.info(`Executing task with Ollama model ${model}`);
    
    try {
      // Get Ollama API endpoint from config or use default
      const ollamaEndpoint = config.ollamaEndpoint || 'http://localhost:11434/api/generate';
      
      // Make a request to the Ollama API
      const response = await fetch(`${ollamaEndpoint}/chat`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model,
          messages: [
            { role: 'system', content: 'You are a helpful assistant.' },
            { role: 'user', content: task }
          ],
          stream: false,
        }),
      });
      
      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Ollama API error (${response.status}): ${errorText}`);
      }
      
      const result = await response.json();
      return result.message?.content || 'No response from Ollama';
    } catch (error) {
      logger.error(`Error executing task with Ollama model ${model}:`, error);
      throw error;
    }
  }
  
  /**
   * Execute a task with an LM Studio model
   */
  async executeLmStudioModel(model: string, task: string): Promise<string> {
    logger.info(`Executing task with LM Studio model ${model}`);
    
    try {
      // Get LM Studio API endpoint from config or use default
      const lmStudioEndpoint = config.lmStudioEndpoint || 'http://localhost:1234/v1';
      
      // Make a request to the LM Studio API
      const response = await fetch(`${lmStudioEndpoint}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model,
          messages: [
            { role: 'system', content: 'You are a helpful assistant.' },
            { role: 'user', content: task }
          ],
          temperature: 0.7,
          max_tokens: 4096,
          stream: false
        }),
      });
      
      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`LM Studio API error (${response.status}): ${errorText}`);
      }
      
      const result = await response.json();
      return result.choices?.[0]?.message?.content || 'No response from LM Studio';
    } catch (error) {
      logger.error(`Error executing task with LM Studio model ${model}:`, error);
      throw error;
    }
  }
  
  /**
   * Execute a task with a local model
   */
  async executeLocalModel(model: string, task: string): Promise<string> {
    logger.info(`Executing task with local model ${model}`);
    
    try {
      // For local models, we'll default to using the LM Studio endpoint if available,
      // otherwise fall back to Ollama
      if (config.lmStudioEndpoint) {
        return await this.executeLmStudioModel(model, task);
      } else if (config.ollamaEndpoint) {
        return await this.executeOllamaModel(model, task);
      } else {
        throw new Error('No local model endpoint configured');
      }
    } catch (error) {
      logger.error(`Error executing task with local model ${model}:`, error);
      throw error;
    }
  }
}

// Create singleton instance
const taskExecutor = new TaskExecutor();

// For backward compatibility, create a new class that extends TaskExecutor
class LegacyTaskExecutor extends TaskExecutor {
  // Expose protected methods as public for backward compatibility
  public async ollamaModel(model: string, task: string): Promise<string> {
    return this.executeOllamaModel(model, task);
  }

  public async lmStudioModel(model: string, task: string): Promise<string> {
    return this.executeLmStudioModel(model, task);
  }

  public async localModel(model: string, task: string): Promise<string> {
    return this.executeLocalModel(model, task);
  }
}

// Create singleton instance of legacy executor
const legacyExecutor = new LegacyTaskExecutor();

// Export the main task executor
export { taskExecutor };

// Export legacy functions with deprecated notice
/** @deprecated Use taskExecutor.executeTask instead */
export const executeTask = taskExecutor.executeTask.bind(taskExecutor);

/** @deprecated Use taskExecutor directly instead */
export const executeOllamaModel = legacyExecutor.ollamaModel.bind(legacyExecutor);

/** @deprecated Use taskExecutor directly instead */
export const executeLmStudioModel = legacyExecutor.lmStudioModel.bind(legacyExecutor);

/** @deprecated Use taskExecutor directly instead */
export const executeLocalModel = legacyExecutor.localModel.bind(legacyExecutor);