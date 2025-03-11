import { costMonitor } from '../../cost-monitor/index.js';
import { openRouterModule } from '../../openrouter/index.js';
import { ICostEstimator, CostEstimationParams, CostEstimationResult, FreeModel, ModelCostInfo } from './types.js';
import { config } from '../../../config/index.js';
import { logger } from '../../../utils/logger.js';

export class CostEstimator implements ICostEstimator {
  /**
   * Estimate the cost for a task based on token count
   */
  async estimateCost(params: CostEstimationParams): Promise<CostEstimationResult> {
    logger.info(`Estimating cost for context length: ${params.contextLength}, output length: ${params.outputLength || 0}`);
    
    const costEstimate = await costMonitor.estimateCost({
      contextLength: params.contextLength,
      outputLength: params.outputLength || 0,
      model: params.model
    });
    
    const costThreshold = config.costThreshold || 0.1;
    
    // Adapt the cost estimate format to match our expected ModelCostEstimate format
    const localCost = {
      cost: {
        input: costEstimate.local.cost.prompt || 0,
        output: costEstimate.local.cost.completion || 0,
        total: costEstimate.local.cost.total || 0
      },
      model: 'local-default',
      provider: 'local'
    };
    
    const paidCost = {
      cost: {
        input: costEstimate.paid.cost.prompt || 0,
        output: costEstimate.paid.cost.completion || 0,
        total: costEstimate.paid.cost.total || 0
      },
      model: params.model || 'gpt-4',
      provider: 'openrouter'
    };
    
    // Create a free cost estimate as it doesn't exist in the original format
    const freeCost = {
      cost: {
        input: 0,
        output: 0,
        total: 0
      },
      model: 'free-default',
      provider: 'free'
    };
    
    return {
      local: localCost,
      paid: paidCost,
      free: freeCost,
      recommendation: costEstimate.recommendation || 'local',
      costThreshold: costThreshold,
      exceedsThreshold: costEstimate.paid.cost.total > costThreshold
    };
  }
  
  /**
   * Get list of free models that have no associated costs
   */
  async getFreeModels(forceUpdate = false): Promise<FreeModel[]> {
    // Check if OpenRouter is available
    if (!config.openRouterApiKey) {
      logger.info('OpenRouter API key not configured, returning empty list of free models');
      return [];
    }
    
    try {
      // Initialize OpenRouter if needed
      if (Object.keys(openRouterModule.modelTracking.models).length === 0) {
        await openRouterModule.initialize();
      }
      
      const freeModels = await openRouterModule.getFreeModels(forceUpdate);
      
      // Convert to the expected format
      return freeModels.map(model => ({
        id: model.id,
        name: model.name || model.id,
        provider: model.provider || 'openrouter',
        maxContextLength: model.contextWindow || 4096,
        hasRestrictions: false, // Default since restriction property doesn't exist
        restrictions: undefined // Default since restriction property doesn't exist
      }));
    } catch (error) {
      logger.error(`Error getting free models: ${error}`);
      return [];
    }
  }
  
  /**
   * Get cost information for a specific model
   */
  async getModelCosts(modelId: string): Promise<ModelCostInfo | null> {
    try {
      // Handle OpenRouter models
      if (modelId.startsWith('openrouter:')) {
        const actualModelId = modelId.replace('openrouter:', '');
        
        // Initialize OpenRouter if needed
        if (Object.keys(openRouterModule.modelTracking.models).length === 0) {
          await openRouterModule.initialize();
        }
        
        const model = openRouterModule.modelTracking.models[actualModelId];
        if (model) {
          // Default values since these properties might not exist on the model
          return {
            inputCostPer1K: 0,
            outputCostPer1K: 0,
            maxContextLength: model.contextWindow || 4096,
            provider: 'openrouter'
          };
        }
      }
      
      // Since costMonitor doesn't have getModelCosts, implement a basic version
      // This is a placeholder - in a real implementation, you would need to properly implement this
      logger.info(`Getting cost info for model ${modelId}`);
      
      // Default values for model cost
      return {
        inputCostPer1K: modelId.includes('gpt-4') ? 0.03 : 0.001,
        outputCostPer1K: modelId.includes('gpt-4') ? 0.06 : 0.002,
        maxContextLength: modelId.includes('gpt-4') ? 8192 : 4096,
        provider: modelId.includes('gpt') ? 'openai' : 
                 modelId.includes('claude') ? 'anthropic' : 
                 modelId.includes('llama') ? 'meta' : 'unknown'
      };
    } catch (error) {
      logger.error(`Error getting cost info for model ${modelId}: ${error}`);
      return null;
    }
  }
}

// Create singleton instance
const costEstimator = new CostEstimator();

// Export the singleton instance
export { costEstimator };

// Export individual methods for backward compatibility
export const estimateCost = costEstimator.estimateCost.bind(costEstimator);
export const getFreeModels = costEstimator.getFreeModels.bind(costEstimator);
export const getModelCosts = costEstimator.getModelCosts.bind(costEstimator);

