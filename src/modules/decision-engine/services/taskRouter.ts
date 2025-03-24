import { logger } from '../../../utils/logger.js';
import { Model } from '../../../types/index.js';
import { COMPLEXITY_THRESHOLDS } from '../types/index.js';
import { modelPerformanceTracker } from './modelPerformance.js';
import { costMonitor } from '../../cost-monitor/index.js';
import { CodeSubtask, Task } from '../types/codeTask.js';
import TaskExecutor from './taskExecutor.js';

interface RoutingStrategy {
  name: string;
  prioritizeSpeed: boolean;
  prioritizeQuality: boolean;
  requireLocalOnly: boolean;
  maximizeResourceEfficiency: boolean;
}

interface ModelLoadData {
  activeTaskCount: number;
  lastAssignmentTime: number;
  estimatedCompletionTimes: number[];
  processingPower: number;  // A score representing the model's capacity to handle tasks
}

/**
 * Enhanced service for smart task distribution and load balancing
 */
class TaskRouter {
  private taskExecutor: TaskExecutor;
  private strategies: Record<string, RoutingStrategy>;
  private _modelLoads: Map<string, ModelLoadData>;
  private _modelProcessingPower: Map<string, number> = new Map();
  private _modelMemoryUsage: Map<string, number> = new Map();
  
  constructor() {
    this.taskExecutor = new TaskExecutor(5); // Example with max 5 concurrent tasks
    this.strategies = {
      costEfficient: {
        name: 'Cost-Priority Balance',
        prioritizeSpeed: false,
        prioritizeQuality: false,
        requireLocalOnly: true,
        maximizeResourceEfficiency: false
      },
      qualityFirst: {
        name: 'Quality-First Routing',
        prioritizeSpeed: false,
        prioritizeQuality: true,
        requireLocalOnly: false,
        maximizeResourceEfficiency: false
      },
      speedFirst: {
        name: 'Speed-First Routing',
        prioritizeSpeed: true,
        prioritizeQuality: false,
        requireLocalOnly: true,
        maximizeResourceEfficiency: false
      },
      resourceEfficient: {
        name: 'Resource-Efficient Routing',
        prioritizeSpeed: true,
        prioritizeQuality: false,
        requireLocalOnly: true,
        maximizeResourceEfficiency: true
      }
    };
    this._modelLoads = new Map();
  }

  /**
   * Add a task to the executor queue
   */
  public addTask(task: Task): void {
    this.taskExecutor.addTask(task);
  }

  /**
   * Get the current load for a specific model with dynamic decay
   */
  getModelLoad(modelId: string): number {
    const loadData = this._modelLoads.get(modelId);
    if (!loadData) return 0;
    
    // Apply dynamic load decay based on estimated completion times
    const currentTime = Date.now();
    const newEstimatedCompletionTimes = [];
    let completedTasks = 0;
    
    for (const completionTime of loadData.estimatedCompletionTimes) {
      if (currentTime > completionTime) {
        completedTasks++;
      } else {
        newEstimatedCompletionTimes.push(completionTime);
      }
    }
    
    // Update load data with decayed values
    if (completedTasks > 0) {
      loadData.activeTaskCount = Math.max(0, loadData.activeTaskCount - completedTasks);
      loadData.estimatedCompletionTimes = newEstimatedCompletionTimes;
      this._modelLoads.set(modelId, loadData);
      
      logger.debug(`Dynamic load decay for ${modelId}: Completed ${completedTasks} tasks, new load: ${loadData.activeTaskCount}`);
    }
    
    return loadData.activeTaskCount;
  }
  
  /**
   * Calculate estimated completion time for a task on a specific model
   */
  private calculateEstimatedCompletionTime(
    model: Model,
    complexity: number,
    tokenCount: number
  ): number {
    // Get any performance data we have for this model
    const stats = modelPerformanceTracker.getModelStats(model.id);
    
    // Base time calculation using either historical data or heuristics
    let baseTimeMs = 5000; // Default 5 seconds
    
    if (stats?.avgResponseTime) {
      baseTimeMs = stats.avgResponseTime;
    } else {
      // Heuristic calculation based on model type and task size
      if (model.provider === 'local' || model.provider === 'lm-studio' || model.provider === 'ollama') {
        baseTimeMs = 2000 + (tokenCount * 10); // Local models: base + 10ms per token
      } else {
        baseTimeMs = 1000 + (tokenCount * 5); // Remote models: base + 5ms per token
      }
    }
    
    // Adjust for complexity
    const complexityMultiplier = 1 + (complexity * 2);
    
    // Calculate final estimated completion time
    const estimatedTimeMs = baseTimeMs * complexityMultiplier;
    
    return Date.now() + estimatedTimeMs;
  }
  
