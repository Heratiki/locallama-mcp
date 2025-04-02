import { logger } from '../../../utils/logger.js';
import { config } from '../../../config/index.js';
import { getJobTracker } from '../../decision-engine/services/jobTracker.js';
import { openRouterModule } from '../../openrouter/index.js';
import { ollamaModule } from '../../ollama/index.js'; // Added import
import { lmStudioModule } from '../../lm-studio/index.js'; // Added import
import { ITaskExecutor } from '../types.js';
import { indexDocuments } from '../../cost-monitor/codeSearchEngine.js';

let jobTracker: Awaited<ReturnType<typeof getJobTracker>>;

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

      try {
        jobTracker = await getJobTracker();
      } catch (getJobTrackerError) {
        logger.error(`Failed to initialize jobTracker: ${getJobTrackerError instanceof Error ? getJobTrackerError.message : String(getJobTrackerError)}`);
        throw getJobTrackerError;
      }

      // Update job progress to executing (25%)
      try {
        void jobTracker.updateJobProgress(jobId, 25, 120000);
      } catch (updateJobProgressError) {
        logger.error(`Failed to update job progress for job ${jobId}: ${updateJobProgressError instanceof Error ? updateJobProgressError.message : String(updateJobProgressError)}`);
      }

      let result: string;

      // Determine the execution path based on model provider
      if (model.startsWith('openrouter:')) {
        // Handle OpenRouter execution via explicit prefix
        try {
          // Update progress to 50% before API call
          try {
            void jobTracker.updateJobProgress(jobId, 50, 60000);
          } catch (updateJobProgressError) {
            logger.error(`Failed to update job progress for job ${jobId}: ${updateJobProgressError instanceof Error ? updateJobProgressError.message : String(updateJobProgressError)}`);
          }

          // Execute the task via OpenRouter
          result = await openRouterModule.executeTask(model.replace('openrouter:', ''), task);

          // Update progress to 75% after successful API call
          try {
            void jobTracker.updateJobProgress(jobId, 75, 30000);
          } catch (updateJobProgressError) {
            logger.error(`Failed to update job progress for job ${jobId}: ${updateJobProgressError instanceof Error ? updateJobProgressError.message : String(updateJobProgressError)}`);
          }
        } catch (error) {
          logger.error(`Failed to execute task with OpenRouter: ${error instanceof Error ? error.message : String(error)}`);
          throw error;
        }
        /*
        Author: Roo
        Date: March 11, 2025, 8:34:22 PM
        Original code preserved below - improved model provider handling logic
        } else if (model.startsWith('mistralai/') || model.includes('/') || model === 'mistralai/mistral-small-24b-instruct-2501') {
          // Handle OpenRouter models with provider/model format (e.g., google/gemini-exp-1206:free)
        */
      } else if (model.startsWith('mistralai/') ||
        model.startsWith('google/') ||
        model.startsWith('anthropic/') ||
        (model.includes('/') && !model.includes(':'))) {
        // Handle OpenRouter models with provider/model format
        // Explicitly support known providers and handle generic provider/model formats
        // Skip if it contains ':' as that's likely a local provider format (e.g., 'ollama:llama2')
        try {
          // Update progress to 50% before API call
          try {
            void jobTracker.updateJobProgress(jobId, 50, 60000);
          } catch (updateJobProgressError) {
            logger.error(`Failed to update job progress for job ${jobId}: ${updateJobProgressError instanceof Error ? updateJobProgressError.message : String(updateJobProgressError)}`);
          }

          // Execute the task via OpenRouter
          result = await openRouterModule.executeTask(model, task);

          // Update progress to 75% after successful API call
          try {
            void jobTracker.updateJobProgress(jobId, 75, 30000);
          } catch (updateJobProgressError) {
            logger.error(`Failed to update job progress for job ${jobId}: ${updateJobProgressError instanceof Error ? updateJobProgressError.message : String(updateJobProgressError)}`);
          }
        } catch (error) {
          logger.error(`Failed to execute task with OpenRouter model ${model}: ${error instanceof Error ? error.message : String(error)}`);
          throw error;
        }
      } else {
        // For all other model types (local, ollama, lm-studio), handle execution directly
        try {
          // Update progress to 50% before execution
          try {
            void jobTracker.updateJobProgress(jobId, 50, 60000);
          } catch (updateJobProgressError) {
            logger.error(`Failed to update job progress for job ${jobId}: ${updateJobProgressError instanceof Error ? updateJobProgressError.message : String(updateJobProgressError)}`);
          }

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
          try {
            void jobTracker.updateJobProgress(jobId, 75, 30000);
          } catch (updateJobProgressError) {
            logger.error(`Failed to update job progress for job ${jobId}: ${updateJobProgressError instanceof Error ? updateJobProgressError.message : String(updateJobProgressError)}`);
          }
        } catch (error) {
          logger.error(`Failed to execute task with model ${model}: ${error instanceof Error ? error.message : String(error)}`);
          throw error;
        }
      }

      // Process and format result if needed
      const formattedResult = typeof result === 'string' ? result : JSON.stringify(result);

      // Index the result in Retriv if possible
      try {
        // Use the indexDocuments function directly instead of a method on CodeSearchEngine
        await indexDocuments([
          {
            content: formattedResult,
            path: `job_${jobId}`,
            language: 'code'
          }
        ]);
        logger.info(`Successfully indexed result for job ${jobId} in Retriv`);
      } catch (error) {
        logger.warn(`Failed to index result in Retriv: ${error instanceof Error ? error.message : String(error)}`);
        // Continue even if indexing fails
      }

      // Complete the job (100%)
      try {
        void jobTracker.completeJob(jobId, [formattedResult]);
      } catch (completeJobError) {
        logger.error(`Failed to complete job ${jobId}: ${completeJobError instanceof Error ? completeJobError.message : String(completeJobError)}`);
      }
      logger.info(`Job ${jobId} completed successfully`);

      return formattedResult;
    } catch (error) {
      logger.error(`Error executing task for job ${jobId}:`, error);
      try {
        jobTracker = await getJobTracker();
        void jobTracker.failJob(jobId, error instanceof Error ? error.message : 'Unknown error during execution');
      } catch (failJobError) {
        logger.error(`Failed to fail job ${jobId}: ${failJobError instanceof Error ? failJobError.message : String(failJobError)}`);
      }
      throw error;
    }
  }

  /**
   * Execute a task with an Ollama model
   */
  async executeOllamaModel(model: string, task: string): Promise<string> {
    logger.info(`Executing task with Ollama model ${model}`);
    try {
      // Use the ollamaModule to execute the task
      return await ollamaModule.executeTask(model, task);
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
      // Use the lmStudioModule to execute the task
      // Consider using executeSpeculativeTask if speculative inference is desired
      return await lmStudioModule.executeTask(model, task);
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
      // Prioritize LM Studio if configured, then Ollama
      if (config.lmStudioEndpoint) {
        logger.debug(`Local model execution defaulting to LM Studio for model: ${model}`);
        return await this.executeLmStudioModel(model, task);
      } else if (config.ollamaEndpoint) {
        logger.debug(`Local model execution defaulting to Ollama for model: ${model}`);
        return await this.executeOllamaModel(model, task);
      } else {
        throw new Error('No local model endpoint configured for execution');
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
