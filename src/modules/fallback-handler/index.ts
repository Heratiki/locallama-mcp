/* Required dependencies - used throughout the module */
import { logger } from '../../utils/logger.js';
import { config } from '../../config/index.js';
import { getProviderRegistry } from '../core/provider/index.js';
import { openRouterModule } from '../openrouter/index.js';

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
        } else if (costClass === 'paid') {
          const provider = getProviderRegistry().get(fallbackOption);
          if (!provider) {
            throw new Error(`No registered provider for fallback option: ${fallbackOption}`);
          }
          const models = await provider.listModels();
          const fallbackModelId = models.length > 0 ? models[0].id : config.defaultLocalModel;
          const result = await provider.executeTask(fallbackModelId, task, { timeoutMs: timeout });
          fallbackResult = {
            costClass: 'local' as const,
            model: fallbackModelId,
            success: true,
            text: result.content,
            message: `Fallback to ${fallbackOption} successful`,
          };
          return { success: true, fallbackUsed: true, result: fallbackResult };
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

  async checkServiceAvailability(service: string): Promise<boolean> {
    logger.debug(`Checking availability of service: ${service}`);

    try {
      if (service === 'paid-api') {
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
      }

      const provider = getProviderRegistry().get(service);
      if (!provider) {
        logger.debug(`Provider '${service}' not registered`);
        return false;
      }
      return provider.isAvailable();
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
      for (const p of getProviderRegistry().listByCostClass('local')) {
        if (await p.isAvailable()) return p.id;
      }
    }

    return null;
  },
};