  /**
   * Update the load counter for a model with better estimation
   */
  updateModelLoad(
    model: Model, 
    increment: boolean = true,
    complexity: number = 0.5,
    tokenCount: number = 500
  ): void {
    const modelId = model.id;
    const loadData = this._modelLoads.get(modelId) || {
      activeTaskCount: 0,
      lastAssignmentTime: Date.now(),
      estimatedCompletionTimes: [],
      processingPower: this._modelProcessingPower.get(modelId) || 1.0
    };
    
    if (increment) {
      loadData.activeTaskCount += 1;
      
      // Add estimated completion time for this task
      const completionTime = this.calculateEstimatedCompletionTime(model, complexity, tokenCount);
      loadData.estimatedCompletionTimes.push(completionTime);
      
      // Update stats about model usage
      this.trackModelUsage(model, complexity, tokenCount);
    } else {
      // Decrement task count if positive
      if (loadData.activeTaskCount > 0) {
        loadData.activeTaskCount -= 1;
      }
      
      // Remove oldest completion time
      if (loadData.estimatedCompletionTimes.length > 0) {
        loadData.estimatedCompletionTimes.shift();
      }
    }
    
    loadData.lastAssignmentTime = Date.now();
    this._modelLoads.set(modelId, loadData);
  }

  /**
   * Track model usage statistics for improved future routing
   */
  private trackModelUsage(model: Model, _complexity: number, _tokenCount: number): void {
    try {
      // Track processing power over time (simple moving average)
      const currentPower = this._modelProcessingPower.get(model.id) || 1.0;
      const stats = modelPerformanceTracker.getModelStats(model.id);
      
      // If we have response time data, use it to estimate processing power
      if (stats?.avgResponseTime) {
        // Faster response time = more processing power
        const speedFactor = 5000 / Math.max(500, stats.avgResponseTime); 
        const newPower = (currentPower * 0.7) + (speedFactor * 0.3);
        this._modelProcessingPower.set(model.id, newPower);
        
        // Update the load data with this new processing power
        const loadData = this._modelLoads.get(model.id);
        if (loadData) {
          loadData.processingPower = newPower;
          this._modelLoads.set(model.id, loadData);
        }
      }
      
      // Also track memory usage if available, using type-safe property access
      if (stats && 'memoryUsage' in stats && typeof stats.memoryUsage === 'number') {
        this._modelMemoryUsage.set(model.id, stats.memoryUsage);
      } else if (stats && 'memoryFootprint' in stats && typeof stats['memoryFootprint'] === 'number') {
        this._modelMemoryUsage.set(model.id, stats['memoryFootprint']);
      }
    } catch (error) {
      logger.warn("Error tracking model usage", error);
    }
  }

  /**
   * Get effective load accounting for model processing power
   */
  private getEffectiveLoad(modelId: string): number {
    const loadData = this._modelLoads.get(modelId);
    if (!loadData) return 0;
    
    // Factor in processing power - more powerful models can handle more load
    return loadData.activeTaskCount / Math.max(0.5, loadData.processingPower);
  }
  
  /**
   * Select the best routing strategy based on task characteristics
   */
  selectStrategy(
    complexity: number,
    priority: 'speed' | 'quality' | 'cost' | 'efficiency' = 'cost'
  ): RoutingStrategy {
    if (priority === 'speed') {
      return this.strategies.speedFirst;
    }
    if (priority === 'quality' || complexity >= COMPLEXITY_THRESHOLDS.COMPLEX) {
      return this.strategies.qualityFirst;
    }
    if (priority === 'efficiency') {
      return this.strategies.resourceEfficient;
    }
    return this.strategies.costEfficient;
  }

