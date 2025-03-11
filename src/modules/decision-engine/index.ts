import { config } from '../../config/index.js';
import { costMonitor } from '../cost-monitor/index.js';
import { logger } from '../../utils/logger.js';
import { Model, RoutingDecision, TaskRoutingParams, ModelPerformanceProfile } from '../../types/index.js';
import { modelProfiles } from './utils/modelProfiles.js';
import { modelSelector } from './services/modelSelector.js';
import { codeEvaluationService } from './services/codeEvaluationService.js';
import { benchmarkService } from './services/benchmarkService.js';
import { modelsDbService } from './services/modelsDb.js';
import { COMPLEXITY_THRESHOLDS, TOKEN_THRESHOLDS } from './types/index.js';
import { codeTaskCoordinator } from './services/codeTaskCoordinator.js';
import { CodeTaskAnalysisOptions, DecomposedCodeTask, CodeSubtask } from './types/codeTask.js';
import { apiHandlers } from './services/apiHandlers.js';
import { jobTracker } from './services/jobTracker.js';

// Re-export the API handlers and job tracker for external use
export { apiHandlers, jobTracker };

/**
 * Decision Engine
 *
 * This module is responsible for making decisions about routing tasks
 * between local LLMs and paid APIs based on various factors:
 * - Cost
 * - Task complexity
 * - Token usage
 * - User priority
 * - Model context window limitations
 * - Benchmark performance data
 * - Availability of free models
 * 
 * It also provides code task decomposition and parallelization
 * capabilities inspired by the Minions architecture.
 */
