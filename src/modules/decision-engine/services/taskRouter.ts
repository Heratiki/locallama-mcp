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

/**
 * Enhanced service for smart task distribution and load balancing
 */
class TaskRouter {
  private taskExecutor: TaskExecutor;
  private strategies: Record<string, RoutingStrategy>;
  private _modelLoads: Map<string, { activeTaskCount: number; lastAssignmentTime: number }>;

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
   * Get the current load for a specific model
   */
  getModelLoad(modelId: string): number {
    const loadData = this._modelLoads.get(modelId);
    if (!loadData) return 0;
    
    // Reduce load count for older tasks (assume they might be completed)
    const currentTime = Date.now();
    const timeSinceLastAssignment = currentTime - loadData.lastAssignmentTime;
    
    // If it's been more than 2 minutes since last assignment, reduce the load
    if (timeSinceLastAssignment > 120000 && loadData.activeTaskCount > 0) {
      loadData.activeTaskCount = Math.max(0, loadData.activeTaskCount - 1);
      loadData.lastAssignmentTime = currentTime;
      this._modelLoads.set(modelId, loadData);
    }
    
    return loadData.activeTaskCount;
  }
  
  /**
   * Update the load counter for a model
   */
  updateModelLoad(modelId: string, increment: boolean = true): void {
    const currentLoad = this._modelLoads.get(modelId) || {
      activeTaskCount: 0,
      lastAssignmentTime: Date.now()
    };
    
    if (increment) {
      currentLoad.activeTaskCount += 1;
    } else if (currentLoad.activeTaskCount > 0) {
      currentLoad.activeTaskCount -= 1;
    }
    
    currentLoad.lastAssignmentTime = Date.now();
    this._modelLoads.set(modelId, currentLoad);
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
        5, // Get more candidates for load balancing
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
        
        // Apply load balancing - prefer models with lower current load
        const balancedModels = suitableModels.map(model => ({
          model,
          currentLoad: this.getModelLoad(model.id)
        }));
        
        // Sort by load (ascending), with a small preference for the first model in the list
        balancedModels.sort((a, b) => {
          // If load difference is significant, prioritize lower load
          if (Math.abs(a.currentLoad - b.currentLoad) >= 2) {
            return a.currentLoad - b.currentLoad;
          }
          
          // For similar loads, keep original performance-based ordering
          const aIndex = suitableModels.findIndex(m => m.id === a.model.id);
          const bIndex = suitableModels.findIndex(m => m.id === b.model.id);
          return aIndex - bIndex;
        });
        
        // Use the best balanced model
        const selectedModel = balancedModels[0].model;
        logger.debug(`Selected model ${selectedModel.id} with load ${balancedModels[0].currentLoad} for task`);
        
        // Update model load
        this.updateModelLoad(selectedModel.id, true);
        
        // Register task completion callback if id is provided
        if (task.id) {
          setTimeout(() => {
            this.updateModelLoad(selectedModel.id, false);
            logger.debug(`Reduced load for ${selectedModel.id} after task ${task.id} completion`);
          }, 60000); // Assume task completes in about a minute
        }
        
        return selectedModel;
      }
      