  /**
   * Route a task to the most appropriate model with load balancing
   */
  async routeTask(
    task: {
      complexity: number;
      estimatedTokens: number;
      priority?: 'speed' | 'quality' | 'cost' | 'efficiency';
      id?: string;
    }
  ): Promise<Model | null> {
    try {
      const strategy = this.selectStrategy(task.complexity, task.priority);
      logger.debug(`Selected strategy: ${strategy.name} for task with complexity ${task.complexity}`);
      
      // Get best performing models based on strategy
      const models = modelPerformanceTracker.getBestPerformingModels(
        task.complexity,
        8, // Get more candidates for load balancing
        {
          prioritizeSpeed: strategy.prioritizeSpeed,
          prioritizeQuality: strategy.prioritizeQuality,
          requireLocalOnly: strategy.requireLocalOnly,
          maximizeResourceEfficiency: strategy.maximizeResourceEfficiency
        }
      );
      
      // If we have performance data, use it with load balancing
      if (models.length > 0) {
        // Filter models that can handle the token requirements
        const suitableModels = models.filter(model => 
          !model.contextWindow || model.contextWindow >= task.estimatedTokens
        );
        
        if (suitableModels.length === 0) {
          logger.warn(`No suitable models found for task with ${task.estimatedTokens} tokens`);
          return this.fallbackModelSelection(await costMonitor.getAvailableModels(), task, strategy);
        }
        
        // Apply load balancing with improved scoring system
        const scoredModels = suitableModels.map(model => {
          let score = 0;
          
          // Factor 1: Current load (lower is better)
          const effectiveLoad = this.getEffectiveLoad(model.id);
          score += Math.max(0, 5 - effectiveLoad) * 2;
          
          // Factor 2: Performance match for this task complexity
          const stats = modelPerformanceTracker.getModelStats(model.id);
          if (stats) {
            // Quality match for task complexity
            if (stats.complexityScore && Math.abs(stats.complexityScore - task.complexity) < 0.2) {
              score += 1.5;
            }
            
            // Speed factor (normalized to 0-2 range)
            const speedScore = stats.avgResponseTime ? Math.min(2, 10000 / stats.avgResponseTime) : 0;
            score += speedScore;
          }
          
          // Factor 3: Contextual boosts based on strategy
          if (strategy.maximizeResourceEfficiency) {
            // For resource efficiency, prefer smaller models/quantized models
            if (model.id.toLowerCase().includes('q4') || model.id.toLowerCase().includes('q5')) {
              score += 1.5;
            } else if (model.id.toLowerCase().match(/1\.5b|1b|3b|mini|tiny/)) {
              score += 1;
            }
          } else if (strategy.prioritizeSpeed && stats?.avgResponseTime) {
            // For speed priority, heavily weight the response time
            score += Math.min(3, 15000 / stats.avgResponseTime);
          } else if (strategy.prioritizeQuality && stats?.qualityScore) {
            // For quality priority, factor in quality score
            score += stats.qualityScore * 3;
          }
          
          return { model, score, effectiveLoad };
        });
        
        // Sort by score (descending)
        scoredModels.sort((a, b) => b.score - a.score);
        
        // Select top model, but with a safety check to avoid overloaded models
        let selectedModel: Model | null = null;
        for (const candidate of scoredModels) {
          // Skip if model is severely overloaded (effective load > 5)
          if (candidate.effectiveLoad > 5) continue;
          
          selectedModel = candidate.model;
          break;
        }
        
        // If all models are overloaded, take the best scoring one anyway
        if (!selectedModel && scoredModels.length > 0) {
          selectedModel = scoredModels[0].model;
        }
        
        if (selectedModel) {
          logger.debug(`Selected model ${selectedModel.id} for task with effective load ${this.getEffectiveLoad(selectedModel.id)}`);
          
          // Update model load with better estimation
          this.updateModelLoad(selectedModel, true, task.complexity, task.estimatedTokens);
          
          // Register task completion callback if id is provided
          if (task.id) {
            // Estimate task completion time
            const completionTime = this.calculateEstimatedCompletionTime(selectedModel, task.complexity, task.estimatedTokens);
            const estimatedDuration = completionTime - Date.now();
            
            setTimeout(() => {
              this.updateModelLoad(selectedModel, false);
              logger.debug(`Reduced load for ${selectedModel.id} after task ${task.id} completion`);
            }, estimatedDuration); 
          }
          
          return selectedModel;
        }
      }
      
      // Fallback to basic model selection if no performance data or all models overloaded
      const availableModels = await costMonitor.getAvailableModels();
      return this.fallbackModelSelection(availableModels, task, strategy);
    } catch (error) {
      logger.error('Error routing task:', error);
      return null;
    }
  }

