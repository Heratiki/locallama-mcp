import { config } from '../../../config/index.js';
import { logger } from '../../../utils/logger.js';
import { 
    IOpenRouterIntegration, 
    OpenRouterBenchmarkConfig, 
    OpenRouterBenchmarkResult, 
    OpenRouterModel, 
    PromptingStrategy,
    // TODO: Will be used in future benchmarking implementation
    // ModelBenchmarkResult 
} from './types.js';
import { openRouterModule } from '../../openrouter/index.js';
import { benchmarkService } from '../../decision-engine/services/benchmarkService.js';

export class OpenRouterIntegration implements IOpenRouterIntegration {
  /**
   * Check if OpenRouter API key is configured
   */
  isOpenRouterConfigured(): boolean {
    return !!config.openRouterApiKey;
  }
  
  /**
   * Execute a task via OpenRouter
   */
  async executeTask(model: string, task: string): Promise<string> {
    if (!this.isOpenRouterConfigured()) {
      throw new Error('OpenRouter API key not configured');
    }
    
    try {
      logger.info(`Executing task with OpenRouter model ${model}`);
      return await openRouterModule.executeTask(model, task);
    } catch (error: unknown) {
      logger.error(`Failed to execute task with OpenRouter model ${model}: ${(error as Error).message}`);
      throw error;
    }
  }
  
  /**
   * Clear OpenRouter tracking data
   */
  async clearTrackingData(): Promise<void> {
    logger.info('Clearing OpenRouter tracking data and forcing update...');
    await openRouterModule.clearTrackingData();
  }
  
  /**
   * Get list of free models from OpenRouter
   */
  async getFreeModels(forceUpdate = false): Promise<OpenRouterModel[]> {
    // Initialize OpenRouter module if needed
    if (Object.keys(openRouterModule.modelTracking.models).length === 0) {
      await openRouterModule.initialize();
    }
    
    logger.info(`Getting free models with forceUpdate=${forceUpdate}`);
    const freeModels = await openRouterModule.getFreeModels(forceUpdate);
    
    // Convert to the expected format - use type-safe properties
    return freeModels.map(model => ({
      id: model.id,
      name: model.name || model.id,
      isFree: true,
      contextWindow: model.contextWindow || 4096,
      provider: model.provider || 'openrouter',
      // These properties may not exist on the Model type, add with default value of 0
      inputCostPer1K: 0, 
      outputCostPer1K: 0
    }));
  }
  
  /**
   * Update prompting strategy for a model
   */
  async updatePromptingStrategy(
    modelId: string, 
    strategy: PromptingStrategy, 
    successRate: number, 
    qualityScore: number
  ): Promise<void> {
    // Initialize OpenRouter module if needed
    if (Object.keys(openRouterModule.modelTracking.models).length === 0) {
      await openRouterModule.initialize();
    }
    
    await openRouterModule.updatePromptingStrategy(
      modelId,
      {
        systemPrompt: strategy.systemPrompt,
        userPrompt: strategy.userPrompt,
        assistantPrompt: strategy.assistantPrompt,
        useChat: strategy.useChat
      },
      successRate,
      qualityScore
    );
  }
  
  /**
   * Benchmark free models available from OpenRouter
   */
  async benchmarkFreeModels(_benchmarkConfig: OpenRouterBenchmarkConfig): Promise<OpenRouterBenchmarkResult> {
    logger.info('Forwarding benchmark request to benchmarkService');
    // TODO: Implement proper benchmarking using _benchmarkConfig
    await benchmarkService.benchmarkFreeModels();
    
    // Return a simplified result since the full implementation is in benchmarkService
    return {
      results: {},
      summary: {
        bestQualityModel: 'unknown',
        bestSpeedModel: 'unknown',
        totalTime: 0,
        modelsCount: 0
      }
    };
  }
}

// Create singleton instance
const openRouterIntegration = new OpenRouterIntegration();

// Export the singleton instance
export { openRouterIntegration };

// Export individual methods for backward compatibility
export const isOpenRouterConfigured = openRouterIntegration.isOpenRouterConfigured.bind(openRouterIntegration);
export const executeTask = openRouterIntegration.executeTask.bind(openRouterIntegration);
export const clearTrackingData = openRouterIntegration.clearTrackingData.bind(openRouterIntegration);
export const getFreeModels = openRouterIntegration.getFreeModels.bind(openRouterIntegration);
export const updatePromptingStrategy = openRouterIntegration.updatePromptingStrategy.bind(openRouterIntegration);
export const benchmarkFreeModels = openRouterIntegration.benchmarkFreeModels.bind(openRouterIntegration);
