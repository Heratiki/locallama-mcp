/* Required dependencies - used throughout the module */
import { logger } from '../../utils/logger.js';
import { config } from '../../config/index.js';
import axios from 'axios';
import { openRouterModule } from '../openrouter/index.js';

// Define types for API responses
interface LMStudioResponse {
  choices: Array<{
    message: {
      content: string;
    };
  }>;
}

interface OllamaResponse {
  message: {
    content: string;
  };
}

interface FallbackResult {
  provider: 'local' | 'paid';
  model?: string;
  success: boolean;
  text?: string;
  usage?: unknown;
  message: string;
  service?: string;
}

/**
 * Fallback & Error Handling Module
 * 
 * This module is responsible for handling errors and providing fallback
 * mechanisms when services are unavailable or fail.
 */
export const fallbackHandler = {
  /**
   * Handle an error with the appropriate fallback strategy
   */
  async handleError(error: Error, context: {
    operation: string;
    provider: 'local' | 'paid';
    fallbackAvailable: boolean;
    task?: string;
    modelId?: string;
    timeout?: number;
  }): Promise<{ success: boolean; fallbackUsed: boolean; result?: FallbackResult }> {
    const { operation, provider, fallbackAvailable, task, modelId, timeout } = context;
    
    logger.error(`Error during ${operation} with provider ${provider}:`, error);
    
    // If fallback is not available, just return the error
    if (!fallbackAvailable) {
      logger.warn(`No fallback available for ${operation}`);
      return {
        success: false,
        fallbackUsed: false,
      };
    }
    
    // Attempt fallback
    try {
      logger.info(`Attempting fallback for ${operation} from ${provider} to ${provider === 'local' ? 'paid' : 'local'}`);
      
      // Get the best fallback option based on the current provider
      const fallbackOption = await this.getBestFallbackOption(provider);
      
      if (!fallbackOption) {
        logger.warn(`No fallback options available for ${provider}`);
        return {
          success: false,
          fallbackUsed: false,
        };
      }
      
      logger.info(`Selected fallback option: ${fallbackOption}`);
      
      // Execute the fallback strategy based on the operation and available options
      let fallbackResult;
      
      if (task && timeout) {
        // If we have a task and timeout, we can try to complete the task with the fallback service
        if (provider === 'local' && fallbackOption === 'paid-api') {
          // Fallback from local to paid API (e.g., OpenRouter)
          if (modelId) {
            // If we have a model ID, use it
            const openRouterResult = await openRouterModule.callOpenRouterApi(
              modelId,
              task,
              timeout
            );
            
            if (openRouterResult.success) {
              fallbackResult = {
                provider: 'paid' as const,
                success: true,
                text: openRouterResult.text,
                usage: openRouterResult.usage,
                message: 'Fallback to OpenRouter API successful',
              };
            } else {
              throw new Error(`OpenRouter API fallback failed: ${openRouterResult.error}`);
            }
          } else {
            // If we don't have a model ID, use any available model
            const freeModels = await openRouterModule.getFreeModels();
            if (freeModels.length > 0) {
              const bestModel = freeModels[0];
              const openRouterResult = await openRouterModule.callOpenRouterApi(
                bestModel.id,
                task,
                timeout
              );
              
              if (openRouterResult.success) {
                fallbackResult = {
                  provider: 'paid' as const,
                  model: bestModel.id,
                  success: true,
                  text: openRouterResult.text,
                  usage: openRouterResult.usage,
                  message: `Fallback to OpenRouter API (model: ${bestModel.id}) successful`,
                };
              } else {
                throw new Error(`OpenRouter API fallback failed: ${openRouterResult.error}`);
              }
            } else {
              throw new Error('No free models available for fallback');
            }
          }
        } else if (provider === 'paid' && (fallbackOption === 'lm-studio' || fallbackOption === 'ollama')) {
          // Fallback from paid API to local LLM
          const endpoint = fallbackOption === 'lm-studio' ? 
            config.lmStudioEndpoint : config.ollamaEndpoint;
          
          const fallbackModelId = fallbackOption === 'lm-studio' ? 
            'openhermes' : config.defaultLocalModel;
          
          const apiEndpoint = fallbackOption === 'lm-studio' ? 
            `${this.constructLMStudioUrl(endpoint, 'chat/completions')}` : `${endpoint}/chat`;
          
          try {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), timeout);
            
            const response = await axios.post<LMStudioResponse | OllamaResponse>(
              apiEndpoint,
              {
                model: fallbackModelId,
                messages: [
                  { role: 'system', content: 'You are a helpful assistant.' },
                  { role: 'user', content: task }
                ],
                temperature: 0.7,
                max_tokens: 1000,
                stream: false,
              },
              {
                signal: controller.signal,
                headers: {
                  'Content-Type': 'application/json',
                },
              }
            );
            
            clearTimeout(timeoutId);
            
            // Handle response format differences between LM Studio and Ollama
            let responseText = '';
            if (fallbackOption === 'lm-studio') {
              const lmStudioResponse = response.data as LMStudioResponse;
              responseText = lmStudioResponse.choices[0].message.content;
            } else {
              const ollamaResponse = response.data as OllamaResponse;
              responseText = ollamaResponse.message.content;
            }
            
            fallbackResult = {
              provider: 'local' as const,
              model: fallbackModelId,
              success: true,
              text: responseText,
              message: `Fallback to ${fallbackOption} successful`,
            };

            return {
              success: true,
              fallbackUsed: true,
              result: fallbackResult
            };

          } catch (apiError) {
            const errorMessage = apiError instanceof Error ? apiError.message : String(apiError);
            throw new Error(`${fallbackOption} API fallback failed: ${errorMessage}`);
          }
        }
      } else {
        // For operations without a specific task, just return that fallback is available
        const newProvider: 'local' | 'paid' = provider === 'local' ? 'paid' : 'local';
        fallbackResult = {
          provider: newProvider,
          service: fallbackOption,
          success: true,
          message: `Fallback to ${fallbackOption} available`,
        };
      }
      
      logger.info(`Fallback successful for ${operation}`);
      
      return {
        success: true,
        fallbackUsed: true,
        result: fallbackResult,
      };
    } catch (fallbackError) {
      logger.error(`Fallback failed for ${operation}:`, fallbackError);
      
      return {
        success: false,
        fallbackUsed: true,
      };
    }
  },
  
  /**
   * Check if a service is available
   */
  async checkServiceAvailability(service: 'lm-studio' | 'ollama' | 'paid-api'): Promise<boolean> {
    logger.debug(`Checking availability of service: ${service}`);
    
    try {
      let endpoint;
      let testEndpoint;
      
      // Configure the API call based on the service
      switch (service) {
        case 'lm-studio':
          // Check if LM Studio is available
          endpoint = config.lmStudioEndpoint;
          testEndpoint = this.constructLMStudioUrl(endpoint, 'models');
          break;
        
        case 'ollama':
          // Check if Ollama is available
          endpoint = config.ollamaEndpoint;
          testEndpoint = `${endpoint}/tags`;
          break;
        
        case 'paid-api':
          // For OpenRouter, we check if the API key is configured
          if (!config.openRouterApiKey) {
            logger.warn('OpenRouter API key not configured');
            return false;
          }
          
          // Also check if we can actually connect to the service
          try {
            // Initialize OpenRouter module if needed
            if (Object.keys(openRouterModule.modelTracking.models).length === 0) {
              await openRouterModule.initialize();
            }
            
            const freeModels = await openRouterModule.getFreeModels();
            return freeModels.length > 0;
          } catch (error) {
            if (error instanceof Error) {
              logger.error('Error checking OpenRouter availability:', error);
            } else {
              logger.error('Unknown error checking OpenRouter availability');
            }
            return false;
          }
        
        default:
          return false;
      }
      
      // For local services, perform a basic API health check
      const timeout = 5000; // 5 second timeout for health checks
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeout);
      
      const response = await axios.get(testEndpoint, {
        signal: controller.signal,
        headers: {
          'Accept': 'application/json',
        },
      });
      
      clearTimeout(timeoutId);
      
      // If we got a successful response, the service is available
      return response.status >= 200 && response.status < 300;
    } catch (error) {
      logger.debug(`Service ${service} is not available:`, error);
      return false;
    }
  },
  
  /**
   * Get the best available fallback option
   */
  async getBestFallbackOption(currentProvider: 'local' | 'paid'): Promise<string | null> {
    logger.debug(`Getting best fallback option for provider: ${currentProvider}`);
    
    if (currentProvider === 'local') {
      // If current provider is local, fallback to paid API
      const paidApiAvailable = await this.checkServiceAvailability('paid-api');
      if (paidApiAvailable) {
        return 'paid-api';
      }
    } else {
      // If current provider is paid, fallback to local LLMs
      // Try LM Studio first as it tends to have better models
      const lmStudioAvailable = await this.checkServiceAvailability('lm-studio');
      if (lmStudioAvailable) {
        return 'lm-studio';
      }
      
      const ollamaAvailable = await this.checkServiceAvailability('ollama');
      if (ollamaAvailable) {
        return 'ollama';
      }
    }
    
    // No fallback available
    return null;
  },

  /**
   * Properly construct an LM Studio API URL to avoid duplicate /v1/ paths
   */
  constructLMStudioUrl(endpoint: string, path: string): string {
    // Ensure we don't duplicate /v1/ in the URL
    const baseUrl = endpoint.endsWith('/v1') ? 
      endpoint : 
      `${endpoint}/v1`;
    
    return `${baseUrl}/${path}`;
  },
};