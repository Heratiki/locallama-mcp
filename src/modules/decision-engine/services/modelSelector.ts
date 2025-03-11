import { logger } from '../../../utils/logger.js';
import { costMonitor } from '../../cost-monitor/index.js';
import { modelsDbService } from './modelsDb.js';
import { openRouterModule } from '../../openrouter/index.js';
import { Model } from '../../../types/index.js';
import { ModelsDatabase, ModelPerformanceData, COMPLEXITY_THRESHOLDS } from '../types/index.js';
import { modelProfiles } from '../utils/modelProfiles.js';
import { isOpenRouterConfigured } from '../../api-integration/tools.js';

/**
 * Model Selector Service
 * Handles finding the best models based on task parameters
 */
export const modelSelector = {
  /**
   * Check if free models are available from OpenRouter
   */
  async hasFreeModels(): Promise<boolean> {
    // Only check if OpenRouter API key is configured
    if (!isOpenRouterConfigured()) {
      return false;
    }
    
    try {
      // Initialize OpenRouter module if needed
      if (Object.keys(openRouterModule.modelTracking.models).length === 0) {
        await openRouterModule.initialize();
      }
      
      // Get free models
      const freeModels = await costMonitor.getFreeModels();
      return freeModels.length > 0;
    } catch (error) {
      logger.error('Error checking for free models:', error);
      return false;
    }
  },

  /**
   * Get the best local model for a task
   * Uses metrics like success rate, quality, speed for selection
   */
  async getBestLocalModel(
    complexity: number,
    totalTokens: number
  ): Promise<Model | null> {
    try {
      // Get the models database
      const modelsDb = modelsDbService.getDatabase();
      
      // Get local models
      const localModels = await costMonitor.getAvailableModels();
      const filteredLocalModels = localModels.filter(model => 
        (model.provider === 'local' || model.provider === 'lm-studio' || model.provider === 'ollama') &&
        (model.contextWindow === undefined || model.contextWindow >= totalTokens)
      );
      
      if (filteredLocalModels.length === 0) {
        return null;
      }
      
      // Find the best model based on our database and complexity
      let bestModel: Model | null = null;
      let bestScore = 0;
      
      for (const model of filteredLocalModels) {
        // Calculate a base score for this model
        let score = 0;
        
        // Check if we have performance data for this model
        const modelData = modelsDb.models[model.id] as unknown as {
          benchmarkCount: number;
          successRate: number;
          qualityScore: number;
          avgResponseTime: number;
          complexityScore: number;
        };
        
        if (modelData && modelData.benchmarkCount > 0) {
          // Calculate score based on performance data
          // Weight factors based on importance - same as free model selection
          const successRateWeight = 0.3;
          const qualityScoreWeight = 0.4;
          const responseTimeWeight = 0.3; // Increased weight for speed
          const complexityMatchWeight = 0.1;
          
          // Success rate factor (0-1)
          score += modelData.successRate * successRateWeight;
          
          // Quality score factor (0-1)
          score += modelData.qualityScore * qualityScoreWeight;
          
          // Response time factor (0-1, inversely proportional)
          // Normalize response time: faster is better
          // Assume 15000ms (15s) is the upper bound for response time
          const responseTimeFactor = Math.max(0, 1 - (modelData.avgResponseTime / 15000));
          score += responseTimeFactor * responseTimeWeight;
          
          // Complexity match factor (0-1)
          // How well does the model's complexity score match the requested complexity?
          const complexityMatchFactor = 1 - Math.abs(modelData.complexityScore - complexity);
          score += complexityMatchFactor * complexityMatchWeight;
          
          logger.debug(`Local model ${model.id} has performance data: success=${modelData.successRate.toFixed(2)}, quality=${modelData.qualityScore.toFixed(2)}, time=${modelData.avgResponseTime}ms, score=${score.toFixed(2)}`);
          
          // For local models, we also consider system resource usage
          // This is a local-specific optimization
          if (model.provider === 'local' || model.provider === 'lm-studio') {
            // Prefer models that use fewer resources for the same quality
            // This is a heuristic based on model size
            if (model.id.toLowerCase().includes('1.5b') || 
                model.id.toLowerCase().includes('1b') ||
                model.id.toLowerCase().includes('3b')) {
              score += 0.1; // Small models use fewer resources
            }
          }
        } else {
          // No performance data, use heuristics based on model size
          
          // Prefer models with "instruct" in the name for instruction-following tasks
          if (model.id.toLowerCase().includes('instruct')) {
            score += 0.1;
          }
          
          // For complex tasks, prefer larger models
          if (complexity >= COMPLEXITY_THRESHOLDS.MEDIUM) {
            // Check for model size indicators in the name
            if (model.id.toLowerCase().includes('70b') || 
                model.id.toLowerCase().includes('65b') || 
                model.id.toLowerCase().includes('40b')) {
              score += 0.3; // Very large models
            } else if (model.id.toLowerCase().includes('13b') || 
                       model.id.toLowerCase().includes('14b') || 
                       model.id.toLowerCase().includes('7b') ||
                       model.id.toLowerCase().includes('8b')) {
              score += 0.2; // Medium-sized models
            } else if (model.id.toLowerCase().includes('3b') || 
                       model.id.toLowerCase().includes('1.5b') || 
                       model.id.toLowerCase().includes('1b')) {
              score += 0.1; // Smaller models
            }
          } else {
            // For simpler tasks, prefer smaller, more efficient models
            if (model.id.toLowerCase().includes('1.5b') || 
                model.id.toLowerCase().includes('1b') ||
                model.id.toLowerCase().includes('3b')) {
              score += 0.3; // Smaller models are more efficient
            } else if (model.id.toLowerCase().includes('7b') || 
                       model.id.toLowerCase().includes('8b')) {
              score += 0.2; // Medium models
            } else {
              score += 0.1; // Larger models
            }
          }
          
          logger.debug(`Local model ${model.id} has no performance data, using heuristics: score=${score.toFixed(2)}`);
        }
        
        // Update best model if this one has a higher score
        if (score > bestScore) {
          bestScore = score;
          bestModel = model;
        }
      }
      
      // If we couldn't find a best model based on scores, fall back to default
      if (!bestModel && filteredLocalModels.length > 0) {
        bestModel = filteredLocalModels[0];
      }
      
      logger.debug(`Selected best local model for complexity ${complexity.toFixed(2)} and ${totalTokens} tokens: ${bestModel?.id}`);
      return bestModel;
    } catch (error) {
      logger.error('Error getting best local model:', error);
      return null;
    }
  },

  /**
   * Get the best free model for a task
   */
  async getBestFreeModel(
    complexity: number,
    totalTokens: number
  ): Promise<Model | null> {
    // Only check if OpenRouter API key is configured
    if (!isOpenRouterConfigured()) {
      return null;
    }
    
    try {
      // Get free models
      const freeModels = await costMonitor.getFreeModels();
      if (freeModels.length === 0) {
        return null;
      }
      
      // Filter models that can handle the context length
      const suitableModels = freeModels.filter(model => {
        return model.contextWindow && model.contextWindow >= totalTokens;
      });
      
      if (suitableModels.length === 0) {
        return null;
      }
      
      // Get the models database
      const modelsDb = modelsDbService.getDatabase();
      
      // Find the best model based on our database and complexity
      let bestModel: Model | null = null;
      let bestScore = 0;
      
      for (const model of suitableModels) {
        // Calculate a base score for this model
        let score = 0;
        
        // Check if we have performance data for this model
        const modelData = modelsDb.models[model.id] as unknown as {
          benchmarkCount: number;
          successRate: number;
          qualityScore: number;
          avgResponseTime: number;
          complexityScore: number;
        };
        
        if (modelData && modelData.benchmarkCount > 0) {
          // Calculate score based on performance data
          // Weight factors based on importance
          const successRateWeight = 0.4;  // Increased weight for success rate
          const qualityScoreWeight = 0.4;
          const responseTimeWeight = 0.3; // Increased weight for speed
          const complexityMatchWeight = 0.1;
          
          // Success rate factor (0-1)
          score += modelData.successRate * successRateWeight;
          
          // Quality score factor (0-1)
          score += modelData.qualityScore * qualityScoreWeight;
          
          // Response time factor (0-1, inversely proportional)
          // Normalize response time: faster is better
          // Assume 15000ms (15s) is the upper bound for response time
          const responseTimeFactor = Math.max(0, 1 - (modelData.avgResponseTime / 15000));
          score += responseTimeFactor * responseTimeWeight;
          
          // Complexity match factor (0-1)
          // How well does the model's complexity score match the requested complexity?
          const complexityMatchFactor = 1 - Math.abs(modelData.complexityScore - complexity);
          score += complexityMatchFactor * complexityMatchWeight;
          
          // Boost score for models with high benchmark counts (more reliable data)
          if (modelData.benchmarkCount >= 3) {
            score += 0.1;
          }
          
          logger.debug(`Model ${model.id} has performance data: success=${modelData.successRate.toFixed(2)}, quality=${modelData.qualityScore.toFixed(2)}, time=${modelData.avgResponseTime}ms, benchmarks=${modelData.benchmarkCount}, score=${score.toFixed(2)}`);
        } else {
          // No performance data, use heuristics
          
          // Since we haven't benchmarked free models yet, give them a higher base score
          // This ensures they get selected more often for benchmarking
          score += 0.3;
          
          // Prefer models with "instruct" in the name for instruction-following tasks
          if (model.id.toLowerCase().includes('instruct')) {
            score += 0.1;
          }
          
          // Prefer models with larger context windows for complex tasks
          if (complexity >= COMPLEXITY_THRESHOLDS.MEDIUM) {
            score += (model.contextWindow || 0) / 100000; // Normalize context window
          }
          
          // Prefer models from known providers
          if (model.id.toLowerCase().includes('mistral') ||
              model.id.toLowerCase().includes('llama') ||
              model.id.toLowerCase().includes('gemini') ||
              model.id.toLowerCase().includes('phi-3') ||
              model.id.toLowerCase().includes('google') ||
              model.id.toLowerCase().includes('meta') ||
              model.id.toLowerCase().includes('microsoft') ||
              model.id.toLowerCase().includes('deepseek')) {
            score += 0.2;
          }
          
          logger.debug(`Model ${model.id} has no performance data, using heuristics: score=${score.toFixed(2)}`);
        }
        
        // Update best model if this one has a higher score
        if (score > bestScore) {
          bestScore = score;
          bestModel = model;
        }
      }
      // If we couldn't find a best model based on scores, fall back to context window and other heuristics
      if (!bestModel && suitableModels.length > 0) {
        if (complexity >= COMPLEXITY_THRESHOLDS.MEDIUM) {
          // For medium to complex tasks, prefer models with larger context windows
          // and from well-known providers
          const preferredProviders = ['google', 'meta-llama', 'mistralai', 'deepseek', 'microsoft'];
          
          // First try to find a model from a preferred provider
          const preferredModels = suitableModels.filter(model =>
            preferredProviders.some(provider => model.id.toLowerCase().includes(provider))
          );
          
          if (preferredModels.length > 0) {
            // Sort by context window size (larger is better for complex tasks)
            bestModel = preferredModels.reduce((best, current) => {
              return (!best || (current.contextWindow || 0) > (best.contextWindow || 0)) ? current : best;
            }, null as Model | null);
          } else {
            // Fall back to any model with the largest context window
            bestModel = suitableModels.reduce((best, current) => {
              return (!best || (current.contextWindow || 0) > (best.contextWindow || 0)) ? current : best;
            }, null as Model | null);
          }
        } else {
          // For simple tasks, prefer models with "instruct" in the name
          const instructModels = suitableModels.filter(model =>
            model.id.toLowerCase().includes('instruct')
          );
          
          if (instructModels.length > 0) {
            bestModel = instructModels[0];
          } else {
            // Fall back to any model
            bestModel = suitableModels[0];
          }
        }
      }
      
      logger.debug(`Selected best free model for complexity ${complexity.toFixed(2)} and ${totalTokens} tokens: ${bestModel?.id}`);
      return bestModel;
    } catch (error) {
      logger.error('Error getting best free model:', error);
      return null;
    }
  }
};