  /**
   * Advanced resource-optimized routing for multiple tasks
   */
  async resourceOptimizedRouting(
    subtasks: CodeSubtask[],
    globalPriority?: 'speed' | 'quality' | 'cost' | 'efficiency'
  ): Promise<Map<string, Model>> {
    const routingMap = new Map<string, Model>();
    
    try {
      // Group similar subtasks by complexity and task type for better batch processing
      const groups = new Map<string, CodeSubtask[]>();
      subtasks.forEach(subtask => {
        // Use more specific grouping criteria
        const complexityBucket = Math.floor(subtask.complexity * 4) / 4; // 0.25 increment buckets
        const key = `${subtask.recommendedModelSize}-${complexityBucket}-${subtask.codeType || 'general'}`;
        if (!groups.has(key)) {
          groups.set(key, []);
        }
        groups.get(key)?.push(subtask);
      });
      
      // Get available models
      const availableModels = await costMonitor.getAvailableModels();
      const freeModels = await costMonitor.getFreeModels();
      const allModels = [...availableModels, ...freeModels];
      
      // Get resource efficiency report to make better decisions
      const efficiencyReport = modelPerformanceTracker.getResourceEfficiencyReport();
      
      // Track models used for each group to distribute load
      const usedModels = new Set<string>();
      
      // First pass - handle high complexity tasks with priority
      const sortedGroups = Array.from(groups.entries())
        .sort((a, b) => {
          // Get representative complexity for each group
          const complexityA = a[1][0].complexity;
          const complexityB = b[1][0].complexity;
          return complexityB - complexityA; // Sort by descending complexity
        });
      
      // Process each group
      for (const [, taskGroup] of sortedGroups) {
        if (taskGroup.length === 0) continue;
        
        // Pick the most complex task as representative
        const representative = taskGroup.reduce(
          (max, task) => task.complexity > max.complexity ? task : max,
          taskGroup[0]
        );
        
        // Define strategy based on task characteristics and priority
        const strategy = this.selectStrategy(representative.complexity, globalPriority);
        
        // Calculate combined token requirements for all tasks in the group
        const totalTokens = taskGroup.reduce((sum, task) => sum + task.estimatedTokens, 0);
        const maxIndividualTokens = Math.max(...taskGroup.map(task => task.estimatedTokens));
        
        // Determine if the group requires specialized capabilities
        const requiresCodeCapability = taskGroup.some(task => 
          task.codeType === 'function' || task.codeType === 'class' || task.codeType === 'method' || task.codeType === 'other' || task.codeType === 'module'
        );
        
        // Get candidate models with specialized filtering
        const candidateModels = modelPerformanceTracker.getBestPerformingModels(
          representative.complexity,
          10, // Get more candidates for better selection
          {
            prioritizeSpeed: strategy.prioritizeSpeed,
            prioritizeQuality: strategy.prioritizeQuality,
            requireLocalOnly: strategy.requireLocalOnly,
            maximizeResourceEfficiency: true // Always consider resource efficiency
          }
        );
        
        // Apply token requirements filter
        let modelsToConsider = candidateModels.length > 0 ? 
          candidateModels : 
          allModels;
        
        // Filter by token requirements and capability
        modelsToConsider = modelsToConsider.filter(m => {
          const meetsTokenReq = !m.contextWindow || m.contextWindow >= maxIndividualTokens;
          
          // Check for specialized capabilities if needed
          if (requiresCodeCapability) {
            return meetsTokenReq && m.id.toLowerCase().match(/code|coder|starcoder|deepseek|claude|gpt-4/);
          }
          
          return meetsTokenReq;
        });
        
        if (modelsToConsider.length === 0) {
          logger.warn(`No suitable models for task group with ${maxIndividualTokens} tokens`);
          continue;
        }
        
        // Score models based on load, efficiency, and capability matching
        const scoredModels = modelsToConsider.map(model => {
          let score = 0;
          
          // Factor 1: Load balance (lower is better)
          const effectiveLoad = this.getEffectiveLoad(model.id);
          const loadScore = Math.max(0, 5 - effectiveLoad) * 2;
          score += loadScore;
          
          // Factor 2: Resource efficiency
          const isEfficientModel = efficiencyReport.mostEfficientModels.some(m => m.id === model.id);
          if (isEfficientModel) {
            score += 2.5;
          } else if (
            model.provider === 'local' || 
            model.provider === 'lm-studio' || 
            model.provider === 'ollama'
          ) {
            // Local models generally more efficient than remote
            score += 1.5;
          }
          
          // Factor 3: Model already used (avoid if possible to distribute load)
          if (usedModels.has(model.id)) {
            score -= 1;
          }
          
          // Factor 4: Size appropriateness
          const stats = modelPerformanceTracker.getModelStats(model.id);
          if (stats) {
            // Penalize oversized models for simple tasks
            if (representative.complexity < COMPLEXITY_THRESHOLDS.MEDIUM) {
              // Check if it's a large model by name
              if (model.id.toLowerCase().match(/70b|40b|34b|claude-3-opus|gpt-4/)) {
                score -= 1;
              }
            }
            
            // Bonus for specific task types
            if ((representative.codeType === 'function' || representative.codeType === 'class' || representative.codeType === 'method' || representative.codeType === 'other' || representative.codeType === 'module') &&
                model.id.toLowerCase().match(/code|coder|starcoder|deepseek/)) {
              score += 1.5;
            }
          }
          
          // Factor 5: Memory efficiency
          const memoryUsage = this._modelMemoryUsage.get(model.id);
          if (memoryUsage && representative.complexity < COMPLEXITY_THRESHOLDS.MEDIUM) {
            // For simple tasks, prefer models with lower memory usage
            score += Math.max(0, 2 - (memoryUsage / 4)); // 0-2 points for memory efficiency
          }
          
          return { model, score, effectiveLoad };
        });
        
        // Sort by score (descending)
        scoredModels.sort((a, b) => b.score - a.score);
        
        // Select the best model that isn't overloaded
        let selectedModel: Model | null = null;
        for (const candidate of scoredModels) {
          // Skip if severely overloaded
          if (candidate.effectiveLoad > 4) continue;
          
          selectedModel = candidate.model;
          break;
        }
        
        // Fallback to best scored model if all are overloaded
        if (!selectedModel && scoredModels.length > 0) {
          selectedModel = scoredModels[0].model;
        }
        
        if (selectedModel) {
          // Assign this model to all tasks in the group
          for (const subtask of taskGroup) {
            routingMap.set(subtask.id, selectedModel);
          }
          
          // Mark this model as used
          usedModels.add(selectedModel.id);
          
          // Update load tracking - use representative complexity
          const avgComplexity = taskGroup.reduce((sum, t) => sum + t.complexity, 0) / taskGroup.length;
          
          // Update load with reasonable load increase that's proportional to group size but not linear
          this.updateModelLoad(
            selectedModel, 
            true, 
            avgComplexity, 
            Math.min(maxIndividualTokens * 2, totalTokens)
          );
          
          // Schedule load reduction based on estimated completion time
          const estimatedCompletionTime = this.calculateEstimatedCompletionTime(
            selectedModel, 
            avgComplexity, 
            totalTokens / taskGroup.length
          );
          const estimatedDuration = estimatedCompletionTime - Date.now();
          
          setTimeout(() => {
            this.updateModelLoad(selectedModel, false);
            logger.debug(`Reduced load for ${selectedModel.id} after task group completion`);
          }, Math.max(30000, estimatedDuration)); // At least 30 seconds
        }
      }
    } catch (error) {
      logger.error('Error in resource-optimized routing:', error);
    }
    
    return routingMap;
  }
  
