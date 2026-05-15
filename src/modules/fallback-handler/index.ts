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
  costClass: 'local' | 'paid';
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
  async handleError(error: Error, context: {
    operation: string;
    costClass: 'local' | 'paid';
    fallbackAvailable: boolean;
    task?: string;
    modelId?: string;
    timeout?: number;
  }): Promise<{ success: boolean; fallbackUsed: boolean; result?: FallbackResult }> {
    const { operation, costClass, fallbackAvailable, task, modelId, timeout } = context;

    logger.error(`Error during ${operation} with costClass ${costClass}:`, error);

    if (!fallbackAvailable) {
      logger.warn(`No fallback available for ${operation}`);
      return { success: false, fallbackUsed: false };
    }

    try {
      logger.info(`Attempting fallback for ${operation} from ${costClass} to ${costClass === 'local' ? 'paid' : 'local'}`);

      const fallbackOption = await this.getBestFallbackOption(costClass);

      if (!fallbackOption) {
        logger.warn(`No fallback options available for ${costClass}`);
        return { success: false, fallbackUsed: false };
      }

      logger.info(`Selected fallback option: ${fallbackOption}`);

      let fallbackResult;

      if (task && timeout) {
        if (costClass === 'local' && fallbackOption === 'paid-api') {
          if (modelId) {
            const openRouterResult = await openRouterModule.callOpenRouterApi(modelId, task, timeout);

            if (openRouterResult.success) {
              fallbackResult = {
                costClass: 'paid' as const,
                success: true,
                text: openRouterResult.text,
                usage: openRouterResult.usage,
                message: 'Fallback to OpenRouter API successful',
              };
            } else {
              throw new Error(`OpenRouter API fallback failed: ${openRouterResult.error}`);
            }
          } else {
            const freeModels = await openRouterModule.getFreeModels();
            if (freeModels.length > 0) {
              const bestModel = freeModels[0];
              const openRouterResult = await openRouterModule.callOpenRouterApi(bestModel.id, task, timeout);

              if (openRouterResult.success) {
                fallbackResult = {
                  costClass: 'paid' as const,
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
        } else if (costClass === 'paid' && (fallbackOption === 'lm-studio' || fallbackOption === 'ollama')) {
          const endpoint = fallbackOption === 'lm-studio' ? config.lmStudioEndpoint : config.ollamaEndpoint;
          const fallbackModelId = fallbackOption === 'lm-studio' ? 'openhermes' : config.defaultLocalModel;
          const apiEndpoint = fallbackOption === 'lm-studio'
            ? `${this.constructLMStudioUrl(endpoint, 'chat/completions')}`
            : `${endpoint}/chat`;

          try {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), timeout);

            const response = await axios.post<LMStudioResponse | OllamaResponse>(
              apiEndpoint,
              {
                model: fallbackModelId,
                messages: [
                  { role: 'system', content: 'You are a helpful assistant.' },
                  { role: 'user', content: task },
                ],
                temperature: 0.7,
                max_tokens: 1000,
                stream: false,
              },
              { signal: controller.signal, headers: { 'Content-Type': 'application/json' } },
            );

            clearTimeout(timeoutId);

            let responseText = '';
            if (fallbackOption === 'lm-studio') {
              const lmStudioResponse = response.data as LMStudioResponse;
              responseText = lmStudioResponse.choices[0].message.content;
            } else {
              const ollamaResponse = response.data as OllamaResponse;
              responseText = ollamaResponse.message.content;
            }

            fallbackResult = {
              costClass: 'local' as const,
              model: fallbackModelId,
              success: true,
              text: responseText,
              message: `Fallback to ${fallbackOption} successful`,
            };

            return { success: true, fallbackUsed: true, result: fallbackResult };
          } catch (apiError) {
            const errorMessage = apiError instanceof Error ? apiError.message : String(apiError);
            throw new Error(`${fallbackOption} API fallback failed: ${errorMessage}`);
          }
        }
      } else {
        const newCostClass: 'local' | 'paid' = costClass === 'local' ? 'paid' : 'local';
        fallbackResult = {
          costClass: newCostClass,
          service: fallbackOption,
          success: true,
          message: `Fallback to ${fallbackOption} available`,
        };
      }

      logger.info(`Fallback successful for ${operation}`);
      return { success: true, fallbackUsed: true, result: fallbackResult };
    } catch (fallbackError) {
      logger.error(`Fallback failed for ${operation}:`, fallbackError);
      return { success: false, fallbackUsed: true };
    }
  },

  async checkServiceAvailability(service: 'lm-studio' | 'ollama' | 'paid-api'): Promise<boolean> {
    logger.debug(`Checking availability of service: ${service}`);

    try {
      let testEndpoint: string;

      switch (service) {
        case 'lm-studio':
          testEndpoint = this.constructLMStudioUrl(config.lmStudioEndpoint, 'models');
          break;
        case 'ollama':
          testEndpoint = `${config.ollamaEndpoint}/tags`;
          break;
        case 'paid-api':
          if (!config.openRouterApiKey) {
            logger.warn('OpenRouter API key not configured');
            return false;
          }
          try {
            if (Object.keys(openRouterModule.modelTracking.models).length === 0) {
              await openRouterModule.initialize();
            }
            const freeModels = await openRouterModule.getFreeModels();
            return freeModels.length > 0;
          } catch (error) {
            logger.error('Error checking OpenRouter availability:', error instanceof Error ? error : String(error));
            return false;
          }
        default:
          return false;
      }

      const timeout = 5000;
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeout);

      const response = await axios.get(testEndpoint, {
        signal: controller.signal,
        headers: { Accept: 'application/json' },
      });

      clearTimeout(timeoutId);
      return response.status >= 200 && response.status < 300;
    } catch (error) {
      logger.debug(`Service ${service} is not available:`, error);
      return false;
    }
  },

  async getBestFallbackOption(costClass: 'local' | 'paid'): Promise<string | null> {
    logger.debug(`Getting best fallback option for costClass: ${costClass}`);

    if (costClass === 'local') {
      const paidApiAvailable = await this.checkServiceAvailability('paid-api');
      if (paidApiAvailable) return 'paid-api';
    } else {
      const lmStudioAvailable = await this.checkServiceAvailability('lm-studio');
      if (lmStudioAvailable) return 'lm-studio';

      const ollamaAvailable = await this.checkServiceAvailability('ollama');
      if (ollamaAvailable) return 'ollama';
    }

    return null;
  },

  constructLMStudioUrl(endpoint: string, path: string): string {
    const baseUrl = endpoint.endsWith('/v1') ? endpoint : `${endpoint}/v1`;
    return `${baseUrl}/${path}`;
  },
};
