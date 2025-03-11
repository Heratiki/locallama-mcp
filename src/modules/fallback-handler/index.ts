import { logger } from '../../utils/logger.js';
import { config } from '../../config/index.js';
import axios from 'axios';
import { openRouterModule } from '../openrouter/index.js';

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
  }): Promise<{ success: boolean; fallbackUsed: boolean; result?: any }> {
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
                provider: 'paid',
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
                  provider: 'paid',
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
            `${endpoint}/chat/completions` : `${endpoint}/chat`;
          
          try {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), timeout);
            
            const response = await axios.post(
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
            let responseText;
            if (fallbackOption === 'lm-studio') {
              responseText = response.data.choices[0].message.content;
            } else {
              responseText = response.data.message.content;
            }
            
            fallbackResult = {
              provider: 'local',
              model: fallbackModelId,
              success: true,
              text: responseText,
              message: `Fallback to ${fallbackOption} successful`,
            };
          } catch (apiError) {
            throw new Error(`${fallbackOption} API fallback failed: ${apiError}`);
          }
        }
      } else {
        // For operations without a specific task, just return that fallback is available
        fallbackResult = {
          provider: provider === 'local' ? 'paid' : 'local',
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
      let testPayload;
      
      // Configure the API call based on the service
      switch (service) {
        case 'lm-studio':
          // Check if LM Studio is available
          endpoint = config.lmStudioEndpoint;
          testEndpoint = `${endpoint}/models`;
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
            logger.error('Error checking OpenRouter availability:', error);
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
};