      // Fallback to basic model selection if no performance data
      const availableModels = await costMonitor.getAvailableModels();
      return this.fallbackModelSelection(availableModels, task, strategy);
    } catch (error) {
      logger.error('Error routing task:', error);
      return null;
    }
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
    const routingMap = new Map<string, Model>();
    
    try {
      // If resource optimization is requested, use more advanced allocation
      if (globalPriority === 'efficiency' || options?.optimizeResources) {
        return this.resourceOptimizedRouting(subtasks, globalPriority);
      }
      
      // Batch similar tasks if requested
      if (options?.batchSimilarTasks) {
        return this.batchedTaskRouting(subtasks, globalPriority);
      }
      
      // Standard routing - sort subtasks by complexity (descending) to handle complex tasks first
      const sortedSubtasks = [...subtasks].sort((a, b) => b.complexity - a.complexity);
      
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
   * Advanced resource-optimized routing for multiple tasks
   */
  async resourceOptimizedRouting(
    subtasks: CodeSubtask[],
    globalPriority?: 'speed' | 'quality' | 'cost' | 'efficiency'
  ): Promise<Map<string, Model>> {
    const routingMap = new Map<string, Model>();
    
    try {
      // Group similar subtasks
      const groups = new Map<string, CodeSubtask[]>();
      subtasks.forEach(subtask => {
        // Group by recommended model size and complexity range
        const complexityBucket = Math.floor(subtask.complexity * 4) / 4; // 0.25 increment buckets
        const key = `${subtask.recommendedModelSize}-${complexityBucket}`;
        if (!groups.has(key)) {
          groups.set(key, []);
        }
        groups.get(key)?.push(subtask);
      });
      
      // Get available models
      const availableModels = await costMonitor.getAvailableModels();
      const freeModels = await costMonitor.getFreeModels();
      const allModels = [...availableModels, ...freeModels];
      
      // Process each group
      for (const [_, taskGroup] of groups.entries()) {
        if (taskGroup.length === 0) continue;
        
        // Pick the most complex task as representative
        const representative = taskGroup.reduce(
          (max, task) => task.complexity > max.complexity ? task : max,
          taskGroup[0]
        );
        
        // Get resource efficiency report to make better decisions
        const efficiencyReport = modelPerformanceTracker.getResourceEfficiencyReport();
        
        // Define strategy based on task characteristics and priority
        const strategy = this.selectStrategy(representative.complexity, globalPriority);
        
        // Get candidate models
        const candidateModels = modelPerformanceTracker.getBestPerformingModels(
          representative.complexity,
          5,
          {
            prioritizeSpeed: strategy.prioritizeSpeed,
            prioritizeQuality: strategy.prioritizeQuality,
            requireLocalOnly: strategy.requireLocalOnly,
            maximizeResourceEfficiency: true // Always consider resource efficiency
          }
        );
        
        // If no candidates from performance data, use all available models
        let modelsToConsider = candidateModels.length > 0 ? 
          candidateModels : 
          allModels.filter(m => !m.contextWindow || m.contextWindow >= representative.estimatedTokens);
        
        // Filter by token requirements
        modelsToConsider = modelsToConsider.filter(
          m => !m.contextWindow || m.contextWindow >= representative.estimatedTokens
        );
        
        if (modelsToConsider.length === 0) {
          logger.warn(`No suitable models for task group with ${representative.estimatedTokens} tokens`);
          continue;
        }
        
        // Score models based on load and efficiency
        const scoredModels = modelsToConsider.map(model => {
          let score = 0;
          
          // Lower load is better (0-5 scale, inverted)
          const load = this.getModelLoad(model.id);
          score += Math.max(0, 5 - load) * 0.4;
          
          // Check if it's among the most efficient models
          const isEfficient = efficiencyReport.mostEfficientModels.some(m => m.id === model.id);
          if (isEfficient) {
            score += 2;
          }
          
          // Local models get a slight boost for resource efficiency
          if (model.provider === 'local' || 
              model.provider === 'lm-studio' || 
              model.provider === 'ollama') {
            score += 1;
          }
          
          return { model, score };
        });
        
        // Select the best model
        scoredModels.sort((a, b) => b.score - a.score);
        
        if (scoredModels.length > 0) {
          const selectedModel = scoredModels[0].model;
          
          // Assign this model to all tasks in the group
          for (const subtask of taskGroup) {
            routingMap.set(subtask.id, selectedModel);
          }
          
          // Update the load - increment by the number of tasks in the group
          const currentLoad = this._modelLoads.get(selectedModel.id) || {
            activeTaskCount: 0,
            lastAssignmentTime: Date.now()
          };
          
          currentLoad.activeTaskCount += Math.ceil(taskGroup.length / 2); // Increment by half the group size
          currentLoad.lastAssignmentTime = Date.now();
          this._modelLoads.set(selectedModel.id, currentLoad);
          
          // Schedule load reduction
          setTimeout(() => {
            this.updateModelLoad(selectedModel.id, false);
            logger.debug(`Reduced load for ${selectedModel.id} after task group completion`);
          }, 90000); // Longer timeout for a group
        }
      }
    } catch (error) {
      logger.error('Error in resource-optimized routing:', error);
    }
    
    return routingMap;
  }
  
  /**
   * Batch similar tasks for efficient routing
   */
  async batchedTaskRouting(
    subtasks: CodeSubtask[],
    globalPriority?: 'speed' | 'quality' | 'cost' | 'efficiency'
  ): Promise<Map<string, Model>> {
    const routingMap = new Map<string, Model>();
    
    try {
      // Organize tasks by complexity ranges
      const complexityBuckets: {[key: string]: CodeSubtask[]} = {
        simple: [],
        medium: [],
        complex: []
      };
      
      for (const task of subtasks) {
        if (task.complexity >= COMPLEXITY_THRESHOLDS.COMPLEX) {
          complexityBuckets.complex.push(task);
        } else if (task.complexity >= COMPLEXITY_THRESHOLDS.MEDIUM) {
          complexityBuckets.medium.push(task);
        } else {
          complexityBuckets.simple.push(task);
        }
      }
      
      // Route each bucket using an appropriate model
      for (const [complexity, tasks] of Object.entries(complexityBuckets)) {
        if (tasks.length === 0) continue;
        
        // Select a priority based on complexity if none provided
        let priority = globalPriority;
        if (!priority) {
          switch (complexity) {
            case 'complex':
              priority = 'quality';
              break;
            case 'medium':
              priority = 'efficiency';
              break;
            case 'simple':
              priority = 'speed';
              break;
          }
        }
        
        // Find representative task (highest token count)
        const representative = tasks.reduce(
          (max, task) => task.estimatedTokens > max.estimatedTokens ? task : max,
          tasks[0]
        );
        
        // Route the representative task
        const model = await this.routeTask({
          complexity: representative.complexity,
          estimatedTokens: representative.estimatedTokens,
          priority
        });
        
        if (model) {
          // Assign to all tasks in this bucket
          for (const task of tasks) {
            routingMap.set(task.id, model);
          }
          
          // Update load counter
          const loadIncrement = Math.min(3, Math.ceil(tasks.length / 2));
          const currentLoad = this._modelLoads.get(model.id) || {
            activeTaskCount: 0,
            lastAssignmentTime: Date.now()
          };
          currentLoad.activeTaskCount += loadIncrement;
          currentLoad.lastAssignmentTime = Date.now();
          this._modelLoads.set(model.id, currentLoad);
          
          // Schedule load reduction
          setTimeout(() => {
            const load = this._modelLoads.get(model.id);
            if (load) {
              load.activeTaskCount = Math.max(0, load.activeTaskCount - loadIncrement);
              this._modelLoads.set(model.id, load);
            }
          }, 120000); // 2 minutes timeout for a batch
        }
      }
    } catch (error) {
      logger.error('Error in batched task routing:', error);
    }
    
    return routingMap;
  }

  /**
   * Update task completion status to help with load balancing
   */
  notifyTaskCompletion(modelId: string): void {
    this.updateModelLoad(modelId, false);
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
    
    // Consider load balancing even in fallback selection
    const balancedModels = eligibleModels.map(model => ({
      model,
      load: this.getModelLoad(model.id)
    }));
    
    balancedModels.sort((a, b) => a.load - b.load);
    return balancedModels[0].model;
  }
}

export const taskRouter = new TaskRouter();
export default TaskRouter;