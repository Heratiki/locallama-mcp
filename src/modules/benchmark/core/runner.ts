import { config as appConfig } from '../../../config/index.js';
import { costMonitor } from '../../cost-monitor/index.js';
import { openRouterModule } from '../../openrouter/index.js';
import { logger } from '../../../utils/logger.js';
import { BenchmarkConfig, BenchmarkResult, Model, BenchmarkTaskParams } from '../../../types/index.js';
import { callLmStudioApi } from '../api/lm-studio.js';
import { callOllamaApi } from '../api/ollama.js';
import { simulateOpenAiApi, simulateGenericApi } from '../api/simulation.js';
import { evaluateQuality } from '../evaluation/quality.js';
import { codeEvaluationService } from '../../decision-engine/services/codeEvaluationService.js';
import { saveBenchmarkResult, getRecentModelResults } from '../storage/benchmarkDb.js';

// Track model failure counts in memory
const modelFailures = new Map<string, number>();

// Track model failure and get count
function trackModelFailure(modelId: string): number {
  const currentFailures = modelFailures.get(modelId) || 0;
  modelFailures.set(modelId, currentFailures + 1);
  return currentFailures + 1;
}

/**
 * Run a benchmark for a specific model
 */
export async function runModelBenchmark(
  type: 'local' | 'paid',
  model: Model,
  task: string,
  contextLength: number,
  expectedOutputLength: number,
  config: BenchmarkConfig
): Promise<{
  timeTaken: number;
  successRate: number;
  qualityScore: number;
  tokenUsage: {
    prompt: number;
    completion: number;
    total: number;
  };
  output?: string;
}> {
  // Initialize results
  let totalTimeTaken = 0;
  let successCount = 0;
  let totalQualityScore = 0;
  const tokenUsage = {
    prompt: 0,
    completion: 0,
    total: 0,
  };
  let output = '';
  
  // Run multiple times to get average performance
  for (let i = 0; i < config.runsPerTask; i++) {
    try {
      logger.debug(`Run ${i + 1}/${config.runsPerTask} for ${model.id}`);
      
      // Add enhanced logging for debugging
      logger.info(`Executing benchmark run ${i + 1}/${config.runsPerTask} for model ${model.id} (provider: ${model.provider}) with task: ${task.substring(0, 30)}...`);
      
      // Measure response time
      const startTime = Date.now();
      
      // Call the appropriate API based on model provider
      let response;
      let success = false;
      let qualityScore = 0;
      let promptTokens = 0;
      let completionTokens = 0;
      
      if (model.provider === 'lm-studio') {
        logger.info(`Calling LM Studio API for model ${model.id}`);
        response = await callLmStudioApi(model.id, task, config.taskTimeout);
        success = response.success;
        qualityScore = response.text ? evaluateQuality(task, response.text) : 0;
        promptTokens = response.usage?.prompt_tokens || contextLength;
        completionTokens = response.usage?.completion_tokens || expectedOutputLength;
        if (success) {
          output = response.text || '';
        }
      } else if (model.provider === 'ollama') {
        response = await callOllamaApi(model.id, task, config.taskTimeout);
        success = response.success;
        qualityScore = response.text ? evaluateQuality(task, response.text) : 0;
        promptTokens = response.usage?.prompt_tokens || contextLength;
        completionTokens = response.usage?.completion_tokens || expectedOutputLength;
        if (success) {
          output = response.text || '';
        }
      } else if (model.provider === 'openai') {
        response = await simulateOpenAiApi(task, config.taskTimeout);
        success = response.success;
        qualityScore = response.text ? evaluateQuality(task, response.text) : 0;
        promptTokens = response.usage?.prompt_tokens || contextLength;
        completionTokens = response.usage?.completion_tokens || expectedOutputLength;
        if (success) {
          output = response.text || '';
        }
      } else {
        response = await simulateGenericApi(task, config.taskTimeout);
        success = response.success;
        qualityScore = response.text ? evaluateQuality(task, response.text) : 0;
        promptTokens = contextLength;
        completionTokens = expectedOutputLength;
        if (success) {
          output = response.text || '';
        }
      }
      
      if (!success) {
        const failureCount = trackModelFailure(model.id);
        
        // After 3 failures, try code evaluation service
        if (failureCount >= 3) {
          logger.info(`Model ${model.id} has failed ${failureCount} times, attempting detailed code evaluation`);
          try {
            const evaluationResult = await codeEvaluationService.evaluateCodeQuality(
              task,
              response.text || '',
              'general',
              { useModel: true, detailedAnalysis: true }
            );
            
            // If we get a valid evaluation, use it
            if (typeof evaluationResult === 'object' && evaluationResult.modelEvaluation) {
              success = evaluationResult.modelEvaluation.isValid;
              qualityScore = evaluationResult.modelEvaluation.qualityScore;
              logger.info(`Code evaluation service evaluation: Valid=${success}, Quality=${qualityScore}`);
            }
          } catch (evalError) {
            logger.error('Code evaluation service failed:', evalError);
          }
        }
      }

      const endTime = Date.now();
      const timeTaken = endTime - startTime;
      
      // Log detailed results of each run
      logger.info(`Benchmark run ${i+1} for ${model.id} completed: Success=${success}, Quality=${qualityScore.toFixed(2)}, Time=${timeTaken}ms`);
      
      // Update results
      totalTimeTaken += timeTaken;
      if (success) {
        successCount++;
      }
      totalQualityScore += qualityScore;
      tokenUsage.prompt += promptTokens;
      tokenUsage.completion += completionTokens;
      tokenUsage.total += promptTokens + completionTokens;
      
    } catch (error) {
      logger.error(`Error in run ${i + 1} for ${model.id}:`, error);
    }
  }
  
  // Calculate averages
  const avgTimeTaken = totalTimeTaken / config.runsPerTask;
  const successRate = successCount / config.runsPerTask;
  const avgQualityScore = totalQualityScore / config.runsPerTask;
  
  // Add summary logging
  logger.info(`Benchmark complete for ${model.id} (${model.provider}): Success=${successRate.toFixed(2)}, Quality=${avgQualityScore.toFixed(2)}, Avg Time=${avgTimeTaken.toFixed(0)}ms`);
  
  // Average the token usage
  tokenUsage.prompt = Math.round(tokenUsage.prompt / config.runsPerTask);
  tokenUsage.completion = Math.round(tokenUsage.completion / config.runsPerTask);
  tokenUsage.total = Math.round(tokenUsage.total / config.runsPerTask);
  
  return {
    timeTaken: avgTimeTaken,
    successRate,
    qualityScore: avgQualityScore,
    tokenUsage,
    output
  };
}

