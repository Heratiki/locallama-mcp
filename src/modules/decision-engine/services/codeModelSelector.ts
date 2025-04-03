import { logger } from '../../../utils/logger.js';
import { costMonitor } from '../../cost-monitor/index.js';
import { openRouterModule } from '../../openrouter/index.js';
// Import types only to avoid circular dependency
import type { ModelPerformanceAnalysis } from '../types/index.js';
import { CodeSubtask } from '../types/codeTask.js';
import { Model } from '../../../types/index.js';
import { COMPLEXITY_THRESHOLDS } from '../types/index.js';
import { config } from '../../../config/index.js';

/**
 * Interface for the model performance tracker methods
 * Used to avoid circular dependencies
 */
export type ModelPerformanceTracker = {
  analyzePerformanceByComplexity: (min: number, max: number) => ModelPerformanceAnalysis;
  getModelStats: (modelId: string) => {
    complexityScore?: number;
    successRate?: number;
    qualityScore?: number;
    avgResponseTime?: number;
    tokenEfficiency?: number;
    systemResourceUsage?: number;
    memoryFootprint?: number;
  } | null;
};

/**
 * Service for selecting appropriate models for code subtasks
 * Enhanced with adaptive scoring and performance tracking
 */
export const codeModelSelector = {
  // Public methods are now defined directly inside the object
  async findBestModelForSubtask(subtask: CodeSubtask, originalTask?: string): Promise<Model | null> {
    logger.debug(`Finding best model for subtask: ${subtask.description}`);
    
    try {
      if (!this._modelPerformanceTracker) {
        logger.warn('Model performance tracker not initialized, using fallback model');
        return this.getFallbackModel(subtask);
      }

      // Get available models from both local and remote sources
      const availableModels = await costMonitor.getAvailableModels();
      
      // Get free OpenRouter models - shared cache across all subtasks
      const freeModels = await this.getCachedOpenRouterModels();
      
      // Combine all available models
      const allModels = [...availableModels, ...freeModels];
      
      // If no models are available, use the fallback
      if (allModels.length === 0) {
        logger.warn('No models found, using fallback model');
        return this.getFallbackModel(subtask);
      }
      
      // Filter models that can handle the token requirements
      const suitableModels = allModels.filter(model => {
        return !model.contextWindow || model.contextWindow >= subtask.estimatedTokens;
      });
      
      if (suitableModels.length === 0) {
        logger.warn(`No models found that can handle subtask with ${subtask.estimatedTokens} tokens`);
        return this.getFallbackModel(subtask);
      }
      
      // Log model counts by provider for debugging
      const modelsByProvider = suitableModels.reduce((acc, model) => {
        acc[model.provider] = (acc[model.provider] || 0) + 1;
        return acc;
      }, {} as Record<string, number>);
      
      logger.debug(`Models by provider: ${JSON.stringify(modelsByProvider)}`);
      
      // Get performance analysis for this complexity range
      // Use the injected reference to avoid circular dependency
      const perfAnalysis = this._modelPerformanceTracker.analyzePerformanceByComplexity(
        Math.max(0, subtask.complexity - 0.1),
        Math.min(1, subtask.complexity + 0.1)
      );
      
      // Score all suitable models
      const scoredModels = await Promise.all(
        suitableModels.map(async model => {
          const score = await this.scoreModelForSubtask(model, subtask, perfAnalysis, originalTask);
          return { model, score };
        })
      );
      
      // Sort by score (descending)
      scoredModels.sort((a, b) => b.score - a.score);
      
      // Log the top 3 models with their scores for debugging
      if (scoredModels.length > 0) {
        const topModels = scoredModels.slice(0, Math.min(3, scoredModels.length));
        logger.debug('Top models for this subtask:');
        topModels.forEach((m, i) => {
          logger.debug(`  ${i+1}. ${m.model.id} (${m.model.provider}): ${m.score.toFixed(2)}`);
        });
      }
      
      // Use adaptive thresholds based on task complexity
      const thresholds = this.calculateAdaptiveThresholds(subtask);
      
      // Get the best overall model if it meets minimum threshold
      if (scoredModels.length > 0 && scoredModels[0].score >= thresholds.minAcceptableScore) {
        logger.debug(`Selected model for subtask: ${scoredModels[0].model.id} (${scoredModels[0].model.provider}) with score ${scoredModels[0].score.toFixed(2)}`);
        return scoredModels[0].model;
      }
      
      // If no model scores well enough, try fallback
      return this.getFallbackModel(subtask);
    } catch (error) {
      logger.error('Error finding best model for subtask:', error);
      return this.getFallbackModel(subtask);
    }
  },

  async scoreModelForSubtask(
    model: Model, 
    subtask: CodeSubtask,
    perfAnalysis: ModelPerformanceAnalysis,
    originalTask?: string // Add originalTask context
  ): Promise<number> {
      // Check if model performance tracker is initialized
      const hasPerformanceData = this._modelPerformanceTracker !== null;
      
      // --- Language Matching Boost ---
      let languageBoost = 0;
      if (originalTask) {
        const taskLower = originalTask.toLowerCase();
        const modelIdLower = model.id.toLowerCase();
        // Basic keyword matching for common languages
        if (taskLower.includes('python') && (modelIdLower.includes('python') || modelIdLower.includes('py'))) languageBoost = 0.15;
        else if (taskLower.includes('javascript') && (modelIdLower.includes('javascript') || modelIdLower.includes('js'))) languageBoost = 0.15;
        else if (taskLower.includes('typescript') && (modelIdLower.includes('typescript') || modelIdLower.includes('ts'))) languageBoost = 0.15;
        else if (taskLower.includes('java') && modelIdLower.includes('java')) languageBoost = 0.15;
        else if (taskLower.includes('go') && (modelIdLower.includes('go') || modelIdLower.includes('golang'))) languageBoost = 0.15;
        else if (taskLower.includes('c++') && (modelIdLower.includes('c++') || modelIdLower.includes('cpp'))) languageBoost = 0.15;
        else if (taskLower.includes('c#') && (modelIdLower.includes('c#') || modelIdLower.includes('csharp'))) languageBoost = 0.15;
        // Add more languages as needed
        
        if (languageBoost > 0) {
            logger.debug(`Applying language boost (${languageBoost.toFixed(2)}) for model ${model.id} based on task: "${originalTask.substring(0,50)}..."`);
        }
      }
      // -----------------------------
      
      // If tracker isn't initialized or we can\'t access it, use balanced fallback scoring
      if (!this._modelPerformanceTracker) {
          logger.warn('Model performance tracker is not initialized. Using more balanced fallback scoring.');
          
          // More balanced fallback scoring that doesn\'t heavily favor local models
          let score = 0.5; // Start with neutral score
          
          // Add score for code-specific models based on name patterns
          if (model.id.toLowerCase().match(/code|coder|starcoder|deepseek|wizard/)) {
              score += 0.1;
          }
          
          // Slightly boost models that are likely good for code generation
          if (model.id.toLowerCase().includes('instruct')) {
              score += 0.05;
          }
          
          // Apply language boost here as well
          score += languageBoost;
          
          // Consider complexity - larger/remote models for complex tasks
          if (subtask.complexity > 0.7) {
              // For complex tasks, prefer larger models
              if (model.id.toLowerCase().match(/70b|40b|34b|13b|14b|claude|gpt/)) {
                  score += 0.15;
              }
              
              // For complex tasks, slightly prefer non-local models
              if (model.provider !== 'local' && model.provider !== 'lm-studio' && model.provider !== 'ollama') {
                  score += 0.1;
              }
          } else if (subtask.complexity < 0.4) {
              // For simple tasks, smaller models are fine
              if (model.id.toLowerCase().match(/1\\.5b|1b|3b|6b|7b|mini|tiny/)) {
                  score += 0.1;
              }
              
              // For simple tasks, slightly prefer local models for efficiency
              if (model.provider === 'local' || model.provider === 'lm-studio' || model.provider === 'ollama') {
                  score += 0.05;
              }
          }
          
          // Consider model provider variety
          if (model.provider === 'openrouter') {
              score += 0.15; // Boost OpenRouter models to increase their selection chance
          }
          
          // Add randomness to prevent always choosing the same models
          score += Math.random() * 0.1;
          
          logger.debug(`Fallback score for ${model.id} (${model.provider}): ${score.toFixed(2)}`);
          return Math.min(score, 1.0);
      }

    // We have performance data - use the full scoring algorithm
    const modelStats = await Promise.resolve(this._modelPerformanceTracker.getModelStats(model.id));
    let score = 0;
    
    // Task Complexity Match (30%)
    const complexityScore = this.calculateComplexityMatchScore(model, subtask, modelStats);
    score += complexityScore * 0.3;
    
    // Historical Performance (30%)
    const historyScore = this.calculateHistoricalPerformanceScore(model, modelStats, perfAnalysis);
    score += historyScore * 0.3;
    
    // Resource Efficiency (20%)
    const efficiencyScore = this.calculateResourceEfficiencyScore(model, subtask, modelStats);
    score += efficiencyScore * 0.2;
    
    // Cost Effectiveness (20%)
    const costScore = this.calculateCostEffectivenessScore(model, subtask);
    score += costScore * 0.2;
    
    // Additional boosts for specific capabilities
    score = this.applyCapabilityBoosts(score, model, subtask);
    
    // Apply Language Matching Boost
    score += languageBoost;
    
    // Boost OpenRouter models to encourage their selection
    if (model.provider === 'openrouter') {
      score += 0.05;
    }
    
    // Add small randomization factor to avoid always selecting the same model
    score += Math.random() * 0.05;
    
    logger.debug(`Full score for ${model.id} (${model.provider}): ${score.toFixed(2)}`);
    return Math.min(score, 1.0);
  },

  async getFallbackModel(subtask: CodeSubtask): Promise<Model | null> {
    logger.debug('Using fallback model selection for subtask');
    
    try {
      // Use size-based selection as a fallback
      switch (subtask.recommendedModelSize) {
        case 'small':
          return {
            id: config.defaultLocalModel,
            name: 'Default Local Model',
            provider: 'local',
            capabilities: {
              chat: true,
              completion: true
            },
            costPerToken: {
              prompt: 0,
              completion: 0
            }
          };
        
        case 'medium': {
          // Try to find a medium-sized local model
          const localModels = await costMonitor.getAvailableModels();
          const mediumModel = localModels.find(m => 
            m.provider === 'local' || 
            m.provider === 'lm-studio' || 
            m.provider === 'ollama'
          );
          
          return mediumModel || {
            id: config.defaultLocalModel,
            name: 'Default Local Model',
            provider: 'local',
            capabilities: {
              chat: true,
              completion: true
            },
            costPerToken: {
              prompt: 0,
              completion: 0
            }
          };
        }
        
        case 'large':
        case 'remote':
          return {
            id: 'gpt-3.5-turbo',
            name: 'GPT-3.5 Turbo',
            provider: 'openai',
            capabilities: {
              chat: true,
              completion: true
            },
            costPerToken: {
              prompt: 0.000001,
              completion: 0.000002
            }
          };
            
        default:
          return {
            id: config.defaultLocalModel,
            name: 'Default Local Model',
            provider: 'local',
            capabilities: {
              chat: true,
              completion: true
            },
            costPerToken: {
              prompt: 0,
              completion: 0
            }
          };
      }
    } catch (error) {
      logger.error('Error getting fallback model:', error);
      
      // Ultimate fallback - just return whatever config says is the default
      return {
        id: config.defaultLocalModel,
        name: 'Default Local Model',
        provider: 'local',
        capabilities: {
          chat: true,
          completion: true
        },
        costPerToken: {
          prompt: 0,
          completion: 0
        }
      };
    }
  },

  async selectModelsForSubtasks(
    subtasks: CodeSubtask[],
    useResourceEfficient = false,
    originalTask?: string // Add originalTask as an optional parameter
  ): Promise<Map<string, Model>> {
    // Add logging to show the original task context if provided
    if (originalTask) {
      logger.debug(`Selecting models for subtasks with original task context: "${originalTask.substring(0, 100)}..."`);
    }
    
    if (useResourceEfficient) {
      // Use the new optimized resource distribution method
      const availableModels = [
        ...(await costMonitor.getAvailableModels()),
        ...(await costMonitor.getFreeModels())
      ];

      // Pass originalTask to the optimization method
      return this.optimizeResourceUsage(subtasks, availableModels, originalTask);
    } else {
      // Simple strategy - just pick the best model for each subtask
      const assignments = new Map<string, Model>();
      for (const subtask of subtasks) {
        // Pass originalTask to findBestModelForSubtask
        const model = await this.findBestModelForSubtask(subtask, originalTask);
        if (model) {
          assignments.set(subtask.id, model);
        } else {
          logger.warn(`No model found for subtask ${subtask.id}`);
        }
      }
      return assignments;
    }
  },

  // Set the modelPerformanceTracker reference dynamically to avoid circular dependency
  _modelPerformanceTracker: null as ModelPerformanceTracker | null,
  
  setModelPerformanceTracker(tracker: ModelPerformanceTracker): void {
    this._modelPerformanceTracker = tracker;
  },

  // Cache for OpenRouter free models to avoid redundant API calls
  _openRouterModelsCache: {
    models: [] as Model[],
    lastUpdated: 0,
    cacheTimeMs: 5 * 60 * 1000 // 5 minutes cache lifetime
  },

  // Get OpenRouter models with caching to avoid excessive API calls
  async getCachedOpenRouterModels(): Promise<Model[]> {
    const now = Date.now();
    // Use 'this' to refer to the object's cache property
    const cacheAge = now - this._openRouterModelsCache.lastUpdated;
    
    // If cache is valid and not empty, use it
    if (cacheAge < this._openRouterModelsCache.cacheTimeMs && 
        this._openRouterModelsCache.models.length > 0) {
      logger.debug(`Using cached OpenRouter models (${this._openRouterModelsCache.models.length} models, cache age: ${Math.floor(cacheAge/1000)}s)`);
      return this._openRouterModelsCache.models;
    }
    
    // Cache expired or empty, refresh it
    try {
      if (config.openRouterApiKey) {
        logger.info('Refreshing OpenRouter models cache...');
        const freeModels = await openRouterModule.getFreeModels(true);
        logger.info(`Cached ${freeModels.length} free OpenRouter models`);
        
        // Update cache
        this._openRouterModelsCache.models = freeModels;
        this._openRouterModelsCache.lastUpdated = now;
        
        return freeModels;
      } else {
        logger.debug('OpenRouter API key not configured, skipping free models');
        return [];
      }
    } catch (error) {
      logger.error('Error getting free OpenRouter models:', error);
      return [];
    }
  },

  // Internal helper methods
  calculateComplexityMatchScore(
    model: Model,
    subtask: CodeSubtask,
    modelStats: Record<string, unknown> | null
  ): number {
    let score = 0;

    // Use historical complexity match if available
    if (modelStats && typeof modelStats.complexityScore === 'number') {
      score += 1 - Math.abs(modelStats.complexityScore - subtask.complexity);
    }

    // Model size appropriateness
    if (subtask.recommendedModelSize === 'small') {
      if (model.id.toLowerCase().match(/1\.5b|1b|3b|mini|tiny/)) {
        score += 0.3;
      }
    } else if (subtask.recommendedModelSize === 'medium') {
      if (model.id.toLowerCase().match(/7b|8b|13b/)) {
        score += 0.3;
      }
    } else if (subtask.recommendedModelSize === 'large') {
      if (model.id.toLowerCase().match(/70b|40b|34b/)) {
        score += 0.3;
      }
    }

    return score;
  },

  calculateHistoricalPerformanceScore(
    model: Model,
    modelStats: Record<string, unknown> | null,
    perfAnalysis: ModelPerformanceAnalysis
  ): number {
    let score = 0;

    if (modelStats) {
      // Success rate compared to average
      if (typeof modelStats.successRate === 'number' && 
          modelStats.successRate > perfAnalysis.averageSuccessRate) {
        score += 0.4;
      }

      // Quality score compared to average
      if (typeof modelStats.qualityScore === 'number' && 
          modelStats.qualityScore > perfAnalysis.averageQualityScore) {
        score += 0.4;
      }

      // Bonus for being among best performing models
      if (perfAnalysis.bestPerformingModels.includes(model.id)) {
        score += 0.2;
      }
    } else {
      // No history - use model characteristics as proxy
      if (model.id.toLowerCase().match(/code|coder|starcoder|deepseek/)) {
        score += 0.3;
      }
      if (model.id.toLowerCase().includes('instruct')) {
        score += 0.2;
      }
    }

    return score;
  },

  calculateResourceEfficiencyScore(
    model: Model,
    subtask: CodeSubtask,
    modelStats: Record<string, unknown> | null
  ): number {
    let score = 0;

    // Response time efficiency if available
    if (modelStats && typeof modelStats.avgResponseTime === 'number') {
      score += Math.max(0, 1 - (modelStats.avgResponseTime / 15000));
    }

    // Context window efficiency
    if (model.contextWindow) {
      const windowEfficiency = subtask.estimatedTokens / model.contextWindow;
      // Better score for models that fit the task well without excessive unused context
      const idealUtilization = 0.7; // Using about 70% of context window is ideal
      score += Math.max(0, 1 - Math.abs(windowEfficiency - idealUtilization));
    }

    // Token efficiency - if tracked in model stats
    if (modelStats && typeof modelStats.tokenEfficiency === 'number') {
      score += Math.min(1, modelStats.tokenEfficiency);
    }

    // System resource efficiency
    if (modelStats && typeof modelStats.systemResourceUsage === 'number') {
      // Lower system resource usage gets a higher score
      score += Math.max(0, 1 - modelStats.systemResourceUsage);
    }

    // Provider-based efficiency
    if (model.provider === 'local' || model.provider === 'lm-studio' || model.provider === 'ollama') {
      score += 0.3; // Local models are generally more resource-efficient

      // Additional optimizations for local models
      if (model.id.toLowerCase().includes('q4') || model.id.toLowerCase().includes('q5')) {
        score += 0.1; // Quantized models use less memory
      }

      if (modelStats && 
          typeof modelStats.memoryFootprint === 'number' && 
          modelStats.memoryFootprint < 8) {
        score += 0.1; // Models with small memory footprint (< 8GB)
      }
    }

    return Math.min(1, score);
  },

  calculateCostEffectivenessScore(model: Model, subtask: CodeSubtask): number {
    let score = 0;

    // Free models get high base score
    if (model.costPerToken.prompt === 0 && model.costPerToken.completion === 0) {
      score += 0.8;
    } else {
      // For paid models, score based on complexity appropriateness
      if (subtask.complexity >= COMPLEXITY_THRESHOLDS.COMPLEX) {
        score += 0.6; // Worth the cost for complex tasks
      } else if (subtask.complexity >= COMPLEXITY_THRESHOLDS.MEDIUM) {
        score += 0.3; // Maybe worth it for medium tasks
      }
    }

    return score;
  },

  applyCapabilityBoosts(score: number, model: Model, subtask: CodeSubtask): number {
    // Boost for specialized code models
    if (model.id.toLowerCase().match(/code|coder|starcoder|deepseek/)) {
      score += 0.1;
    }

    // Task-specific boosts
    if (subtask.codeType === 'test' && model.id.toLowerCase().includes('test')) {
      score += 0.1;
    } else if (subtask.codeType === 'interface' && model.id.toLowerCase().includes('phi')) {
      score += 0.1;
    }

    return score;
  },

  // New method to calculate adaptive thresholds based on task complexity
  calculateAdaptiveThresholds(subtask: CodeSubtask): {
    minAcceptableScore: number;
    preferLocalThreshold: number;
  } {
    // For complex tasks, we have higher requirements
    if (subtask.complexity >= COMPLEXITY_THRESHOLDS.COMPLEX) {
      return {
        minAcceptableScore: 0.6, // Higher minimum score for complex tasks
        preferLocalThreshold: 0.75 // Only use local if they score very well
      };
    }

    // For medium complexity
    if (subtask.complexity >= COMPLEXITY_THRESHOLDS.MEDIUM) {
      return {
        minAcceptableScore: 0.5,
        preferLocalThreshold: 0.65
      };
    }

    // For simple tasks
    return {
      minAcceptableScore: 0.4, // Lower threshold for simple tasks
      preferLocalThreshold: 0.55
    };
  },

  // New method to optimize resource distribution
  async optimizeResourceUsage(
    subtasks: CodeSubtask[],
    availableModels: Model[],
    originalTask?: string // Accept originalTask here
  ): Promise<Map<string, Model>> {
    if (!this._modelPerformanceTracker) {
      logger.warn('Model performance tracker not initialized, using simple assignment');
      // Pass originalTask to the fallback simple assignment
      return this.selectModelsForSubtasks(subtasks, false, originalTask);
    }

    const assignments = new Map<string, Model>();
    const modelLoad = new Map<string, number>(); // Track load per model

    // First, determine the best model for each task ignoring load balancing
    const idealAssignments = new Map<string, {model: Model, score: number}>();

    for (const subtask of subtasks) {
      // Use the injected reference to avoid circular dependency
      if (!this._modelPerformanceTracker) {
        logger.warn('Model performance tracker is not initialized.');
        continue;
      }
      const perfAnalysis = this._modelPerformanceTracker.analyzePerformanceByComplexity(
        Math.max(0, subtask.complexity - 0.1),
        Math.min(1, subtask.complexity + 0.1)
      );

      let bestModel = null;
      let bestScore = 0;

      for (const model of availableModels) {
        // Pass originalTask to the scoring function
        const score = await this.scoreModelForSubtask(model, subtask, perfAnalysis, originalTask);
        if (score > bestScore) {
          bestScore = score;
          bestModel = model;
        }
      }

      if (bestModel) {
        idealAssignments.set(subtask.id, {model: bestModel, score: bestScore});
      }
    }

    // Sort subtasks by complexity (highest first)
    const sortedSubtasks = [...subtasks].sort((a, b) => b.complexity - a.complexity);

    // Assign models with load balancing consideration
    for (const subtask of sortedSubtasks) {
      const idealAssignment = idealAssignments.get(subtask.id);
      if (!idealAssignment) continue;

      // Check the current load on the ideal model
      const currentLoad = modelLoad.get(idealAssignment.model.id) || 0;

      // If the model is already heavily loaded, find an alternative
      if (currentLoad > 3) { // Arbitrary threshold for demonstration
        // Find alternative models that score within 15% of the ideal
        const alternatives = Array.from(availableModels)
          .filter(m => m.id !== idealAssignment.model.id)
          .filter(m => {
            // Check context window constraints
            if (m.contextWindow && m.contextWindow < subtask.estimatedTokens) {
              return false;
            }
            return true;
          })
          .map(async m => {
            if (!this._modelPerformanceTracker) {
              logger.warn('Model performance tracker is not initialized.');
              return { model: m, score: 0 }; // Return a default score
            }
            const perfAnalysis = this._modelPerformanceTracker.analyzePerformanceByComplexity(
              Math.max(0, subtask.complexity - 0.1),
              Math.min(1, subtask.complexity + 0.1)
            );
            // Pass originalTask to scoring function for alternatives
            const score = await this.scoreModelForSubtask(m, subtask, perfAnalysis, originalTask);
            return { model: m, score };
          });

        const alternativeScores = await Promise.all(alternatives);
        const viableAlternatives = alternativeScores
          .filter(alt => alt.score >= idealAssignment.score * 0.85)
          .sort((a, b) => {
            // Sort by load first, then by score
            const loadA = modelLoad.get(a.model.id) || 0;
            const loadB = modelLoad.get(b.model.id) || 0;
            if (loadA !== loadB) return loadA - loadB;
            return b.score - a.score;
          });

        if (viableAlternatives.length > 0) {
          // Use the best alternative with lower load
          const bestAlt = viableAlternatives[0];
          assignments.set(subtask.id, bestAlt.model);
          modelLoad.set(bestAlt.model.id, (modelLoad.get(bestAlt.model.id) || 0) + 1);
          continue;
        }
      }

      // Use the ideal model if no better alternative was found
      assignments.set(subtask.id, idealAssignment.model);
      modelLoad.set(idealAssignment.model.id, currentLoad + 1);
    }

    return assignments;
  }
};