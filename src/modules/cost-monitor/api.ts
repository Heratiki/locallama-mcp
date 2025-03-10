import axios from 'axios';
import { config } from '../../config/index.js';
import { logger } from '../../utils/logger.js';
import { ApiUsage, Model } from '../../types/index.js';
import { openRouterModule } from '../openrouter/index.js';
import { calculateTokenEstimates, modelContextWindows } from './utils.js';
import { RetrieverType } from './codeSearch.js';

/**
 * Helper method to get OpenRouter API usage
 * Extracted to a separate method for better error handling
 */
export async function getOpenRouterUsage(): Promise<ApiUsage> {
  // Default response structure for OpenRouter
  const defaultOpenRouterUsage: ApiUsage = {
    api: 'openrouter',
    tokenUsage: { prompt: 0, completion: 0, total: 0 },
    cost: { prompt: 0, completion: 0, total: 0 },
    timestamp: new Date().toISOString(),
  };
  
  // Check if API key is configured
  if (!config.openRouterApiKey) {
    logger.warn('OpenRouter API key not configured, returning default usage data');
    return defaultOpenRouterUsage;
  }
  
  try {
    // Query OpenRouter for usage statistics
    const response = await axios.get('https://openrouter.ai/api/v1/auth/credits', {
      headers: {
        'Authorization': `Bearer ${config.openRouterApiKey}`,
        'HTTP-Referer': 'https://locallama-mcp.local', // Required by OpenRouter
        'X-Title': 'LocalLama MCP'
      }
    });
    
    if (response.data) {
      logger.debug('Successfully retrieved OpenRouter usage data');
      
      // Extract credits information
      const creditsData = response.data;
      const creditsUsed = creditsData.used || 0;
      const creditsRemaining = creditsData.remaining || 0;
      const totalCredits = creditsUsed + creditsRemaining;
      
      const { promptTokens, completionTokens, estimatedTokensUsed } = calculateTokenEstimates(creditsUsed);
      
      return {
        api: 'openrouter',
        tokenUsage: {
          prompt: promptTokens,
          completion: completionTokens,
          total: estimatedTokensUsed,
        },
        cost: {
          prompt: creditsUsed * 0.67, // 2/3 of cost
          completion: creditsUsed * 0.33, // 1/3 of cost
          total: creditsUsed,
        },
        timestamp: new Date().toISOString(),
      };
    }
  } catch (error) {
    logger.warn('Failed to get OpenRouter usage statistics:', error);
    openRouterModule.handleOpenRouterError(error as Error);
  }
  
  // Return default if the API call fails
  return defaultOpenRouterUsage;
}

/**
 * Get a list of available models
 */