  /**
   * Route multiple subtasks efficiently with enhanced load balancing
   */
  async routeSubtasks(
    subtasks: CodeSubtask[],
    globalPriority?: 'speed' | 'quality' | 'cost' | 'efficiency',
    options?: {
      optimizeResources?: boolean;
      batchSimilarTasks?: boolean;
    }
  ): Promise<Map<string, Model>> {
    // Always use resource optimization if efficiency is the priority or option is set
    if (globalPriority === 'efficiency' || options?.optimizeResources) {
      return this.resourceOptimizedRouting(subtasks, globalPriority);
    }
    
    const routingMap = new Map<string, Model>();
    
    try {
      // Batch similar tasks if requested
      if (options?.batchSimilarTasks) {
        // Group similar subtasks
        const groups = new Map<string, CodeSubtask[]>();
        
        subtasks.forEach(subtask => {
          // Group by complexity bucket (rounded to nearest 0.1) and recommended model size
          const complexityBucket = Math.round(subtask.complexity * 10) / 10;
          const key = `${subtask.recommendedModelSize}-${complexityBucket}`;
          if (!groups.has(key)) {
            groups.set(key, []);
          }
          groups.get(key)?.push(subtask);
        });
        
        // Process each group
        for (const [, taskGroup] of groups.entries()) {
          if (taskGroup.length === 0) continue;
          
          // Get the most complex task as representative
          const representative = taskGroup.reduce(
            (max, task) => task.complexity > max.complexity ? task : max,
            taskGroup[0]
          );
          
          // Route the representative task
          const model = await this.routeTask({
            id: representative.id,
            complexity: representative.complexity,
            estimatedTokens: representative.estimatedTokens,
            priority: globalPriority
          });
          
          if (model) {
            // Assign to all tasks in this group
            for (const task of taskGroup) {
              routingMap.set(task.id, model);
            }
          }
        }
        
        return routingMap;
      }
      
      // Standard routing - sort subtasks by complexity (descending)
      const sortedSubtasks = [...subtasks].sort((a, b) => b.complexity - a.complexity);
      
      // Process tasks in order of complexity
      for (const subtask of sortedSubtasks) {
        const model = await this.routeTask({
          id: subtask.id,
          complexity: subtask.complexity,
          estimatedTokens: subtask.estimatedTokens,
          priority: globalPriority
        });
        
        if (model) {
          routingMap.set(subtask.id, model);
        }
      }
    } catch (error) {
      logger.error('Error routing subtasks:', error);
    }
    
    return routingMap;
  }

