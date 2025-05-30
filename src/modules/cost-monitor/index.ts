import axios from 'axios';
import { config } from '../../config/index.js';
import { logger } from '../../utils/logger.js';
import { ApiUsage, CostEstimate, Model } from '../../types/index.js';
import { openRouterModule } from '../openrouter/index.js';
import { getProviderFromModelId, modelContextWindows, calculateTokenEstimates } from './utils.js';
import { getOpenRouterUsage, getAvailableModels } from './api.js';

/**
 * Cost & Token Monitoring Module
 * 
 * This module is responsible for:
 * - Monitoring token usage and costs
 * - Estimating costs for tasks
 * - Retrieving available models
 */
export const costMonitor = {
  /**
   * Get usage statistics for a specific API
   */
  async getApiUsage(api: string): Promise<ApiUsage> {
    logger.debug(`Getting usage for API: ${api}`);
    
    let result: ApiUsage;
    
    // Handle different API types
    switch(api.toLowerCase()) {
      case 'openrouter':
        result = await this.getOpenRouterUsage();
        break;
      case 'lm-studio':
        // LM Studio is local, so cost is always 0
        result = {
          api: 'lm-studio',
          tokenUsage: { prompt: 0, completion: 0, total: 0 },
          cost: { prompt: 0, completion: 0, total: 0 },
          timestamp: new Date().toISOString(),
        };
        break;
      case 'ollama':
        // Ollama is local, so cost is always 0
        result = {
          api: 'ollama',
          tokenUsage: { prompt: 0, completion: 0, total: 0 },
          cost: { prompt: 0, completion: 0, total: 0 },
          timestamp: new Date().toISOString(),
        };
        break;
      default:
        // Default case for unknown APIs
        logger.debug(`No usage statistics available for API: ${api}, returning placeholder data`);
        result = {
          api,
          tokenUsage: { prompt: 1000000, completion: 500000, total: 1500000 },
          cost: { prompt: 0.01, completion: 0.02, total: 0.03 },
          timestamp: new Date().toISOString(),
        };
    }
    
    return result;
  },

  async getOpenRouterUsage(): Promise<ApiUsage> {
    return getOpenRouterUsage();
  },

  async getAvailableModels(): Promise<Model[]> {
    return getAvailableModels();
  },

  /**
   * Get free models from OpenRouter
   * @param forceUpdate Optional flag to force update of models regardless of timestamp
   */
  async getFreeModels(forceUpdate = false): Promise<Model[]> {
    logger.debug(`Getting free models (forceUpdate=${forceUpdate})`);
    
    try {
      // Only try to get OpenRouter models if API key is configured
      if (config.openRouterApiKey) {
        // Initialize the OpenRouter module if needed
        if (Object.keys(openRouterModule.modelTracking.models).length === 0) {
          await openRouterModule.initialize(forceUpdate);
        }
        
        // Get free models from OpenRouter with forceUpdate parameter
        const freeModels = await openRouterModule.getFreeModels(forceUpdate);
        
        // If no free models were found and we didn't already force an update, try clearing tracking data
        if (freeModels.length === 0 && !forceUpdate) {
          logger.info('No free models found, clearing tracking data and forcing update...');
          await openRouterModule.clearTrackingData();
          return await openRouterModule.getFreeModels();
        }
        
        // Log information about free models
        if (freeModels.length > 0) {
          logger.info(`Found ${freeModels.length} free models from OpenRouter`);
          
          // Group models by provider for better logging
          const providerGroups: Record<string, string[]> = {};
          for (const model of freeModels) {
            const provider = getProviderFromModelId(model.id);
            if (!providerGroups[provider]) {
              providerGroups[provider] = [];
            }
            providerGroups[provider].push(model.id);
          }
          
          // Log provider groups
          for (const [provider, models] of Object.entries(providerGroups)) {
            logger.debug(`Provider ${provider}: ${models.length} free models`);
          }
          
          // Log models with large context windows
          const largeContextModels = freeModels.filter(model =>
            model.contextWindow && model.contextWindow >= 32000
          );
          
          if (largeContextModels.length > 0) {
            logger.debug(`Found ${largeContextModels.length} free models with large context windows (32K+):`);
            for (const model of largeContextModels.slice(0, 5)) {
              logger.debug(`- ${model.id} (${model.contextWindow} tokens)`);
            }
            if (largeContextModels.length > 5) {
              logger.debug(`... and ${largeContextModels.length - 5} more large context models`);
            }
          }
        } else {
          logger.warn('No free models found from OpenRouter');
        }
        
        return freeModels;
      }
    } catch (error) {
      logger.warn('Failed to get free models from OpenRouter:', error);
    }
    
    return [];
  },
  
  /**
   * Extract provider name from model ID
   * This is a helper function to categorize models by provider
   */
  getProviderFromModelId(modelId: string): string {
    if (modelId.includes('openai')) return 'OpenAI';
    if (modelId.includes('anthropic')) return 'Anthropic';
    if (modelId.includes('claude')) return 'Anthropic';
    if (modelId.includes('google')) return 'Google';
    if (modelId.includes('gemini')) return 'Google';
    if (modelId.includes('mistral')) return 'Mistral';
    if (modelId.includes('meta')) return 'Meta';
    if (modelId.includes('llama')) return 'Meta';
    if (modelId.includes('deepseek')) return 'DeepSeek';
    if (modelId.includes('microsoft')) return 'Microsoft';
    if (modelId.includes('phi-3')) return 'Microsoft';
    if (modelId.includes('qwen')) return 'Qwen';
    if (modelId.includes('nvidia')) return 'NVIDIA';
    if (modelId.includes('openchat')) return 'OpenChat';
    return 'Other';
  },
  
  /**
   * Estimate the cost for a task
   */
  async estimateCost(params: {
    contextLength: number;
    outputLength?: number;
    model?: string;
  }): Promise<CostEstimate> {
    const { contextLength, outputLength = 0, model } = params;
    logger.debug(`Estimating cost for task with context length ${contextLength} and output length ${outputLength}`);
    
    // For local models, the cost is always 0
    const localCost = {
      prompt: 0,
      completion: 0,
      total: 0,
      currency: 'USD',
    };
    
    // For paid APIs, calculate the cost based on token counts
    // These are example rates for GPT-3.5-turbo
    let promptCost = contextLength * 0.000001;
    let completionCost = outputLength * 0.000002;
    
    // If a specific model was requested, try to get its actual cost
    if (model) {
      // Check if it's an OpenRouter model
      if (config.openRouterApiKey && openRouterModule.modelTracking.models[model]) {
        const openRouterModel = openRouterModule.modelTracking.models[model];
        promptCost = contextLength * openRouterModel.costPerToken.prompt;
        completionCost = outputLength * openRouterModel.costPerToken.completion;
        
        // If it's a free model, set costs to 0
        if (openRouterModel.isFree) {
          promptCost = 0;
          completionCost = 0;
        }
      }
    } else {
      // If no specific model was requested, check if there are free models available
      if (config.openRouterApiKey) {
        const freeModels = await this.getFreeModels();
        if (freeModels.length > 0) {
          // We have free models available, so we can set the paid cost to 0
          // This will make the recommendation favor the free models
          promptCost = 0;
          completionCost = 0;
        }
      }
    }
    
    const paidCost = {
      prompt: promptCost,
      completion: completionCost,
      total: promptCost + completionCost,
      currency: 'USD',
    };
    
    return {
      local: {
        cost: localCost,
        tokenCount: {
          prompt: contextLength,
          completion: outputLength,
          total: contextLength + outputLength,
        },
      },
      paid: {
        cost: paidCost,
        tokenCount: {
          prompt: contextLength,
          completion: outputLength,
          total: contextLength + outputLength,
        },
      },
      recommendation: paidCost.total > config.costThreshold ? 'local' : 'paid',
    };
  },
};