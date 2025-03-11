import { logger } from '../../../utils/logger.js';
import { Model } from '../../../types/index.js';
import { ModelPerformanceData, ModelsDatabase, COMPLEXITY_THRESHOLDS } from '../types/index.js';
import { modelsDbService } from './modelsDb.js';
import { openRouterModule } from '../../openrouter/index.js';

/**
 * Enhanced service for tracking and analyzing model performance with resource monitoring
 */
export const modelPerformanceTracker = {
  /**
   * Track a model's performance for a specific task with expanded metrics
   */
  async trackPerformance(
    model: Model,
    taskComplexity: number,
    response: { 
      success: boolean; 
      text?: string;
      timeTaken: number;
      tokenUsage: { prompt: number; completion: number; total: number; }
      systemResources?: {
        cpuUsage?: number; // Percentage of CPU used (0-100)
        memoryUsage?: number; // Memory usage in MB
        gpuMemoryUsage?: number; // GPU memory usage in MB, if applicable
        duration?: number; // Total processing time in ms
      }
    }
  ): Promise<void> {
    try {
      const modelsDb = modelsDbService.getDatabase();
      const modelId = model.id;

      // Calculate quality score if we have a response
      const qualityScore = response.text ? 
        openRouterModule.evaluateQuality(response.text, response.text) : 0;

      // Calculate token efficiency (output quality per token)
      const tokenEfficiency = response.tokenUsage.total > 0 ? 
        qualityScore / Math.log2(response.tokenUsage.total + 1) : 0;
        
      // Calculate system resource efficiency score (normalized 0-1)
      let systemResourceUsage = 0;
      if (response.systemResources) {
        // Normalize and combine resource metrics (lower is better)
        const cpuScore = response.systemResources.cpuUsage ? 
          response.systemResources.cpuUsage / 100 : 0;
          
        const memScore = response.systemResources.memoryUsage ? 
          Math.min(1, response.systemResources.memoryUsage / 8192) : 0; // Normalize to 8GB max
          
        const gpuScore = response.systemResources.gpuMemoryUsage ? 
          Math.min(1, response.systemResources.gpuMemoryUsage / 8192) : 0;
          
        // Calculate combined resource score (weighted average)
        systemResourceUsage = (cpuScore * 0.3) + (memScore * 0.4) + (gpuScore * 0.3);
      }
      
      // Calculate memory footprint (in GB) if available
      const memoryFootprint = response.systemResources?.memoryUsage ? 
        response.systemResources.memoryUsage / 1024 : undefined;

      if (!modelsDb.models[modelId]) {
        // Initialize new model data with expanded metrics
        const newModelData = {
          id: modelId,
          name: model.name,
          provider: model.provider,
          lastSeen: new Date().toISOString(),
          contextWindow: model.contextWindow || 4096,
          successRate: response.success ? 1 : 0,
          qualityScore,
          avgResponseTime: response.timeTaken,
          complexityScore: taskComplexity,
          lastBenchmarked: new Date().toISOString(),
          benchmarkCount: 1,
          isFree: model.costPerToken.prompt === 0 && model.costPerToken.completion === 0,
          tokenEfficiency,
          systemResourceUsage,
          memoryFootprint
        } as unknown as ModelPerformanceData;
        
        // Set it in the database
        modelsDb.models[modelId] = newModelData;
        
        // Add resource usage history
        const resourceHistoryEntry = {
          timestamp: new Date().getTime(), // Use number timestamp instead of string
          tokenUsage: response.tokenUsage.total,
          responseTime: response.timeTaken,
          success: response.success
        };
        
        // Need to cast to access non-standard properties
        (modelsDb.models[modelId] as any).resourceHistory = [resourceHistoryEntry];
      } else {
        // Update existing model data with weighted averages for all metrics
        const existingModel = modelsDb.models[modelId] as unknown as {
          benchmarkCount: number;
          successRate: number;
          qualityScore: number;
          avgResponseTime: number;
          complexityScore: number;
          tokenEfficiency?: number;
          systemResourceUsage?: number;
          memoryFootprint?: number;
          resourceHistory?: Array<{
            timestamp: number;
            tokenUsage: number;
            responseTime: number;
            success: boolean;
          }>;
        };
        
        const benchmarkCount = (existingModel.benchmarkCount || 0) + 1;
        const weightedSuccessRate = ((existingModel.successRate || 0) * 
          (existingModel.benchmarkCount || 0) + (response.success ? 1 : 0)) / benchmarkCount;
        const weightedQualityScore = ((existingModel.qualityScore || 0) * 
          (existingModel.benchmarkCount || 0) + qualityScore) / benchmarkCount;
        const weightedResponseTime = ((existingModel.avgResponseTime || 0) * 
          (existingModel.benchmarkCount || 0) + response.timeTaken) / benchmarkCount;
        const weightedComplexityScore = ((existingModel.complexityScore || 0) * 
          (existingModel.benchmarkCount || 0) + taskComplexity) / benchmarkCount;
          
        // Calculate weighted token efficiency and system resource usage
        const weightedTokenEfficiency = ((existingModel.tokenEfficiency || 0) * 
          (existingModel.benchmarkCount || 0) + tokenEfficiency) / benchmarkCount;
          
        const weightedSystemResourceUsage = ((existingModel.systemResourceUsage || 0) *
          (existingModel.benchmarkCount || 0) + systemResourceUsage) / benchmarkCount;
          
        const weightedMemoryFootprint = memoryFootprint !== undefined && 
          existingModel.memoryFootprint !== undefined ?
          ((existingModel.memoryFootprint || 0) * 
            (existingModel.benchmarkCount || 0) + memoryFootprint) / benchmarkCount :
          memoryFootprint || existingModel.memoryFootprint;

        // Update the model data
        const updatedModel = {
          ...modelsDb.models[modelId],
          lastSeen: new Date().toISOString(),
          successRate: weightedSuccessRate,
          qualityScore: weightedQualityScore,
          avgResponseTime: weightedResponseTime,
          complexityScore: weightedComplexityScore,
          lastBenchmarked: new Date().toISOString(),
          benchmarkCount,
          tokenEfficiency: weightedTokenEfficiency,
          systemResourceUsage: weightedSystemResourceUsage,
          memoryFootprint: weightedMemoryFootprint,
        } as unknown as ModelPerformanceData;
        
        modelsDb.models[modelId] = updatedModel;
        
        // Add to resource usage history (keep last 10 entries)
        const history = (existingModel.resourceHistory || []) as Array<{
          timestamp: number;
          tokenUsage: number;
          responseTime: number;
          success: boolean;
        }>;
        
        history.push({
          timestamp: new Date().getTime(), // Use number timestamp instead of string
          tokenUsage: response.tokenUsage.total,
          responseTime: response.timeTaken,
          success: response.success
        });
        
        // Keep only the last 10 entries
        (modelsDb.models[modelId] as any).resourceHistory = history.slice(-10);
      }

      // Save the updated database - use updateModelData instead of save
      modelsDbService.updateModelData(modelId, modelsDb.models[modelId]);
      logger.debug(`Updated performance data for ${modelId}: Success=${response.success}, Quality=${qualityScore.toFixed(2)}, Time=${response.timeTaken}ms, TokenEff=${tokenEfficiency.toFixed(3)}`);
    } catch (error) {
      logger.error('Error tracking model performance:', error);
    }
  },

  /**
   * Track system resource usage for a model
   */
  async trackResourceUsage(
    modelId: string, 
    resources: {
      cpuUsage?: number;
      memoryUsage?: number;
      gpuMemoryUsage?: number;
      responseTime?: number;
    }
  ): Promise<void> {
    try {
      const modelsDb = modelsDbService.getDatabase();
      
      if (!modelsDb.models[modelId]) {
        logger.warn(`Cannot track resources for unknown model: ${modelId}`);
        return;
      }
      
      // Cast to allow access to properties
      const modelData = modelsDb.models[modelId] as unknown as {
        benchmarkCount: number;
        systemResourceUsage?: number;
        memoryFootprint?: number;
      };
      
      // Calculate system resource usage score (normalized 0-1)
      let systemResourceUsage = 0;
      const cpuScore = resources.cpuUsage ? resources.cpuUsage / 100 : 0;
      const memScore = resources.memoryUsage ? 
        Math.min(1, resources.memoryUsage / 8192) : 0;
      const gpuScore = resources.gpuMemoryUsage ? 
        Math.min(1, resources.gpuMemoryUsage / 8192) : 0;
      
      systemResourceUsage = (cpuScore * 0.3) + (memScore * 0.4) + (gpuScore * 0.3);
      
      // Update with weighted average
      const benchmarkCount = modelData.benchmarkCount || 1;
      const currentResourceScore = modelData.systemResourceUsage || 0;
      const weightedResourceScore = 
        (currentResourceScore * (benchmarkCount - 1) + systemResourceUsage) / benchmarkCount;
        
      // Update memory footprint if available
      if (resources.memoryUsage) {
        const memoryFootprint = resources.memoryUsage / 1024; // Convert to GB
        modelData.memoryFootprint = 
          modelData.memoryFootprint !== undefined ?
          (modelData.memoryFootprint + memoryFootprint) / 2 :
          memoryFootprint;
      }
      
      // Update system resource usage
      modelData.systemResourceUsage = weightedResourceScore;
      
      // Save the updated database - use updateModelData instead of save
      modelsDbService.updateModelData(modelId, modelsDb.models[modelId]);
      logger.debug(`Updated resource data for ${modelId}: System resource score=${weightedResourceScore.toFixed(3)}`);
    } catch (error) {
      logger.error('Error tracking model resource usage:', error);
    }
  },

  /**
   * Get performance statistics for a specific model
   */
  getModelStats(modelId: string): any {
    const modelsDb = modelsDbService.getDatabase();
    return modelsDb.models[modelId] || null;
  },

  /**
   * Get the best performing models for a specific complexity range
   */
  getBestPerformingModels(
    complexity: number,
    count: number = 3,
    options?: {
      prioritizeSpeed?: boolean;
      prioritizeQuality?: boolean;
      requireLocalOnly?: boolean;
      maximizeResourceEfficiency?: boolean;
    }
  ): Model[] {
    try {
      const modelsDb = modelsDbService.getDatabase();
      const modelEntries = Object.entries(modelsDb.models);
      
      // Calculate scores based on weights
      const speedWeight = options?.prioritizeSpeed ? 0.4 : 0.2;
      const qualityWeight = options?.prioritizeQuality ? 0.4 : 0.25;
      const successWeight = 0.3;
      const complexityMatchWeight = 0.2;
      const resourceWeight = options?.maximizeResourceEfficiency ? 0.4 : 0.2;
      const tokenEfficiencyWeight = 0.15;
      
      const scoredModels = modelEntries
        .filter(([_, data]) => {
          const typedData = data as unknown as { provider: string };
          if (options?.requireLocalOnly) {
            return typedData.provider === 'local' || 
                   typedData.provider === 'lm-studio' || 
                   typedData.provider === 'ollama';
          }
          return true;
        })
        .map(([id, data]) => {
          // Cast to access properties
          const typedData = data as unknown as {
            avgResponseTime: number;
            complexityScore: number;
            successRate: number;
            qualityScore: number;
            systemResourceUsage?: number;
            tokenEfficiency?: number;
            provider: string;
          };
          
          // Calculate weighted score with enhanced metrics
          const speedScore = Math.max(0, 1 - (typedData.avgResponseTime / 15000));
          const complexityMatchScore = 1 - Math.abs(typedData.complexityScore - complexity);
          
          // Resource efficiency scores (invert for scoring - lower usage is better)
          const resourceScore = typedData.systemResourceUsage !== undefined ? 
            1 - typedData.systemResourceUsage : 0.5; // Default to middle if unknown
            
          const tokenEfficiencyScore = typedData.tokenEfficiency || 0.5;
          
          // Calculate weighted total score
          const score = (typedData.successRate * successWeight) +
                       (typedData.qualityScore * qualityWeight) +
                       (speedScore * speedWeight) +
                       (complexityMatchScore * complexityMatchWeight) +
                       (resourceScore * resourceWeight) +
                       (tokenEfficiencyScore * tokenEfficiencyWeight);
                       
          return { id, score, data: typedData };
        })
        .sort((a, b) => b.score - a.score)
        .slice(0, count);
      
      return scoredModels.map(({ id, data }) => {
        const modelData = modelsDb.models[id] as unknown as {
          name: string;
          provider: string;
          contextWindow: number;
        };
        
        return {
          id,
          name: modelData.name,
          provider: modelData.provider,
          contextWindow: modelData.contextWindow,
          capabilities: {
            chat: true,
            completion: true
          },
          costPerToken: {
            prompt: 0,
            completion: 0
          }
        };
      });
    } catch (error) {
      logger.error('Error getting best performing models:', error);
      return [];
    }
  },

  /**
   * Get performance analysis for a specific complexity range
   */
  analyzePerformanceByComplexity(
    minComplexity: number,
    maxComplexity: number
  ): {
    averageSuccessRate: number;
    averageQualityScore: number;
    averageResponseTime: number;
    averageTokenEfficiency: number;
    averageResourceUsage: number;
    bestPerformingModels: string[];
  } {
    try {
      const modelsDb = modelsDbService.getDatabase();
      const relevantModels = Object.values(modelsDb.models).filter(model => {
        const typedModel = model as unknown as { complexityScore: number };
        return typedModel.complexityScore >= minComplexity && 
               typedModel.complexityScore <= maxComplexity;
      }) as unknown as Array<{
        id: string;
        successRate: number;
        qualityScore: number;
        avgResponseTime: number;
        complexityScore: number;
        tokenEfficiency?: number;
        systemResourceUsage?: number;
      }>;
      
      if (relevantModels.length === 0) {
        return {
          averageSuccessRate: 0,
          averageQualityScore: 0,
          averageResponseTime: 0,
          averageTokenEfficiency: 0,
          averageResourceUsage: 0,
          bestPerformingModels: []
        };
      }
      
      // Extended metrics totals
      const totals = relevantModels.reduce((acc, model) => ({
        successRate: acc.successRate + model.successRate,
        qualityScore: acc.qualityScore + model.qualityScore,
        responseTime: acc.responseTime + model.avgResponseTime,
        tokenEfficiency: acc.tokenEfficiency + (model.tokenEfficiency || 0),
        resourceUsage: acc.resourceUsage + (model.systemResourceUsage || 0)
      }), { 
        successRate: 0, 
        qualityScore: 0, 
        responseTime: 0,
        tokenEfficiency: 0,
        resourceUsage: 0 
      });

      // Get top 3 models by overall performance with enhanced scoring
      const bestModels = relevantModels
        .sort((a, b) => {
          const scoreA = (
            a.successRate * 0.3 + 
            a.qualityScore * 0.25 + 
            (1 - a.avgResponseTime/15000) * 0.2 +
            (a.tokenEfficiency || 0) * 0.15 +
            (1 - (a.systemResourceUsage || 0.5)) * 0.1
          );
          
          const scoreB = (
            b.successRate * 0.3 + 
            b.qualityScore * 0.25 + 
            (1 - b.avgResponseTime/15000) * 0.2 +
            (b.tokenEfficiency || 0) * 0.15 +
            (1 - (b.systemResourceUsage || 0.5)) * 0.1
          );
          
          return scoreB - scoreA;
        })
        .slice(0, 3)
        .map(m => m.id);

      return {
        averageSuccessRate: totals.successRate / relevantModels.length,
        averageQualityScore: totals.qualityScore / relevantModels.length,
        averageResponseTime: totals.responseTime / relevantModels.length,
        averageTokenEfficiency: totals.tokenEfficiency / relevantModels.length,
        averageResourceUsage: totals.resourceUsage / relevantModels.length,
        bestPerformingModels: bestModels
      };
    } catch (error) {
      logger.error('Error analyzing performance by complexity:', error);
      return {
        averageSuccessRate: 0,
        averageQualityScore: 0,
        averageResponseTime: 0,
        averageTokenEfficiency: 0,
        averageResourceUsage: 0,
        bestPerformingModels: []
      };
    }
  },

  /**
   * Get resource usage history for a specific model
   */
  getResourceHistory(modelId: string): {
    timestamp: number; // Changed to number to match the corrected type
    tokenUsage: number;
    responseTime: number;
    success: boolean;
  }[] {
    try {
      const modelsDb = modelsDbService.getDatabase();
      const model = modelsDb.models[modelId] as unknown as { 
        resourceHistory?: Array<{
          timestamp: number;
          tokenUsage: number;
          responseTime: number;
          success: boolean;
        }> 
      };
      return model?.resourceHistory || [];
    } catch (error) {
      logger.error('Error getting resource history:', error);
      return [];
    }
  },
  
  /**
   * Get resource efficiency report across all models
   */
  getResourceEfficiencyReport(): {
    mostEfficientModels: {id: string, provider: string, efficiency: number}[];
    leastEfficientModels: {id: string, provider: string, efficiency: number}[];
    averageLocalModelEfficiency: number;
    averageRemoteModelEfficiency: number;
  } {
    try {
      const modelsDb = modelsDbService.getDatabase();
      const modelEntries = Object.entries(modelsDb.models);
      
      if (modelEntries.length === 0) {
        return {
          mostEfficientModels: [],
          leastEfficientModels: [],
          averageLocalModelEfficiency: 0,
          averageRemoteModelEfficiency: 0
        };
      }
      
      // Calculate efficiency score for each model
      const scoredModels = modelEntries
        .filter(([_, data]) => {
          const typedData = data as unknown as { 
            systemResourceUsage?: number; 
            tokenEfficiency?: number;
          };
          return typedData.systemResourceUsage !== undefined && typedData.tokenEfficiency !== undefined;
        })
        .map(([id, data]) => {
          const typedData = data as unknown as { 
            systemResourceUsage?: number; 
            tokenEfficiency?: number;
            provider: string;
          };
          
          // Calculate efficiency score (higher is better)
          const resourceScore = 1 - (typedData.systemResourceUsage || 0.5); 
          const tokenScore = typedData.tokenEfficiency || 0;
          const efficiency = (resourceScore * 0.6) + (tokenScore * 0.4);
          
          return {
            id,
            provider: typedData.provider,
            efficiency
          };
        })
        .sort((a, b) => b.efficiency - a.efficiency);
      
      // Get most and least efficient models
      const mostEfficientModels = scoredModels.slice(0, 3);
      const leastEfficientModels = [...scoredModels].reverse().slice(0, 3);
      
      // Calculate averages by provider type
      const localModels = scoredModels.filter(m => 
        m.provider === 'local' || 
        m.provider === 'lm-studio' || 
        m.provider === 'ollama'
      );
      
      const remoteModels = scoredModels.filter(m => 
        m.provider !== 'local' && 
        m.provider !== 'lm-studio' && 
        m.provider !== 'ollama'
      );
      
      const averageLocalModelEfficiency = localModels.length > 0 ?
        localModels.reduce((sum, m) => sum + m.efficiency, 0) / localModels.length : 0;
        
      const averageRemoteModelEfficiency = remoteModels.length > 0 ?
        remoteModels.reduce((sum, m) => sum + m.efficiency, 0) / remoteModels.length : 0;
      
      return {
        mostEfficientModels,
        leastEfficientModels,
        averageLocalModelEfficiency,
        averageRemoteModelEfficiency
      };
    } catch (error) {
      logger.error('Error generating resource efficiency report:', error);
      return {
        mostEfficientModels: [],
        leastEfficientModels: [],
        averageLocalModelEfficiency: 0,
        averageRemoteModelEfficiency: 0
      };
    }
  }
};