export async function getAvailableModels(): Promise<Model[]> {
  logger.debug('Getting available models');
  
  const models: Model[] = [];
  
  // Try to get models from LM Studio
  try {
    const lmStudioResponse = await axios.get(`${config.lmStudioEndpoint}/models`, {
      timeout: 5000 // 5 second timeout
    });
    
    if (lmStudioResponse.data && Array.isArray(lmStudioResponse.data.data)) {
      // Define an interface for the LM Studio model response
      interface LMStudioModel {
        id: string;
        name?: string;
        context_length?: number;
        contextWindow?: number;
        [key: string]: any; // For any other properties
      }
      
      const lmStudioModels = lmStudioResponse.data.data.map((model: LMStudioModel) => {
        // Try to determine context window size
        let contextWindow = 4096; // Default fallback
        
        // First, check if model data contains context_length 
        if (model.context_length && typeof model.context_length === 'number') {
          contextWindow = model.context_length;
        } else if (model.contextWindow && typeof model.contextWindow === 'number') {
          contextWindow = model.contextWindow;
        } else {
          // Fallback to known context window sizes
          const modelId = model.id.toLowerCase();
          for (const [key, value] of Object.entries(modelContextWindows)) {
            if (modelId.includes(key.toLowerCase())) {
              contextWindow = value as number;
              break;
            }
          }
        }
        
        return {
          id: model.id,
          name: model.id,
          provider: 'lm-studio',
          capabilities: {
            chat: true,
            completion: true,
          },
          costPerToken: {
            prompt: 0,
            completion: 0,
          },
          contextWindow
        };
      });
      models.push(...lmStudioModels);
      logger.debug(`Found ${lmStudioModels.length} models from LM Studio`);
    }
  } catch (error) {
    logger.warn('Failed to get models from LM Studio:', error);
  }
  
  // Try to get models from Ollama
  try {
    const ollamaResponse = await axios.get(`${config.ollamaEndpoint}/tags`, {
      timeout: 5000 // 5 second timeout
    });
    
    if (ollamaResponse.data && Array.isArray(ollamaResponse.data.models)) {
      // Define an interface for the Ollama model response
      interface OllamaModel {
        name: string;
        [key: string]: any; // For any other properties
      }
      
      // First, create basic model objects
      const ollamaModels = ollamaResponse.data.models.map((model: OllamaModel) => {
        // Start with default context window
        let contextWindow = 4096; // Default fallback
        
        // Check if we have a known context window size for this model
        const modelName = model.name.toLowerCase();
        for (const [key, value] of Object.entries(modelContextWindows)) {
          if (modelName.includes(key.toLowerCase())) {
            contextWindow = value as number;
            break;
          }
        }
        
        return {
          id: model.name,
          name: model.name,
          provider: 'ollama',
          capabilities: {
            chat: true,
            completion: true,
          },
          costPerToken: {
            prompt: 0,
            completion: 0,
          },
          contextWindow
        };
      });
      
      // Then, try to get detailed model info using Promise.all
      try {
        const modelDetailPromises = ollamaModels.map(async (model: Model) => {
          try {
            const response = await axios.get(`${config.ollamaEndpoint}/show`, {
              params: { name: model.id },
              timeout: 3000 // 3 second timeout for each model
            });
            
            if (response.data && response.data.parameters) {
              // Some Ollama models expose context_length or context_window
              const ctxLength = response.data.parameters.context_length ||
                                response.data.parameters.context_window;
                
              if (ctxLength && typeof ctxLength === 'number') {
                logger.debug(`Updated context window for Ollama model ${model.id}: ${ctxLength}`);
                model.contextWindow = ctxLength;
              }
            }
          } catch (detailError) {
            logger.debug(`Failed to get detailed info for Ollama model ${model.id}`);
          }
          return model;
        });
        
        // Wait for all model detail requests to complete (or fail)
        const updatedOllamaModels = await Promise.allSettled(modelDetailPromises);
        
        // Process the results
        const confirmedModels = updatedOllamaModels
          .filter((result): result is PromiseFulfilledResult<Model> => result.status === 'fulfilled')
          .map(result => result.value);
        
        models.push(...confirmedModels);
        logger.debug(`Found ${confirmedModels.length} models from Ollama`);
      } catch (batchError) {
        // If batch processing fails, just use the basic models
        logger.warn('Failed to get detailed info for Ollama models:', batchError);
        models.push(...ollamaModels);
      }
    }
  } catch (error) {
    logger.warn('Failed to get models from Ollama:', error);
  }
  
  // Try to get models from OpenRouter
  try {
    // Only try to get OpenRouter models if API key is configured
    if (config.openRouterApiKey) {
      // Initialize the OpenRouter module if needed
      if (Object.keys(openRouterModule.modelTracking.models).length === 0) {
        await openRouterModule.initialize();
      }
      
      // Get all models from OpenRouter
      const openRouterModels = await openRouterModule.getAvailableModels();
      
      // Add the models to our list
      models.push(...openRouterModels);
      
      logger.debug(`Added ${openRouterModels.length} models from OpenRouter`);
    }
  } catch (error) {
    logger.warn('Failed to get models from OpenRouter:', error);
  }
  
  // If no models were found, return some default models
  if (models.length === 0) {
    models.push({
      id: 'llama3',
      name: 'Llama 3',
      provider: 'local',
      capabilities: {
        chat: true,
        completion: true,
      },
      costPerToken: {
        prompt: 0,
        completion: 0,
      },
      contextWindow: 8192 // Default context window for Llama 3
    });
    logger.warn('No models found from any provider, using default model');
  } else {
    logger.info(`Found a total of ${models.length} models from all providers`);
  }
  
  return models;
}

/**
 * Get the available retriever types
 * @returns List of available retriever types
 */
export function getAvailableRetrieverTypes(): RetrieverType[] {
  return ['sparse', 'dense', 'hybrid'];
}

/**
 * Get information about the different retriever types
 * @returns Information about each retriever type
 */
export function getRetrieverTypeInfo(): Record<RetrieverType, { 
  name: string; 
  description: string; 
  bestFor: string[]; 
}> {
  return {
    'sparse': {
      name: 'Sparse Retriever (BM25)',
      description: 'Traditional text search using lexical matching. Fast and works well for technical content.',
      bestFor: [
        'Code search',
        'Keyword-based queries',
        'Exact matches',
        'Technical documentation'
      ]
    },
    'dense': {
      name: 'Dense Retriever (Semantic)',
      description: 'Uses deep learning models to understand the meaning of text. Better at finding conceptual matches.',
      bestFor: [
        'Natural language queries',
        'Concept-based search',
        'Finding similar content',
        'Handling synonyms'
      ]
    },
    'hybrid': {
      name: 'Hybrid Retriever',
      description: 'Combines sparse and dense retrieval for better overall results. More resource-intensive.',
      bestFor: [
        'Complex search needs',
        'When accuracy is critical',
        'Mixed technical and conceptual content',
        'When you need both exact and semantic matches'
      ]
    }
  };
}
