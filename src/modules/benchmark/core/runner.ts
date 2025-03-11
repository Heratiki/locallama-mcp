import { config as appConfig } from '../../../config/index.js';
import { costMonitor } from '../../cost-monitor/index.js';
import { openRouterModule } from '../../openrouter/index.js';
import { logger } from '../../../utils/logger.js';
import { BenchmarkConfig, BenchmarkResult, Model, BenchmarkTaskParams } from '../../../types/index.js';
import { callLmStudioApi } from '../api/lm-studio.js';
import { callOllamaApi } from '../api/ollama.js';
import { simulateOpenAiApi, simulateGenericApi } from '../api/simulation.js';
import { evaluateQuality } from '../evaluation/quality.js';
import { saveResult } from '../storage/results.js';

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
      
      // Measure response time
      const startTime = Date.now();
      
      // Call the appropriate API based on model provider
      let response;
      let success = false;
      let qualityScore = 0;
      let promptTokens = 0;
      let completionTokens = 0;
      
      if (model.provider === 'lm-studio') {
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
      
      const endTime = Date.now();
      const timeTaken = endTime - startTime;
      
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
  
  if (params.paidModel) {
    // If a specific paid model is requested, use it
    paidModel = availableModels.find(m => m.id === params.paidModel && m.provider !== 'local' && m.provider !== 'lm-studio' && m.provider !== 'ollama');
  } else if ('isConfigured' in openRouterModule && typeof openRouterModule.isConfigured === 'function') {
    try {
      // Initialize OpenRouter module if needed
      if (Object.keys(openRouterModule.modelTracking.models).length === 0) {
        await openRouterModule.initialize();
      }
      
      // Get free models
      const freeModels = await costMonitor.getFreeModels();
      
      if (freeModels.length > 0) {
        // Find the best free model for this task
        const bestFreeModel = freeModels.find(m => {
          // Check if the model can handle the context length
          return m.contextWindow && m.contextWindow >= (contextLength + expectedOutputLength);
        });
        
        if (bestFreeModel) {
          paidModel = bestFreeModel;
          logger.info(`Using free model ${bestFreeModel.id} from OpenRouter`);
        }
      }
    } catch (error) {
      logger.error('Error getting free models from OpenRouter:', error);
    }
  }
  
  if (!localModel) {
    throw new Error('No local model available for benchmarking');
  }
  
  // Initialize result
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
        total: 0,
      },
      output: '',
    },
    paid: {
      model: paidModel?.id || 'gpt-3.5-turbo',
      timeTaken: 0,
      successRate: 0,
      qualityScore: 0,
      tokenUsage: {
        prompt: 0,
        completion: 0,
        total: 0,
      },
      cost: 0,
      output: '',
    },
    timestamp: new Date().toISOString(),
  };
  
  // Run benchmark for local model
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
  
  // Run benchmark for paid model if available and not skipped
  if (paidModel && !skipPaidModel) {
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
    
    // Use the paid model's output length if it's available
    if (paidResults.tokenUsage.completion > 0) {
      result.outputLength = paidResults.tokenUsage.completion;
    }
  }
  
  // Save result if configured
  if (config.saveResults) {
    await saveResult(result, config.resultsPath);
  }
  
  return result;
}