export const decisionEngine = {
  /**
   * Initialize the decision engine
   * This is called when the module is first loaded
   */
  async initialize(): Promise<void> {
    logger.info('Initializing decision engine');
    
    try {
      // Initialize models database
      await modelsDbService.initialize();

      // Start periodic job cleanup
      setInterval(() => {
        jobTracker.cleanupCompletedJobs();
      }, 3600000); // Clean up every hour

      // Check for new free models that haven't been benchmarked
      if (config.openRouterApiKey) {
        try {
          // Schedule benchmarking to run in the background
          setTimeout(() => {
            benchmarkService.benchmarkFreeModels().catch(err => {
              logger.error('Error benchmarking free models:', err);
            });
          }, 5000); // Wait 5 seconds before starting benchmarks
        } catch (error) {
          logger.error('Error checking for unbenchmarked free models:', error);
        }
      }
      
      logger.info('Decision engine initialized successfully');
    } catch (error) {
      logger.error('Error initializing decision engine:', error);
    }
  },

  /**
   * Pre-emptively determine if a task should be routed to a local LLM or paid API
   * This is a fast decision based on task characteristics without making API calls
   * It's useful for quick decisions at task initialization
   */
  async preemptiveRouting(params: TaskRoutingParams): Promise<RoutingDecision> {
    const { task, contextLength, expectedOutputLength, complexity, priority } = params;
    
    logger.debug('Preemptive routing with parameters:', params);
    
    // Initialize decision factors
    const factors = {
      cost: {
        local: 0,
        paid: 0,
        wasFactor: false,
        weight: 0.3
      },
      complexity: {
        score: complexity,
        wasFactor: true,
        weight: 0.4
      },
      tokenUsage: {
        contextLength,
        outputLength: expectedOutputLength,
        totalTokens: contextLength + expectedOutputLength,
        wasFactor: true,
        weight: 0.3
      },
      priority: {
        value: priority,
        wasFactor: true,
        weight: 0.3
      },
      contextWindow: {
        wasFactor: false,
        weight: 0.5
      }
    };

    // Calculate weighted scores for each provider
    let localScore = 0.5;  // Start with neutral score
    let paidScore = 0.5;   // Start with neutral score
    let freeScore = 0.5;   // Start with neutral score
    let explanation = '';
    
    // Check if free models are available
    const hasFreeModels = await modelSelector.hasFreeModels();
    
    // Quick decision based on complexity thresholds from benchmark results
    if (complexity >= COMPLEXITY_THRESHOLDS.COMPLEX) {
      paidScore += 0.3 * factors.complexity.weight;
      explanation += `Complexity factor: Task complexity (${complexity.toFixed(2)}) is very high, favoring paid API. `;
    } else if (complexity >= COMPLEXITY_THRESHOLDS.MEDIUM) {
      paidScore += 0.15 * factors.complexity.weight;
      explanation += `Complexity factor: Task complexity (${complexity.toFixed(2)}) is moderately high, slightly favoring paid API. `;
      
      if (hasFreeModels) {
        freeScore += 0.15 * factors.complexity.weight;
        explanation += `Free models might also be suitable for this medium complexity task. `;
      }
    } else if (complexity <= COMPLEXITY_THRESHOLDS.SIMPLE) {
      localScore += 0.3 * factors.complexity.weight;
      explanation += `Complexity factor: Task complexity (${complexity.toFixed(2)}) is low, favoring local model. `;
      
      if (hasFreeModels) {
        freeScore += 0.3 * factors.complexity.weight;
        explanation += `Free models are also well-suited for this simple task. `;
      }
    }
    
    // Quick decision based on token usage
    const totalTokens = contextLength + expectedOutputLength;
    if (totalTokens >= TOKEN_THRESHOLDS.LARGE) {
      paidScore += 0.2 * factors.tokenUsage.weight;
      explanation += `Token usage factor: Total tokens (${totalTokens}) is very high, favoring paid API. `;
      
      if (hasFreeModels) {
        // Check if any free model can handle this context length
        const bestFreeModel = await modelSelector.getBestFreeModel(complexity, totalTokens);
        if (bestFreeModel) {
          freeScore += 0.2 * factors.tokenUsage.weight;
          explanation += `Free model ${bestFreeModel.id} can handle this large context. `;
        }
      }
    } else if (totalTokens <= TOKEN_THRESHOLDS.SMALL) {
      localScore += 0.2 * factors.tokenUsage.weight;
      explanation += `Token usage factor: Total tokens (${totalTokens}) is low, favoring local model. `;
      
      if (hasFreeModels) {
        freeScore += 0.2 * factors.tokenUsage.weight;
        explanation += `Free models are also efficient with this small context. `;
      }
    }
    
    // Quick decision based on user priority
    switch (priority) {
      case 'speed':
        paidScore += 0.8 * factors.priority.weight;
        explanation += 'Priority factor: Speed is prioritized, strongly favoring paid API. ';
        break;
      case 'cost':
        localScore += 0.8 * factors.priority.weight;
        explanation += 'Priority factor: Cost is prioritized, strongly favoring local model. ';
        
        if (hasFreeModels) {
          freeScore += 0.9 * factors.priority.weight;
          explanation += 'Free models also have zero cost and may be faster than local models. ';
        }
        break;
      case 'quality':
        if (complexity > COMPLEXITY_THRESHOLDS.MEDIUM) {
          paidScore += 0.8 * factors.priority.weight;
          explanation += 'Priority factor: Quality is prioritized for a complex task, strongly favoring paid API. ';
        } else {
          paidScore += 0.4 * factors.priority.weight;
          explanation += 'Priority factor: Quality is prioritized, moderately favoring paid API. ';
          
          if (hasFreeModels) {
            freeScore += 0.3 * factors.priority.weight;
            explanation += 'Free models might also provide good quality for this simpler task. ';
          }
        }
        break;
    }
    
    // Determine the provider based on scores
    let provider: 'local' | 'paid';
    let confidence: number;
    let model: string;
    
    // If free models are available and have the highest score, use them
    if (hasFreeModels && freeScore > localScore && freeScore > paidScore) {
      provider = 'paid'; // We'll use a free model from OpenRouter
      confidence = Math.min(Math.abs(freeScore - Math.max(localScore, paidScore)), 1.0);
      
      const bestFreeModel = await modelSelector.getBestFreeModel(complexity, totalTokens);
      model = bestFreeModel?.id || 'gpt-3.5-turbo'; // Fallback to standard model if no free model found
      
      explanation += `Selected free model ${model} based on scoring. `;
    } else if (priority === 'cost' && hasFreeModels) {
      // When cost is the priority and we have free models available, prefer them
      const freeScoreThreshold = Math.max(localScore, paidScore) * 0.9; // Within 90% of the best score
      
      if (freeScore >= freeScoreThreshold) {
        provider = 'paid'; // Using free model from OpenRouter
        confidence = 0.7;
        
        const bestFreeModel = await modelSelector.getBestFreeModel(complexity, totalTokens);
        model = bestFreeModel?.id || 'gpt-3.5-turbo';
        
        explanation += 'Cost is prioritized and free models are available with acceptable performance. ';
      } else {
        // Use the highest scoring provider
        provider = localScore > paidScore ? 'local' : 'paid';
        confidence = Math.min(Math.abs(localScore - paidScore), 1.0);
        model = await this.selectModelForProvider(provider, complexity, totalTokens);
      }
    } else {
      // Use the highest scoring provider
      provider = localScore > paidScore ? 'local' : 'paid';
      confidence = Math.min(Math.abs(localScore - paidScore), 1.0);
      model = await this.selectModelForProvider(provider, complexity, totalTokens);
    }
    
    return {
      provider,
      model,
      factors,
      confidence,
      explanation: explanation.trim(),
      scores: {
        local: localScore,
        paid: paidScore
      },
      preemptive: true
    };
  },

  /**
   * Route a task to either a local LLM or a paid API
   * This is the full decision process that considers all factors
   */
  async routeTask(params: TaskRoutingParams): Promise<RoutingDecision> {
    const { task, contextLength, expectedOutputLength, complexity, priority } = params;
    
    logger.debug('Routing task with parameters:', params);
    
    // Check if we can make a high-confidence preemptive decision
    const preemptiveDecision = await this.preemptiveRouting(params);
    if (preemptiveDecision.confidence >= 0.7) {
      logger.debug('Using high-confidence preemptive decision');
      return preemptiveDecision;
    }
    
    // Get cost estimate
    const costEstimate = await costMonitor.estimateCost({
      contextLength,
      outputLength: expectedOutputLength,
    });
    
    // Check if free models are available
    const hasFreeModels = await modelSelector.hasFreeModels();
    
    // Initialize decision factors
    const factors = {
      cost: {
        local: costEstimate.local.cost.total,
        paid: costEstimate.paid.cost.total,
        wasFactor: false,
        weight: 0.3
      },
      complexity: {
        score: complexity,
        wasFactor: false,
        weight: 0.3
      },
      tokenUsage: {
        contextLength,
        outputLength: expectedOutputLength,
        totalTokens: contextLength + expectedOutputLength,
        wasFactor: false,
        weight: 0.2
      },
      priority: {
        value: priority,
        wasFactor: false,
        weight: 0.2
      },
      contextWindow: {
        wasFactor: false,
        weight: 0.4
      },
      benchmarkPerformance: {
        wasFactor: false,
        weight: 0.3
      }
    };
    
    // Calculate scores and make routing decision based on all factors
    const { provider, model, confidence, explanation, localScore, paidScore } = await this.calculateFullRoutingDecision(
      params,
      factors,
      costEstimate,
      hasFreeModels
    );
    
    return {
      provider,
      model,
      factors,
      confidence,
      explanation: explanation.trim(),
      scores: {
        local: localScore,
        paid: paidScore
      }
    };
  },

  /**
   * Calculate the full routing decision based on all factors
   * Helper method used by routeTask
   */
  async calculateFullRoutingDecision(
    params: TaskRoutingParams,
    factors: any,
    costEstimate: any,
    hasFreeModels: boolean
  ): Promise<{ provider: 'local' | 'paid'; model: string; confidence: number; explanation: string; localScore: number; paidScore: number }> {
    const { complexity, contextLength, expectedOutputLength, priority } = params;
    const totalTokens = contextLength + expectedOutputLength;
    
    let localScore = 0.5;
    let paidScore = 0.5;
    let freeScore = 0.5;
    let explanation = '';

    // Apply cost factor
    const costRatio = costEstimate.paid.cost.total / Math.max(0.001, costEstimate.local.cost.total);
    if (costRatio > 1) {
      const costFactor = Math.min(0.3, Math.log10(costRatio) * 0.1);
      localScore += costFactor * factors.cost.weight;
      factors.cost.wasFactor = true;
      explanation += `Cost factor: Paid API is ${costRatio.toFixed(1)}x more expensive than local. `;
      
      if (hasFreeModels) {
        freeScore += costFactor * factors.cost.weight;
        explanation += 'Free models have zero cost. ';
      }
    }

    // Apply complexity factor
    if (complexity >= COMPLEXITY_THRESHOLDS.COMPLEX) {
      paidScore += 0.3 * factors.complexity.weight;
      factors.complexity.wasFactor = true;
      explanation += `Complexity factor: Task complexity (${complexity.toFixed(2)}) is very high. `;
    }

    // Apply priority factor
    switch (priority) {
      case 'speed':
        paidScore += 0.4 * factors.priority.weight;
        factors.priority.wasFactor = true;
        explanation += 'Priority factor: Speed is prioritized. ';
        break;
      case 'cost':
        if (hasFreeModels) {
          freeScore += 0.5 * factors.priority.weight;
        } else {
          localScore += 0.4 * factors.priority.weight;
        }
        factors.priority.wasFactor = true;
        explanation += 'Priority factor: Cost is prioritized. ';
        break;
      case 'quality':
        paidScore += 0.3 * factors.priority.weight;
        factors.priority.wasFactor = true;
        explanation += 'Priority factor: Quality is prioritized. ';
        break;
    }

    // Determine provider and model
    let provider: 'local' | 'paid';
    let confidence: number;
    let model: string;

    if (hasFreeModels && freeScore > localScore && freeScore > paidScore) {
      provider = 'paid';
      confidence = Math.min(Math.abs(freeScore - Math.max(localScore, paidScore)), 1.0);
      const bestFreeModel = await modelSelector.getBestFreeModel(complexity, totalTokens);
      model = bestFreeModel?.id || 'gpt-3.5-turbo';
      explanation += `Selected free model ${model} based on scoring. `;
    } else {
      // FIX: Use the provider with the highest score
      provider = localScore > paidScore ? 'local' : 'paid';
      confidence = Math.min(Math.abs(localScore - paidScore), 1.0);
      model = await this.selectModelForProvider(provider, complexity, totalTokens);
    }

    return { provider, model, confidence, explanation, localScore, paidScore };
  },

  /**
   * Select the appropriate model based on provider and task characteristics
   */
  async selectModelForProvider(
    provider: 'local' | 'paid',
    complexity: number,
    totalTokens: number
  ): Promise<string> {
    if (provider === 'local') {
      const bestModel = await modelSelector.getBestLocalModel(complexity, totalTokens);
      return bestModel?.id || config.defaultLocalModel;
    } else {
      if (complexity >= COMPLEXITY_THRESHOLDS.COMPLEX) {
        return 'gpt-4o';
      } else {
        return 'gpt-3.5-turbo';
      }
    }
  },

  /**
   * Analyze a code task and break it down into subtasks
   * 
   * @param task The coding task to analyze
   * @param options Options for code task analysis
   * @returns The decomposed task with analysis results
   */
  async analyzeCodeTask(
    task: string,
    options: CodeTaskAnalysisOptions = {}
  ): Promise<{
    decomposedTask: DecomposedCodeTask;
    modelAssignments: Map<string, Model>;
    executionOrder: CodeSubtask[];
    criticalPath: CodeSubtask[];
    dependencyVisualization: string;
    estimatedCost: number;
  }> {
    logger.info('Analyzing code task:', task);
    
    try {
      // Delegate to the code task coordinator
      return await codeTaskCoordinator.processCodeTask(task, options);
    } catch (error) {
      if (error instanceof Error) {
        throw new Error(`Failed to analyze code task: ${error.message}`);
      }
      throw new Error('Failed to analyze code task: Unknown error');
    }
  },

  /**
   * Execute a decomposed code task using assigned models
   * 
   * @param decomposedTask The decomposed code task
   * @param modelAssignments The model assignments for subtasks
   * @returns The results of execution
   */
  async executeCodeTask(
    decomposedTask: DecomposedCodeTask,
    modelAssignments: Map<string, Model>
  ): Promise<{
    subtaskResults: Map<string, string>;
    synthesizedResult: string;
  }> {
    logger.info('Executing decomposed code task:', decomposedTask.originalTask);
    
    try {
      // Execute all subtasks in order
      const subtaskResults = await codeTaskCoordinator.executeAllSubtasks(
        decomposedTask,
        modelAssignments
      );
      
      // Synthesize final result
      const synthesizedResult = await codeTaskCoordinator.synthesizeFinalResult(
        decomposedTask,
        subtaskResults
      );
      
      return {
        subtaskResults,
        synthesizedResult
      };
    } catch (error) {
      if (error instanceof Error) {
        throw new Error(`Failed to execute code task: ${error.message}`);
      }
      throw new Error('Failed to execute code task: Unknown error');
    }
  }
};
