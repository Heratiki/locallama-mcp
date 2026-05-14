import { logger } from '../../../utils/logger.js';
import { config } from '../../../config/index.js';
import { getJobTracker } from '../../decision-engine/services/jobTracker.js';
import { openRouterModule } from '../../openrouter/index.js';
import { ollamaModule } from '../../ollama/index.js'; // Added import
import { lmStudioModule } from '../../lm-studio/index.js'; // Added import
import { ITaskExecutor } from '../types.js';
import { indexDocuments } from '../../cost-monitor/codeSearchEngine.js';
import { ProviderRegistry } from '../../core/provider-registry';

const providerRegistry = new ProviderRegistry();

// Register providers (example)
providerRegistry.register(new OpenRouterProvider());
providerRegistry.register(new LocalModelProvider());

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
      const provider = providerRegistry.getProviderForModel(model);
      if (!provider) {
        throw new Error(`No provider found for model: ${model}`);
      }
      result = await provider.executeTask(model, task, jobId);

      // Update progress to 75% after successful API call
      try {
        void jobTracker.updateJobProgress(jobId, 75, 30000);
      } catch (updateJobProgressError) {
        logger.error(`Failed to update job progress for job ${jobId}: ${updateJobProgressError instanceof Error ? updateJobProgressError.message : String(updateJobProgressError)}`);
      }
      logger.info(`Job ${jobId} completed successfully`);

      return result;
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
