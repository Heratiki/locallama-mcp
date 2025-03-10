import { config } from '../../../config/index.js';
import { logger } from '../../../utils/logger.js';
import { IOpenRouterIntegration } from '../types.js';
import { openRouterModule } from '../../openrouter/index.js';

export class OpenRouterIntegration implements IOpenRouterIntegration {
  isOpenRouterConfigured(): boolean {
    return !!config.openRouterApiKey;
  }

  async clearOpenRouterTracking(): Promise<void> {
    logger.info('Clearing OpenRouter tracking data and forcing update...');
    await openRouterModule.clearTrackingData();
  }

  async getFreeModels(forceUpdate = false): Promise<any[]> {
    // Initialize OpenRouter module if needed
    if (Object.keys(openRouterModule.modelTracking.models).length === 0) {
      await openRouterModule.initialize();
    }
    
    logger.info(`Getting free models with forceUpdate=${forceUpdate}`);
    return await openRouterModule.getFreeModels(forceUpdate);
  }

  async benchmarkFreeModels(tasks: any[], config: any): Promise<any> {
    // Initialize OpenRouter module if needed
    if (Object.keys(openRouterModule.modelTracking.models).length === 0) {
      await openRouterModule.initialize();
    }
    
    // Convert tasks to the correct format for benchmarking
    const formattedTasks = tasks.map(task => ({
      taskId: task.task_id,
      task: task.task,
      contextLength: task.context_length,
      expectedOutputLength: task.expected_output_length || 0,
      complexity: task.complexity || 0.5,
      localModel: task.local_model,
      paidModel: task.paid_model,
    }));

    return await openRouterModule.benchmarkModels(formattedTasks, config);
  }

  async setModelPromptingStrategy(modelId: string, strategyConfig: any, successRate: number, qualityScore: number): Promise<void> {
    // Initialize OpenRouter module if needed
    if (Object.keys(openRouterModule.modelTracking.models).length === 0) {
      await openRouterModule.initialize();
    }
    
    await this.updatePromptingStrategy(modelId, strategyConfig, successRate, qualityScore);
  }

  async clearTrackingData(): Promise<void> {
    await openRouterModule.clearTrackingData();
  }

  async updatePromptingStrategy(modelId: string, strategyConfig: any, successRate: number, qualityScore: number): Promise<void> {
    await openRouterModule.updatePromptingStrategy(
      modelId,
      {
        systemPrompt: strategyConfig.systemPrompt,
        userPrompt: strategyConfig.userPrompt,
        assistantPrompt: strategyConfig.assistantPrompt,
        useChat: strategyConfig.useChat || true
      },
      successRate,
      qualityScore
    );
  }
}

const openRouterIntegration = new OpenRouterIntegration();

export { openRouterIntegration };
export const isOpenRouterConfigured = openRouterIntegration.isOpenRouterConfigured.bind(openRouterIntegration);
export const clearOpenRouterTracking = openRouterIntegration.clearOpenRouterTracking.bind(openRouterIntegration);
export const getFreeModels = openRouterIntegration.getFreeModels.bind(openRouterIntegration);
export const benchmarkFreeModels = openRouterIntegration.benchmarkFreeModels.bind(openRouterIntegration);
export const setModelPromptingStrategy = openRouterIntegration.setModelPromptingStrategy.bind(openRouterIntegration);
export const clearTrackingData = openRouterIntegration.clearTrackingData.bind(openRouterIntegration);
export const updatePromptingStrategy = openRouterIntegration.updatePromptingStrategy.bind(openRouterIntegration);