/**
 * Run a benchmark for a single task
 */
export async function benchmarkTask(
  params: BenchmarkTaskParams & { skipPaidModel?: boolean },
  customConfig?: Partial<BenchmarkConfig>
): Promise<BenchmarkResult> {
  const config: BenchmarkConfig = { ...appConfig.benchmark, ...customConfig };
  const { taskId, task, contextLength, expectedOutputLength, complexity, skipPaidModel } = params;
  
  logger.info(`Benchmarking task ${taskId}: ${task.substring(0, 50)}...`);
  
  // Get available models
  const availableModels = await costMonitor.getAvailableModels();
  
  // Determine which models to use
  const localModel = params.localModel 
    ? availableModels.find(m => m.id === params.localModel && (m.provider === 'local' || m.provider === 'lm-studio' || m.provider === 'ollama'))
    : availableModels.find(m => m.provider === 'local' || m.provider === 'lm-studio' || m.provider === 'ollama');
  
  // For paid model, check if we should use a free model from OpenRouter
  let paidModel: Model | undefined;
  let skipBenchmark = false;
  
  if (params.paidModel) {
    paidModel = availableModels.find(m => m.id === params.paidModel && m.provider !== 'local' && m.provider !== 'lm-studio' && m.provider !== 'ollama');
  } else if ('isConfigured' in openRouterModule && typeof openRouterModule.isConfigured === 'function') {
    try {
      if (Object.keys(openRouterModule.modelTracking.models).length === 0) {
        await openRouterModule.initialize();
      }
      
      // Get free models from OpenRouter
      const freeModels = await costMonitor.getFreeModels();
      
      // Find LM Studio models and add them to the free models pool
      const lmStudioModels = availableModels.filter(m => m.provider === 'lm-studio');
      if (lmStudioModels.length > 0) {
        logger.info(`Including ${lmStudioModels.length} LM Studio models in free models pool`);
        
        // Combine OpenRouter free models with LM Studio models 
        // Prioritize LM Studio models by putting them first in the list
        const combinedFreeModels = [...lmStudioModels, ...freeModels];
        
        // Find a model that can handle the context + output length
        const bestFreeModel = combinedFreeModels.find(m => 
          m.contextWindow && m.contextWindow >= (contextLength + expectedOutputLength)
        );
        
        if (bestFreeModel) {
          // Check if this model has been recently benchmarked
          const recentResults = await getRecentModelResults(bestFreeModel.id);
          if (recentResults && recentResults.benchmarkCount > 0) {
            logger.info(`Model ${bestFreeModel.id} was recently benchmarked (${recentResults.benchmarkCount} times), skipping`);
            skipBenchmark = true;
          } else {
            paidModel = bestFreeModel;
            logger.info(`Using model ${bestFreeModel.id} (provider: ${bestFreeModel.provider}) for benchmarking`);
          }
        }
      } else {
        // No LM Studio models found, use just OpenRouter free models
        if (freeModels.length > 0) {
          const bestFreeModel = freeModels.find(m => 
            m.contextWindow && m.contextWindow >= (contextLength + expectedOutputLength)
          );
          
          if (bestFreeModel) {
            // Check if this model has been recently benchmarked
            const recentResults = await getRecentModelResults(bestFreeModel.id);
            if (recentResults && recentResults.benchmarkCount > 0) {
              logger.info(`Model ${bestFreeModel.id} was recently benchmarked (${recentResults.benchmarkCount} times), skipping`);
              skipBenchmark = true;
            } else {
              paidModel = bestFreeModel;
              logger.info(`Using free model ${bestFreeModel.id} from OpenRouter`);
            }
          }
        }
      }
    } catch (error) {
      logger.error('Error getting free models from OpenRouter:', error);
    }
  }
  
  if (!localModel) {
    throw new Error('No local model available for benchmarking');
  }

  // Check if local model was recently benchmarked
  const localRecentResults = await getRecentModelResults(localModel.id);
  if (localRecentResults && localRecentResults.benchmarkCount > 0) {
    logger.info(`Local model ${localModel.id} was recently benchmarked (${localRecentResults.benchmarkCount} times), using cached results`);
    
    // Initialize result with cached performance data
    const result: BenchmarkResult = {
      taskId,
      task,
      contextLength,
      outputLength: expectedOutputLength,
      complexity,
      local: {
        model: localModel.id,
        timeTaken: 0,
        successRate: localRecentResults.avgSuccessRate,
        qualityScore: localRecentResults.avgQualityScore,
        tokenUsage: {
          prompt: contextLength,
          completion: expectedOutputLength,
          total: contextLength + expectedOutputLength
        },
        output: ''
      },
      paid: {
        model: paidModel?.id || 'gpt-3.5-turbo',
        timeTaken: 0,
        successRate: 0,
        qualityScore: 0,
        tokenUsage: {
          prompt: 0,
          completion: 0,
          total: 0
        },
        cost: 0,
        output: ''
      },
      timestamp: new Date().toISOString()
    };
    
    return result;
  }

  // Initialize result for new benchmark
  const result: BenchmarkResult = {
    taskId,
    task,
    contextLength,
    outputLength: 0,
    complexity,
    local: {
      model: localModel.id,
      timeTaken: 0,
      successRate: 0,
      qualityScore: 0,
      tokenUsage: {
        prompt: 0,
        completion: 0,
        total: 0
      },
      output: ''
    },
    paid: {
      model: paidModel?.id || 'gpt-3.5-turbo',
      timeTaken: 0,
      successRate: 0,
      qualityScore: 0,
      tokenUsage: {
        prompt: 0,
        completion: 0,
        total: 0
      },
      cost: 0,
      output: ''
    },
    timestamp: new Date().toISOString()
  };
  
  // Run benchmark for local model if no recent results
  logger.info(`Benchmarking local model: ${localModel.id}`);
  const localResults = await runModelBenchmark(
    'local',
    localModel,
    task,
    contextLength,
    expectedOutputLength,
    config
  );
  
  result.local.timeTaken = localResults.timeTaken;
  result.local.successRate = localResults.successRate;
  result.local.qualityScore = localResults.qualityScore;
  result.local.tokenUsage = localResults.tokenUsage;
  result.local.output = localResults.output || '';
  result.outputLength = localResults.tokenUsage.completion;
  
  // Run benchmark for paid model if available, not skipped, and no recent results
  if (paidModel && !skipPaidModel && !skipBenchmark) {
    const paidRecentResults = await getRecentModelResults(paidModel.id);
    if (paidRecentResults && paidRecentResults.benchmarkCount > 0) {
      logger.info(`Paid model ${paidModel.id} was recently benchmarked (${paidRecentResults.benchmarkCount} times), using cached results`);
      result.paid.successRate = paidRecentResults.avgSuccessRate;
      result.paid.qualityScore = paidRecentResults.avgQualityScore;
    } else {
      logger.info(`Benchmarking paid model: ${paidModel.id}`);
      const paidResults = await runModelBenchmark(
        'paid',
        paidModel,
        task,
        contextLength,
        expectedOutputLength,
        config
      );
      
      result.paid.timeTaken = paidResults.timeTaken;
      result.paid.successRate = paidResults.successRate;
      result.paid.qualityScore = paidResults.qualityScore;
      result.paid.tokenUsage = paidResults.tokenUsage;
      result.paid.output = paidResults.output || '';
      result.paid.cost = paidResults.tokenUsage.prompt * (paidModel.costPerToken?.prompt || 0) + 
                       paidResults.tokenUsage.completion * (paidModel.costPerToken?.completion || 0);
      
      if (paidResults.tokenUsage.completion > 0) {
        result.outputLength = paidResults.tokenUsage.completion;
      }
    }
  }
  
  // Save result to SQLite database
  if (config.saveResults) {
    await saveBenchmarkResult(result);
  }
  
  return result;
}