  /**
   * Update task completion status to help with load balancing
   */
  notifyTaskCompletion(modelId: string): void {
    // Find the model object to pass to updateModelLoad
    const model = {
      id: modelId,
      name: modelId,
      provider: 'unknown',
      capabilities: { chat: true, completion: true },
      costPerToken: { prompt: 0, completion: 0 }
    };
    
    this.updateModelLoad(model, false);
    logger.debug(`Marked task as completed for model ${modelId}`);
  }

  /**
   * Fallback model selection when no performance data is available
   */
  private fallbackModelSelection(
    models: Model[],
    task: { complexity: number; estimatedTokens: number },
    strategy: RoutingStrategy
  ): Model | null {
    // Filter models based on strategy
    const eligibleModels = models.filter(model => {
      if (strategy.requireLocalOnly) {
        return (model.provider === 'local' || 
                model.provider === 'lm-studio' || 
                model.provider === 'ollama') &&
               (!model.contextWindow || model.contextWindow >= task.estimatedTokens);
      }
      return !model.contextWindow || model.contextWindow >= task.estimatedTokens;
    });
    
    if (eligibleModels.length === 0) {
      return null;
    }
    
    // For resource-efficient strategy, prefer quantized models for local providers
    if (strategy.maximizeResourceEfficiency) {
      const quantizedModel = eligibleModels.find(m => 
        m.id.toLowerCase().includes('q4') || 
        m.id.toLowerCase().includes('q5') || 
        m.id.toLowerCase().includes('q8')
      );
      
      if (quantizedModel) {
        return quantizedModel;
      }
    }
    
    // For complex tasks, prefer models with larger context windows
    if (task.complexity >= COMPLEXITY_THRESHOLDS.MEDIUM) {
      return eligibleModels.reduce((best, current) => {
        return (!best || (current.contextWindow || 0) > (best.contextWindow || 0)) 
          ? current 
          : best;
      }, eligibleModels[0]);
    }
    
    // Consider load balancing with processing power
    const scoredModels = eligibleModels.map(model => {
      const load = this.getEffectiveLoad(model.id);
      
      // For size-appropriate scoring
      let sizeScore = 0;
      if (task.complexity < COMPLEXITY_THRESHOLDS.MEDIUM) {
        // For simple tasks, prefer smaller models
        if (model.id.toLowerCase().match(/1\.5b|1b|3b|mini|tiny/)) {
          sizeScore = 2;
        } else if (model.id.toLowerCase().match(/7b|8b|13b/)) {
          sizeScore = 1;
        }
      } else {
        // For complex tasks, prefer larger models
        if (model.id.toLowerCase().match(/70b|40b|34b/)) {
          sizeScore = 2;
        } else if (model.id.toLowerCase().match(/7b|8b|13b/)) {
          sizeScore = 1;
        }
      }
      
      return { model, score: (5 - load) + sizeScore };
    });
    
    scoredModels.sort((a, b) => b.score - a.score);
    return scoredModels[0].model;
  }

  /**
   * Get all active model loads for monitoring
   */
  getModelLoads(): Record<string, { activeTaskCount: number, estimatedCompletions: number[] }> {
    const result: Record<string, { activeTaskCount: number, estimatedCompletions: number[] }> = {};
    
    for (const [modelId, loadData] of this._modelLoads.entries()) {
      if (loadData.activeTaskCount > 0) {
        result[modelId] = {
          activeTaskCount: loadData.activeTaskCount,
          estimatedCompletions: loadData.estimatedCompletionTimes.map(time => time - Date.now())
        };
      }
    }
    
    return result;
  }
}

export const taskRouter = new TaskRouter();
export default TaskRouter;