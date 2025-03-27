import { logger } from '../../../utils/logger.js';
import { openRouterModule } from '../../openrouter/index.js';
import { modelsDbService } from './modelsDb.js';
import { costMonitor } from '../../cost-monitor/index.js';
import { COMPLEXITY_THRESHOLDS, ModelPerformanceData } from '../types/index.js';
import { BenchmarkResult, BenchmarkSummary } from '../../../types/benchmark.js';
import { saveResult } from '../../benchmark/storage/results.js';
import { callLmStudioApi } from '../../benchmark/api/lm-studio.js';
import { callOllamaApi } from '../../benchmark/api/ollama.js';
import fs from 'fs/promises';
import path from 'path';

// Add this interface at the top of the file with other types
/**
 * Represents the comprehensive results of benchmarking one or more AI models.
 * 
 * @remarks
 * This interface is designed to store various performance metrics collected
 * over a set of benchmarks, including success rates, quality and complexity
 * scores, as well as average response times. An optional summary can be
 * provided, offering quick insights into overall metrics across all models.
 *
 * @property timestamp
 * The date and time at which these benchmark results were recorded.
 *
 * @property models
 * An object containing individual benchmark metrics for each model, keyed by
 * the model identifier.
 *
 * @property models.[modelId].successRate
 * The ratio of successful responses to total attempts for a particular model.
 *
 * @property models.[modelId].qualityScore
 * A numerical measure of the response quality for a particular model.
 *
 * @property models.[modelId].avgResponseTime
 * The average time (in milliseconds) taken by a particular model to produce a response.
 *
 * @property models.[modelId].benchmarkCount
 * The total number of benchmark tests executed for a particular model.
 *
 * @property models.[modelId].complexityScore
 * A score reflecting the computational or task complexity handled by a particular model.
 *
 * @property summary
 * An optional section summarizing the results across all tested models.
 *
 * @property summary.totalModels
 * The total number of models included in the benchmark.
 *
 * @property summary.averageSuccessRate
 * The overall average success rate spanning all tested models.
 *
 * @property summary.averageQualityScore
 * The overall average quality score spanning all tested models.
 */
interface ComprehensiveBenchmarkResults {
  timestamp: string;
  models: {
    [modelId: string]: {
      successRate: number;
      qualityScore: number;
      avgResponseTime: number;
      benchmarkCount: number;
      complexityScore: number;
    };
  };
  summary?: {
    totalModels: number;
    averageSuccessRate: number;
    averageQualityScore: number;
  };
}

/**
 * Represents the internal state of a benchmarking process, including rate-limiting status.
 *
 * @property isRateLimited - Indicates whether the current state has triggered a rate limit.
 * @property lastRateLimitTime - The most recent timestamp when a rate limit was applied.
 * @property failedAttempts - The count of consecutive failed benchmark attempts.
 */
interface BenchmarkState {
  isRateLimited: boolean;
  lastRateLimitTime?: Date;
  failedAttempts: number;
}

const benchmarkState: BenchmarkState = {
  isRateLimited: false,
  failedAttempts: 0
};

/**
 * Normalize task name to a consistent format (lowercase with hyphens)
 * This ensures consistent folder naming across benchmark runs
 * 
 * @param taskName The task name to normalize
 * @returns Normalized task name (lowercase with hyphens)
 */
function normalizeTaskName(taskName: string): string {
  return taskName.toLowerCase().replace(/\s+/g, '-');
}

/**
 * Capitalize each word in a string
 */
function capitalizeWords(str: string): string {
  return str.replace(/\b\w/g, c => c.toUpperCase());
}

// Define the benchmark utilities first
/**
 * A utility object containing methods for loading and processing benchmark results,
 * checking the existence of benchmark directories, generating summaries based on
 * benchmark data, and saving those summaries to disk.
 *
 * @remarks
 * This utility operates by interfacing with the file system, reading benchmark
 * result files, parsing their contents into structured objects, and computing
 * metrics to derive useful insights. It also accommodates variations in directory
 * naming conventions and provides convenience methods for persisting summary data.
 *
 * @public
 *
 * @typedef BenchmarkResult
 * Describes the structure of a single benchmark result.
 *
 * @typedef BenchmarkSummary
 * Defines the summary statistics computed across multiple benchmark results.
 *
 * @function loadResults
 * Reads benchmark result files recursively from a specified directory, ignoring
 * summary files.
 * @param benchmarkDir - The top-level directory containing benchmark JSON files.
 * @returns An array of parsed benchmark results.
 *
 * @function benchmarkDirectoryExists
 * Determines whether a directory for a specific model ID and task name exists under
 * the base benchmark directory. It checks various possible naming conventions.
 * @param baseDir - Path to the base directory containing benchmark data.
 * @param modelId - Identifier for the model, used to locate the correct directory.
 * @param taskName - The name of the task to match against different naming patterns.
 * @returns True if at least one matching directory is found, false otherwise.
 *
 * @function generateSummary
 * Calculates aggregate metrics over an array of benchmark results, including
 * average time, success rate, quality score, token usage, and potential cost savings.
 * @param results - Array of benchmark results to summarize.
 * @returns A summarized object containing both local and paid performance metrics.
 *
 * @function saveSummary
 * Writes a generated benchmark summary to a JSON file in the provided directory.
 * @param summary - The benchmark summary object to persist.
 * @param benchmarkDir - Directory where the summary.json file should be written.
 */
const benchmarkUtils = {
  /**
   * Load benchmark results from a directory, recursively scanning subdirectories
   */
  async loadResults(benchmarkDir: string): Promise<BenchmarkResult[]> {
    try {
      const results: BenchmarkResult[] = [];
      
      // Function to recursively scan directories
      async function scanDirectory(dir: string) {
        const files = await fs.readdir(dir);
        
        for (const file of files) {
          const fullPath = path.join(dir, file);
          const stats = await fs.stat(fullPath);
          
          if (stats.isDirectory()) {
            // Recursively scan subdirectories
            await scanDirectory(fullPath);
          } else if (file.endsWith('.json') && !file.startsWith('summary')) {
            try {
              const content = await fs.readFile(fullPath, 'utf-8');
              const result = JSON.parse(content) as BenchmarkResult;
              results.push(result);
              logger.debug(`Loaded benchmark result from ${fullPath}`);
            } catch (error) {
              logger.error(`Failed to parse benchmark result: ${fullPath}`, error);
            }
          }
        }
      }
      
      await scanDirectory(benchmarkDir);
      logger.info(`Loaded ${results.length} benchmark results from ${benchmarkDir}`);
      return results;
    } catch (error) {
      logger.error('Failed to load benchmark results:', error);
      return [];
    }
  },

  /**
   * Check if a benchmark directory exists, supporting multiple naming conventions
   * 
   * @param baseDir Base directory for benchmarks
   * @param modelId Model ID
   * @param taskName Task name (will check all formats)
   * @returns True if directory exists in any naming format
   */
  async benchmarkDirectoryExists(
    baseDir: string, 
    modelId: string, 
    taskName: string
  ): Promise<boolean> {
    const modelDir = path.join(baseDir, modelId.replace(/\//g, '-'));
    
    try {
      // Check if model directory exists
      await fs.access(modelDir);
      
      // All possible naming formats to check
      const possibleTaskNames = [
        normalizeTaskName(taskName),              // normalized format (simple-function)
        taskName,                                 // original format (simple-function)
        taskName.replace(/-/g, ' '),              // space-separated (simple function)
        capitalizeWords(taskName.replace(/-/g, ' ')), // capitalized (Simple function)
        taskName.split('-')[0],                   // first word only (simple)
        capitalizeWords(taskName.split('-')[0])   // capitalized first word (Simple)
      ];
      
      // Check all possible directory names
      for (const name of possibleTaskNames) {
        try {
          const taskDir = path.join(modelDir, name);
          await fs.access(taskDir);
          logger.debug(`Found benchmark directory: ${taskDir}`);
          return true;
        } catch {
          // This format doesn't exist, try next one
        }
      }
      
      // None of the formats exist
      return false;
    } catch {
      // Model directory doesn't exist
      return false;
    }
  },

  /**
   * Generate summary from benchmark results
   */
  generateSummary(results: BenchmarkResult[]): BenchmarkSummary {
    // Initialize summary data
    const summary: BenchmarkSummary = {
      taskCount: results.length,
      avgContextLength: 0,
      avgOutputLength: 0,
      avgComplexity: 0,
      local: {
        avgTimeTaken: 0,
        avgSuccessRate: 0,
        avgQualityScore: 0,
        totalTokenUsage: { prompt: 0, completion: 0, total: 0 }
      },
      paid: {
        avgTimeTaken: 0,
        avgSuccessRate: 0,
        avgQualityScore: 0,
        totalTokenUsage: { prompt: 0, completion: 0, total: 0 },
        totalCost: 0
      },
      comparison: {
        timeRatio: 0,
        successRateDiff: 0,
        qualityScoreDiff: 0,
        costSavings: 0
      },
      timestamp: new Date().toISOString()
    };

    // Calculate averages and totals
    let localResultCount = 0;
    let paidResultCount = 0;
    let totalContextLength = 0;
    let totalOutputLength = 0;
    let totalComplexity = 0;
    let validContextCount = 0;
    let validOutputCount = 0;
    let validComplexityCount = 0;

    for (const result of results) {
      // Only count non-null/non-undefined values
      if (result.contextLength !== null && result.contextLength !== undefined) {
        totalContextLength += result.contextLength;
        validContextCount++;
      }
      
      if (result.outputLength !== null && result.outputLength !== undefined) {
        totalOutputLength += result.outputLength;
        validOutputCount++;
      }
      
      if (result.complexity !== null && result.complexity !== undefined) {
        totalComplexity += result.complexity;
        validComplexityCount++;
      }

      if (result.local) {
        localResultCount++;
        summary.local.avgTimeTaken += result.local.timeTaken || 0;
        summary.local.avgSuccessRate += result.local.successRate || 0;
        summary.local.avgQualityScore += result.local.qualityScore || 0;
        summary.local.totalTokenUsage.prompt += result.local.tokenUsage?.prompt || 0;
        summary.local.totalTokenUsage.completion += result.local.tokenUsage?.completion || 0;
        summary.local.totalTokenUsage.total += result.local.tokenUsage?.total || 0;
      }

      if (result.paid) {
        paidResultCount++;
        summary.paid.avgTimeTaken += result.paid.timeTaken || 0;
        summary.paid.avgSuccessRate += result.paid.successRate || 0;
        summary.paid.avgQualityScore += result.paid.qualityScore || 0;
        summary.paid.totalTokenUsage.prompt += result.paid.tokenUsage?.prompt || 0;
        summary.paid.totalTokenUsage.completion += result.paid.tokenUsage?.completion || 0;
        summary.paid.totalTokenUsage.total += result.paid.tokenUsage?.total || 0;
        summary.paid.totalCost += result.paid.cost || 0;
      }
    }

    // Calculate final averages, avoiding division by zero
    summary.avgContextLength = validContextCount > 0 ? totalContextLength / validContextCount : 0;
    summary.avgOutputLength = validOutputCount > 0 ? totalOutputLength / validOutputCount : 0;
    summary.avgComplexity = validComplexityCount > 0 ? totalComplexity / validComplexityCount : 0;

    if (localResultCount > 0) {
      summary.local.avgTimeTaken /= localResultCount;
      summary.local.avgSuccessRate /= localResultCount;
      summary.local.avgQualityScore /= localResultCount;
    }

    if (paidResultCount > 0) {
      summary.paid.avgTimeTaken /= paidResultCount;
      summary.paid.avgSuccessRate /= paidResultCount;
      summary.paid.avgQualityScore /= paidResultCount;
    }

    // Calculate comparisons
    if (localResultCount > 0 && paidResultCount > 0) {
      // Avoid division by zero for timeRatio
      summary.comparison.timeRatio = summary.paid.avgTimeTaken > 0 ? 
        summary.local.avgTimeTaken / summary.paid.avgTimeTaken : 0;
      
      summary.comparison.successRateDiff = summary.local.avgSuccessRate - summary.paid.avgSuccessRate;
      summary.comparison.qualityScoreDiff = summary.local.avgQualityScore - summary.paid.avgQualityScore;
      summary.comparison.costSavings = summary.paid.totalCost; // All cost saved when using local
    } else if (localResultCount > 0) {
      // If we only have local results, set comparison data appropriately
      summary.comparison.successRateDiff = summary.local.avgSuccessRate;
      summary.comparison.qualityScoreDiff = summary.local.avgQualityScore;
      // timeRatio and costSavings remain 0
    }

    return summary;
  },

  /**
   * Save benchmark summary to a directory
   */
  async saveSummary(summary: BenchmarkSummary, benchmarkDir: string): Promise<void> {
    try {
      const summaryPath = path.join(benchmarkDir, 'summary.json');
      await fs.writeFile(summaryPath, JSON.stringify(summary, null, 2));
      logger.info('Saved benchmark summary to:', summaryPath);
    } catch (error) {
      logger.error('Failed to save benchmark summary:', error);
    }
  }
};

/**
 * Benchmark Service
 * Handles model benchmarking operations
 */
export const benchmarkService = {
  /**
   * Benchmark a model with a simple task
   * This helps us gather performance data for models
   */
  async benchmarkModel(modelId: string, complexity: number, provider: string = 'openrouter'): Promise<void> {
    logger.debug(`Benchmarking model: ${modelId} with complexity ${complexity}`);
    
    try {
      // Get the models database
      const modelsDb = modelsDbService.getDatabase();
      
      // Check if we've already benchmarked this model recently
      const modelData = modelsDb.models[modelId] as ModelPerformanceData;
      if (!modelData) {
        logger.warn(`Model ${modelId} not found in models database`);
        return;
      }
      
      // Skip if we've already benchmarked this model recently (within 7 days)
      if (modelData.lastBenchmarked) {
        const lastBenchmarked = new Date(modelData.lastBenchmarked);
        const now = new Date();
        const daysSinceLastBenchmark = (now.getTime() - lastBenchmarked.getTime()) / (1000 * 60 * 60 * 24);
        
        if (daysSinceLastBenchmark < 7 && modelData.benchmarkCount >= 3) {
          logger.debug(`Skipping benchmark for ${modelId} - already benchmarked ${modelData.benchmarkCount} times, last on ${modelData.lastBenchmarked}`);
          return;
        }
      }
      
      // Generate a simple task based on complexity
      let task: string;
      if (complexity <= COMPLEXITY_THRESHOLDS.SIMPLE) {
        task = "Write a function to calculate the factorial of a number.";
      } else if (complexity <= COMPLEXITY_THRESHOLDS.MEDIUM) {
        task = "Implement a binary search algorithm and explain its time complexity.";
      } else {
        task = "Design a class hierarchy for a library management system with inheritance and polymorphism.";
      }
      
      // Measure start time
      const startTime = Date.now();
      
      let result;
      if (provider === 'openrouter') {
        // Call the model using OpenRouter
        result = await openRouterModule.callOpenRouterApi(
          modelId,
          task,
          60000 // 60 second timeout
        );
      } else {
        // For local models, we would use a different API
        // This is a placeholder for future implementation
        logger.warn(`Benchmarking for provider ${provider} not yet implemented`);
        return;
      }
      
      // Measure end time
      const endTime = Date.now();
      const responseTime = endTime - startTime;
      
      // Update the model data
      if (result && result.success) {
        // Calculate quality score based on the response
        const qualityScore = openRouterModule.evaluateQuality(task, result.text || '');
        
        // Update the model data with a weighted average
        const benchmarkCount = modelData.benchmarkCount + 1;
        const weightedSuccessRate = (modelData.successRate * modelData.benchmarkCount + 1) / benchmarkCount;
        const weightedQualityScore = (modelData.qualityScore * modelData.benchmarkCount + qualityScore) / benchmarkCount;
        const weightedResponseTime = (modelData.avgResponseTime * modelData.benchmarkCount + responseTime) / benchmarkCount;
        
        // Update the model data
        modelsDb.models[modelId] = {
          ...modelData,
          successRate: weightedSuccessRate,
          qualityScore: weightedQualityScore,
          avgResponseTime: weightedResponseTime,
          complexityScore: complexity,
          lastBenchmarked: new Date().toISOString(),
          benchmarkCount
        } as ModelPerformanceData;
        
        logger.info(`Successfully benchmarked ${modelId}: Quality=${qualityScore.toFixed(2)}, Time=${responseTime}ms`);
      } else if (result) {
        // Update failure rate
        const benchmarkCount = modelData.benchmarkCount + 1;
        const weightedSuccessRate = (modelData.successRate * modelData.benchmarkCount) / benchmarkCount;
        
        // Update the model data
        modelsDb.models[modelId] = {
          ...modelData,
          successRate: weightedSuccessRate,
          lastBenchmarked: new Date().toISOString(),
          benchmarkCount
        } as ModelPerformanceData;
        
        logger.warn(`Failed to benchmark ${modelId}: ${result.error}`);
      }
      
      // Save the database - modelsDbService doesn't have a save method, use updateModelData instead
      await modelsDbService.updateModelData(modelId, modelsDb.models[modelId]);
    } catch (error) {
      logger.error(`Error benchmarking model ${modelId}:`, error);
    }
  },

  /**
   * Benchmark all available free models
   * This helps us gather performance data for all free models
   * to make better decisions in the future
   */
  async benchmarkFreeModels(): Promise<void> {
    if (benchmarkState.isRateLimited) {
      const timeSinceLimit = benchmarkState.lastRateLimitTime ? 
        (new Date().getTime() - benchmarkState.lastRateLimitTime.getTime()) / 1000 : 0;
      
      if (timeSinceLimit < 3600) { // Wait at least 1 hour after rate limit
        logger.warn(`Skipping benchmarks - rate limited (${Math.round(timeSinceLimit)}s ago)`);
        return;
      }
      benchmarkState.isRateLimited = false;
      benchmarkState.failedAttempts = 0;
    }

    logger.info('Starting benchmark of free models');
    
    try {
      // Ensure the models database is initialized
      await modelsDbService.initialize();
      
      // Get free models from OpenRouter
      const freeModels = await costMonitor.getFreeModels();
      
      // Get available models to check for LM Studio models
      const availableModels = await costMonitor.getAvailableModels();
      
      // Find LM Studio models and add them to the free models pool
      const lmStudioModels = availableModels.filter(m => m.provider === 'lm-studio');
      
      // Combine OpenRouter free models with LM Studio models
      let allFreeModels = [...freeModels];
      
      if (lmStudioModels.length > 0) {
        logger.info(`Including ${lmStudioModels.length} LM Studio models in free models pool for benchmarking`);
        allFreeModels = [...lmStudioModels, ...freeModels];
      }
      
      if (allFreeModels.length === 0) {
        logger.warn('No free models available to benchmark');
        return;
      }
      
      logger.info(`Found ${allFreeModels.length} free models to benchmark`);
      
      // Define test tasks with normalized names and varying complexity
      const benchmarkTasks = [
        {
          // Use normalized name format (lowercase with hyphens)
          name: 'simple-function',
          task: 'Write a function to calculate the factorial of a number.',
          complexity: 0.2,
          codeCheck: (response: string) => {
            // Using the more comprehensive quality evaluation function with gradual scoring
            const score = this.evaluateCodeQuality(
              'Write a function to calculate the factorial of a number.',
              response,
              'factorial'
            );
            
            // Return true if meets minimum threshold but preserve actual score
            return score >= 0.5; // Lowered threshold for more granular results
          }
        },
        {
          // Use normalized name format (lowercase with hyphens)
          name: 'medium-algorithm',
          task: 'Implement a binary search algorithm and explain its time complexity.',
          complexity: 0.5,
          codeCheck: (response: string) => {
            // Using the more comprehensive quality evaluation function with gradual scoring
            const score = this.evaluateCodeQuality(
              'Implement a binary search algorithm and explain its time complexity.',
              response,
              'binary-search'
            );
            
            // Return true if meets minimum threshold but preserve actual score
            return score >= 0.5; // Lowered threshold for more granular results
          }
        }
      ];
      
      // Check which models have already been benchmarked
      const modelsDb = modelsDbService.getDatabase();
      const benchmarkDir = path.join(process.cwd(), 'benchmark-results');
      const modelBenchmarkStatus = new Map<string, Set<string>>();
      
      // First check if models have been benchmarked based on persistence data
      logger.info('Checking for existing benchmark results...');
      
      for (const model of allFreeModels) {
        const modelId = model.id;
        modelBenchmarkStatus.set(modelId, new Set<string>());
        
        // Check if model exists in database and has been benchmarked
        const modelData = modelsDb.models[modelId] as ModelPerformanceData;
        if (modelData && modelData.benchmarkCount > 0 && modelData.lastBenchmarked) {
          // Assume all tasks have been benchmarked if the model has benchmark data
          for (const task of benchmarkTasks) {
            modelBenchmarkStatus.get(modelId)!.add(task.name);
            logger.debug(`Found existing benchmark data in database for model ${modelId}, task ${task.name}`);
          }
          continue;
        }
        
        // If not in database, check on disk
        for (const task of benchmarkTasks) {
          // Check all possible naming variations in benchmark directories
          const hasExistingBenchmark = await benchmarkUtils.benchmarkDirectoryExists(
            benchmarkDir,
            modelId,
            task.name
          );
          
          if (hasExistingBenchmark) {
            modelBenchmarkStatus.get(modelId)!.add(task.name);
            logger.debug(`Found existing benchmark directory for model ${modelId}, task ${task.name}`);
          }
        }
      }
      
      // Count models with complete benchmarks (all tasks benchmarked)
      const fullyBenchmarkedModels = Array.from(modelBenchmarkStatus.entries())
        .filter(([_, tasks]) => tasks.size === benchmarkTasks.length)
        .map(([modelId]) => modelId);
      
      logger.info(`Found ${fullyBenchmarkedModels.length} models with complete benchmarks out of ${allFreeModels.length} total models`);
      
      // If all models are fully benchmarked, just generate the summary
      if (fullyBenchmarkedModels.length === allFreeModels.length) {
        logger.info('All models already have complete benchmarks, no need to run benchmarks');
        
        // Generate comprehensive summary from all benchmark results
        await this.generateComprehensiveSummary();
        
        // Update model performance profiles
        await this.updateModelPerformanceProfiles();
        return;
      }
      
      // Get the number of models to benchmark per run from environment or default to 5
      const maxModelsPerRun = process.env.MAX_MODELS_TO_BENCHMARK ?
        parseInt(process.env.MAX_MODELS_TO_BENCHMARK, 10) : 5;
      
      // Prioritize models that haven't been benchmarked completely
      const unbenchmarkedModels = allFreeModels.filter(
        model => !fullyBenchmarkedModels.includes(model.id)
      );
      
      logger.info(`Found ${unbenchmarkedModels.length} models needing benchmarking out of ${allFreeModels.length} total free models`);
      
      // Select models to benchmark in this run (up to maxModelsPerRun)
      const modelsToBenchmark = unbenchmarkedModels.slice(0, maxModelsPerRun);
      
      logger.info(`Will benchmark ${modelsToBenchmark.length} models in this run`);
      logger.info(`Set MAX_MODELS_TO_BENCHMARK environment variable to test more models per run`);
      
      // Benchmark each model with each task
      for (const model of modelsToBenchmark) {
        logger.info(`Benchmarking model: ${model.id}`);
        
        for (const task of benchmarkTasks) {
          // Skip if this task has already been benchmarked for this model
          if (modelBenchmarkStatus.get(model.id)?.has(task.name)) {
            logger.info(`Skipping task ${task.name} for model ${model.id} - benchmark already exists`);
            continue;
          }
          
          logger.info(`Task: ${task.name} (complexity: ${task.complexity})`);
          
          try {
            const startTime = Date.now();
            
            let result;
            // Call the appropriate API based on model provider
            if (model.provider === 'lm-studio') {
              logger.info(`Calling LM Studio API for model ${model.id}`);
              result = await callLmStudioApi(
                model.id,
                task.task,
                120000 // 2 minute timeout
              );
            } else if (model.provider === 'ollama') {
              logger.info(`Calling Ollama API for model ${model.id}`);
              result = await callOllamaApi(
                model.id,
                task.task,
                120000 // 2 minute timeout
              );
            } else {
              // Default to OpenRouter for other providers
              logger.info(`Calling OpenRouter API for model ${model.id}`);
              result = await openRouterModule.callOpenRouterApi(
                model.id,
                task.task,
                120000 // 2 minute timeout
              );
            }
            
            const endTime = Date.now();
            const responseTime = endTime - startTime;
            
            let qualityScore = 0;
            let isWorkingCode = false;
            
            if (result && result.success && result.text) {
              // Check if the code works and get quality score
              qualityScore = openRouterModule.evaluateQuality(task.task, result.text);
              isWorkingCode = task.codeCheck(result.text);
              
              // Create a benchmark result record
              const taskResult: BenchmarkResult = {
                // Use normalized task name for consistent file saving
                taskId: `${task.name}-${model.id}`,
                task: task.task,
                contextLength: task.task.length,
                outputLength: result.text ? result.text.length : 0,
                complexity: task.complexity,
                local: {
                  model: model.id,
                  timeTaken: responseTime,
                  successRate: isWorkingCode ? 1 : 0,
                  qualityScore: qualityScore,
                  tokenUsage: {
                    prompt: result.usage?.prompt_tokens || task.task.length / 4,
                    completion: result.usage?.completion_tokens || (result.text ? result.text.length / 4 : 0),
                    total: (result.usage?.prompt_tokens || task.task.length / 4) + (result.usage?.completion_tokens || (result.text ? result.text.length / 4 : 0))
                  },
                  output: result.text || ''
                },
                paid: {
                  model: 'none',
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

              // Save the benchmark result
              try {
                await saveResult(taskResult, path.join(process.cwd(), 'benchmark-results'));
                logger.info(`Saved benchmark result for ${model.id} with task ${task.name} to benchmark-results folder`);
              } catch (saveError) {
                logger.error(`Error saving benchmark result for ${model.id}: ${String(saveError)}`);
              }

              // Update the model data
              if (!modelsDb.models[model.id]) {
                // Initialize model data if it doesn't exist
                modelsDb.models[model.id] = {
                  id: model.id,
                  name: model.name || model.id,
                  provider: 'openrouter',
                  lastSeen: new Date().toISOString(),
                  contextWindow: model.contextWindow || 4096,
                  successRate: isWorkingCode ? 1 : 0,
                  qualityScore: qualityScore,
                  avgResponseTime: responseTime,
                  complexityScore: task.complexity,
                  lastBenchmarked: new Date().toISOString(),
                  benchmarkCount: 1,
                  isFree: true
                } as ModelPerformanceData;
              } else {
                // Update existing model data with a weighted average
                const modelPerf = modelsDb.models[model.id] as ModelPerformanceData;
                const benchmarkCount = modelPerf.benchmarkCount + 1;
                const weightedSuccessRate = (modelPerf.successRate *
                  modelPerf.benchmarkCount + (isWorkingCode ? 1 : 0)) / benchmarkCount;
                const weightedQualityScore = (modelPerf.qualityScore *
                  modelPerf.benchmarkCount + qualityScore) / benchmarkCount;
                const weightedResponseTime = (modelPerf.avgResponseTime *
                  modelPerf.benchmarkCount + responseTime) / benchmarkCount;
                
                modelsDb.models[model.id] = {
                  ...modelPerf,
                  successRate: weightedSuccessRate,
                  qualityScore: weightedQualityScore,
                  avgResponseTime: weightedResponseTime,
                  complexityScore: (modelPerf.complexityScore + task.complexity) / 2,
                  lastBenchmarked: new Date().toISOString(),
                  benchmarkCount
                } as ModelPerformanceData;
              }
              
              logger.info(`Benchmarked ${model.id} with task ${task.name}: Working code=${isWorkingCode}, Quality=${qualityScore.toFixed(2)}, Time=${responseTime}ms`);
            } else {
              // Model failed to produce a response
              if (!modelsDb.models[model.id]) {
                // Initialize model data if it doesn't exist
                modelsDb.models[model.id] = {
                  id: model.id,
                  name: model.name || model.id,
                  provider: 'openrouter',
                  lastSeen: new Date().toISOString(),
                  contextWindow: model.contextWindow || 4096,
                  successRate: 0,
                  qualityScore: 0,
                  avgResponseTime: 0,
                  complexityScore: task.complexity,
                  lastBenchmarked: new Date().toISOString(),
                  benchmarkCount: 1,
                  isFree: true
                } as ModelPerformanceData;
              } else {
                // Update failure rate
                const modelPerf = modelsDb.models[model.id] as ModelPerformanceData;
                const benchmarkCount = modelPerf.benchmarkCount + 1;
                const weightedSuccessRate = (modelPerf.successRate *
                  modelPerf.benchmarkCount) / benchmarkCount;
                
                modelsDb.models[model.id] = {
                  ...modelPerf,
                  successRate: weightedSuccessRate,
                  lastBenchmarked: new Date().toISOString(),
                  benchmarkCount
                } as ModelPerformanceData;
              }
              
              // Create a benchmark result record for the failed attempt
              const failedResult: BenchmarkResult = {
                // Use normalized task name for consistent file saving
                taskId: `${task.name}-${model.id}-failed`,
                task: task.task,
                contextLength: task.task.length,
                outputLength: 0,
                complexity: task.complexity,
                local: {
                  model: model.id,
                  timeTaken: responseTime,
                  successRate: 0,
                  qualityScore: 0,
                  tokenUsage: {
                    prompt: result?.usage?.prompt_tokens || task.task.length / 4,
                    completion: 0,
                    total: result?.usage?.prompt_tokens || task.task.length / 4
                  },
                  output: result?.text || ''
                },
                paid: {
                  model: 'none',
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
              
              // Save the failed benchmark result
              try {
                await saveResult(failedResult, path.join(process.cwd(), 'benchmark-results'));
                logger.info(`Saved failed benchmark result for ${model.id} with task ${task.name} to benchmark-results folder`);
              } catch (saveError) {
                logger.error(`Error saving failed benchmark result for ${model.id}: ${String(saveError)}`);
              }
              
              logger.warn(`Model ${model.id} failed to produce a valid response for task ${task.name}`);
            }
            
            // Save the database after each benchmark to preserve progress
            // Use updateModelData instead of the non-existent save method
            await modelsDbService.updateModelData(model.id, modelsDb.models[model.id]);
            
          } catch (error) {
            const errorMsg = error instanceof Error ? error.message : String(error);
            
            // Check for rate limit errors
            if (errorMsg.toLowerCase().includes('rate limit') || 
                errorMsg.toLowerCase().includes('quota') ||
                (error instanceof Object && 'code' in error && error.code === 429)) {
              
              benchmarkState.isRateLimited = true;
              benchmarkState.lastRateLimitTime = new Date();
              benchmarkState.failedAttempts++;
              
              logger.warn(`Rate limit detected, stopping benchmarks. Failed attempts: ${benchmarkState.failedAttempts}`);
              
              // If we've hit rate limits multiple times, wait longer before retrying
              if (benchmarkState.failedAttempts >= 3) {
                logger.warn('Multiple rate limits encountered, skipping remaining benchmarks');
                return;
              }
              
              break; // Exit the model loop
            }

            logger.error(`Error benchmarking ${model.id} with task ${task.name}:`, error);
            
            // Mark the model as failed in the database
            if (modelsDb.models[model.id]) {
              const modelPerf = modelsDb.models[model.id] as ModelPerformanceData;
              const benchmarkCount = modelPerf.benchmarkCount + 1;
              const weightedSuccessRate = (modelPerf.successRate *
                modelPerf.benchmarkCount) / benchmarkCount;
              
              modelsDb.models[model.id] = {
                ...modelPerf,
                successRate: weightedSuccessRate,
                lastBenchmarked: new Date().toISOString(),
                benchmarkCount
              } as ModelPerformanceData;
              
              await modelsDbService.updateModelData(model.id, modelsDb.models[model.id]);
            }
          }
          
          // Add a significant delay between benchmarks to avoid rate limiting
          // 5 seconds between tasks for the same model
          logger.info(`Waiting 5 seconds before next benchmark...`);
          await new Promise(resolve => setTimeout(resolve, 5000));
        }
        
        // Add a longer delay between models
        // 10 seconds between different models
        logger.info(`Waiting 10 seconds before benchmarking next model...`);
        await new Promise(resolve => setTimeout(resolve, 10000));
      }
      
      logger.info('Completed benchmarking of free models');
    } catch (error) {
      logger.error('Error benchmarking free models:', error);
    }

    // Update model performance profiles after benchmarking
    await this.updateModelPerformanceProfiles();
    
    // Generate comprehensive summary from all benchmark results
    await this.generateComprehensiveSummary();
  },

  /**
   * Simple helper to evaluate code quality for benchmarking
   * This is a simplified version - the full version is in the codeEvaluation service
   */
  evaluateCodeQuality(task: string, response: string, taskType: string = 'general'): number {
    try {
      let score = 0;
      
      // Pre-process response to handle "thinking" model responses (like deepseek-r1)
      // Strip out thinking sections and other special tokens that might interfere with evaluation
      const cleanedResponse = this.cleanModelResponse(response);
      
      const responseLower = cleanedResponse.toLowerCase();
      
      // Check if response contains actual code and validate language format
      const codePatterns = {
        hasFunction: /\b(?:function|def|class|const|let|var)\b/.test(cleanedResponse),
        hasCodeBlock: /```[\s\S]*?```/.test(cleanedResponse) || 
                     /^[ ]{4}[\s\S]+/m.test(cleanedResponse) || 
                     /<code>[\s\S]*?<\/code>/.test(cleanedResponse),
        hasDocs: /(?:\/\*[\s\S]*?\*\/|\/\/.*|#.*|"""[\s\S]*?"""|'''[\s\S]*?''')/.test(cleanedResponse)
      };

      if (!codePatterns.hasFunction || !codePatterns.hasCodeBlock) {
        return 0.1; // Minimal score for any response with no proper code
      }

      // Base score for proper code formatting
      score += 0.2;
      if (codePatterns.hasDocs) score += 0.1;

      // Task-specific scoring
      switch(taskType) {
        case 'factorial': {
          // Check for factorial implementation
          if (responseLower.includes('factorial')) {
            score += 0.1;
            
            // Base case handling
            if (/(?:n\s*(?:==|<=)\s*[01]|if\s*\(\s*n\s*(?:==|<=)\s*[01]\))/.test(response)) {
              score += 0.1;
            }
            
            // Proper recursion or iteration
            if (/(for|while).*\b(n|i)\b.*\*/.test(response) || 
                /return.*factorial.*\(.*n\s*-\s*1.*\)/.test(response)) {
              score += 0.2;
            }
            
            // Input validation
            if (/(?:if|throw|raise).*(?:<\s*0|negative)/.test(response)) {
              score += 0.1;
            }
            
            // Example usage or test case
            if (/(?:console\.log|print|assert).*factorial/.test(response)) {
              score += 0.1;
            }
          }
          break;
        }

        case 'binary-search': {
          // Check for binary search core components
          const binarySearchPatterns = {
            hasCoreLogic: /(?:mid|middle)\s*=.*(?:\/\s*2|>>\s*1)/.test(response), // Fixed escape chars
            hasPointers: /(?:left|low|right|high)\s*=/.test(response),
            hasComparison: /(?:if|while).*(?:>|<|==)/.test(response),
            hasComplexity: /[oO]\s*\(\s*log\s*[nN]\s*\)/.test(response),
            hasExplanation: /(?:time|space)\s*complex/i.test(response)
          };

          if (responseLower.includes('binary') && responseLower.includes('search')) {
            score += 0.1;
            
            // Core algorithm components
            if (binarySearchPatterns.hasCoreLogic) score += 0.2;
            if (binarySearchPatterns.hasPointers) score += 0.1;
            if (binarySearchPatterns.hasComparison) score += 0.1;
            
            // Complexity analysis
            if (binarySearchPatterns.hasComplexity) score += 0.2;
            if (binarySearchPatterns.hasExplanation) score += 0.1;
            
            // Example or test case
            if (/(?:example|test).*\[.*\]/.test(response)) {
              score += 0.1;
            }
          }
          break;
        }

        default: {
          // General code quality scoring
          // Documentation quality
          const docScore = codePatterns.hasDocs ? 0.2 : 0;
          score += docScore;
          
          // Error handling
          if (/(?:try|catch|throw|raise)/.test(response)) {
            score += 0.2;
          }
          
          // Input validation
          if (/if.*(?:undefined|null|typeof|instanceof)/.test(response)) {
            score += 0.2;
          }
          
          // Example usage
          if (/(?:example|test)/.test(response)) {
            score += 0.2;
          }
        }
      }

      // Cap score between 0 and 1
      return Math.min(1, Math.max(0, score));
    } catch (error) {
      logger.error(`Error evaluating code quality for task ${taskType}:`, error);
      return 0.1; // Return minimal score on error
    }
  },
  
  /**
   * Clean model response by removing thinking sections and other special tokens
   * This helps with evaluating responses from models like deepseek-r1 that include thinking steps
   */
  cleanModelResponse(response: string): string {
    if (!response) return '';
    
    let cleanedResponse = response;
    
    // Remove thinking sections (used by deepseek-r1 and similar models)
    cleanedResponse = cleanedResponse.replace(/<thinking>[\s\S]*?<\/thinking>/g, '');
    
    // Remove internal dialogue indicators 
    cleanedResponse = cleanedResponse.replace(/\[internal dialogue\][\s\S]*?\[\/internal dialogue\]/gi, '');
    cleanedResponse = cleanedResponse.replace(/\[thinking\][\s\S]*?\[\/thinking\]/gi, '');
    
    // Remove <answer> tags sometimes used by these models
    cleanedResponse = cleanedResponse.replace(/<answer>/gi, '');
    cleanedResponse = cleanedResponse.replace(/<\/answer>/gi, '');
    
    // Remove any other common special tokens that might appear
    cleanedResponse = cleanedResponse.replace(/<\|[\w\s]+\|>/g, ''); // e.g. <|thinking|>
    
    // Trim excess whitespace that might be left after removing sections
    cleanedResponse = cleanedResponse.trim();
    
    return cleanedResponse;
  },

  /**
   * Update model performance profiles from benchmark results
   * This allows the decision engine to learn from new benchmark data
   */
  async updateModelPerformanceProfiles(): Promise<void> {
    try {
      // Find the most recent comprehensive benchmark results
      const benchmarkDir = path.join(process.cwd(), 'benchmark-results');
      
      try {
        const files = await fs.readdir(benchmarkDir);
        
        // Find the most recent comprehensive results file
        const comprehensiveFiles = files.filter(file => file.startsWith('comprehensive-results-'));
        if (comprehensiveFiles.length === 0) {
          logger.info('No comprehensive benchmark results file found. Generating one from existing results...');
          
          // Load existing benchmark results and generate a comprehensive results file
          const results = await benchmarkUtils.loadResults(benchmarkDir);
          if (results.length > 0) {
            const comprehensiveResults: ComprehensiveBenchmarkResults = {
              timestamp: new Date().toISOString(),
              models: {},
              summary: {
                totalModels: 0,
                averageSuccessRate: 0,
                averageQualityScore: 0
              }
            };
            
            // Group results by model
            const modelResults = new Map<string, BenchmarkResult[]>();
            for (const result of results) {
              if (result.local) {
                const modelId = result.local.model;
                if (!modelResults.has(modelId)) {
                  modelResults.set(modelId, []);
                }
                modelResults.get(modelId)!.push(result);
              }
            }
            
            // Calculate aggregate metrics for each model
            let totalSuccessRate = 0;
            let totalQualityScore = 0;
            let modelCount = 0;
            
            for (const [modelId, modelResultList] of modelResults.entries()) {
              let successRateSum = 0;
              let qualityScoreSum = 0;
              let responseTimeSum = 0;
              let complexityScoreSum = 0;
              
              for (const result of modelResultList) {
                successRateSum += result.local.successRate;
                qualityScoreSum += result.local.qualityScore;
                responseTimeSum += result.local.timeTaken;
                complexityScoreSum += result.complexity;
              }
              
              // Calculate averages
              const avgSuccessRate = successRateSum / modelResultList.length;
              const avgQualityScore = qualityScoreSum / modelResultList.length;
              const avgResponseTime = responseTimeSum / modelResultList.length;
              const avgComplexityScore = complexityScoreSum / modelResultList.length;
              
              // Add to comprehensive results
              comprehensiveResults.models[modelId] = {
                successRate: avgSuccessRate,
                qualityScore: avgQualityScore,
                avgResponseTime: avgResponseTime,
                benchmarkCount: modelResultList.length,
                complexityScore: avgComplexityScore
              };
              
              // Add to totals for summary
              totalSuccessRate += avgSuccessRate;
              totalQualityScore += avgQualityScore;
              modelCount++;
            }
            
            // Set summary data
            if (modelCount > 0) {
              comprehensiveResults.summary!.totalModels = modelCount;
              comprehensiveResults.summary!.averageSuccessRate = totalSuccessRate / modelCount;
              comprehensiveResults.summary!.averageQualityScore = totalQualityScore / modelCount;
            }
            
            // Save comprehensive results
            const timestamp = new Date().toISOString().replace(/:/g, '-');
            const comprehensiveResultsPath = path.join(benchmarkDir, `comprehensive-results-${timestamp}.json`);
            await fs.writeFile(comprehensiveResultsPath, JSON.stringify(comprehensiveResults, null, 2));
            
            logger.info(`Generated comprehensive benchmark results from ${results.length} individual results`);
            return;
          } else {
            logger.warn('No benchmark results found to generate comprehensive summary');
            return;
          }
        }
        
        // Sort by timestamp (newest first)
        comprehensiveFiles.sort().reverse();
        const latestFile = comprehensiveFiles[0];
        
        // Read and parse the benchmark results
        const filePath = path.join(benchmarkDir, latestFile);
        const data = await fs.readFile(filePath, 'utf8');
        const benchmarkResults = JSON.parse(data) as ComprehensiveBenchmarkResults;
        
        // Now use the benchmark results to update model profiles in database
        if (benchmarkResults && benchmarkResults.models) {
          const modelsDb = modelsDbService.getDatabase();
          let updatedCount = 0;
          
          for (const [modelId, modelStats] of Object.entries(benchmarkResults.models)) {
            // Only update if the model exists in database
            if (modelsDb.models[modelId]) {
              // Update the model with benchmark data
              modelsDb.models[modelId] = {
                ...modelsDb.models[modelId],
                successRate: modelStats.successRate,
                qualityScore: modelStats.qualityScore,
                avgResponseTime: modelStats.avgResponseTime,
                complexityScore: modelStats.complexityScore,
                // Only update benchmark count if it's higher
                benchmarkCount: Math.max(
                  (modelsDb.models[modelId] as ModelPerformanceData).benchmarkCount || 0, 
                  modelStats.benchmarkCount
                )
              };
              
              // Save the updated model data
              await modelsDbService.updateModelData(modelId, modelsDb.models[modelId]);
              updatedCount++;
            }
          }
          
          logger.info(`Updated performance profiles for ${updatedCount} models from benchmark results`);
        } else {
          logger.warn('No model data found in comprehensive benchmark results');
        }
      } catch (error) {
        logger.warn('Could not read benchmark directory:', error);
      }
    } catch (error) {
      logger.error('Error updating model performance profiles:', error);
    }
  },

  /**
   * Generate comprehensive summary from all benchmark results
   */
  async generateComprehensiveSummary(): Promise<void> {
    try {
      const benchmarkDir = path.join(process.cwd(), 'benchmark-results');
      
      // Load all benchmark results
      const results = await benchmarkUtils.loadResults(benchmarkDir);
      if (results.length === 0) {
        logger.warn('No benchmark results found to summarize');
        return;
      }

      logger.info(`Found ${results.length} benchmark results for summarization`);

      // Generate summary using the benchmark module's functionality
      const summary = benchmarkUtils.generateSummary(results);

      // Save the summary
      await benchmarkUtils.saveSummary(summary, benchmarkDir);
      
      // Also create a comprehensive results file for easier model-centric access
      const comprehensiveResults: ComprehensiveBenchmarkResults = {
        timestamp: new Date().toISOString(),
        models: {},
        summary: {
          totalModels: 0,
          averageSuccessRate: 0,
          averageQualityScore: 0
        }
      };
      
      // Group results by model
      const modelResults = new Map<string, BenchmarkResult[]>();
      for (const result of results) {
        if (result.local) {
          const modelId = result.local.model;
          if (!modelResults.has(modelId)) {
            modelResults.set(modelId, []);
          }
          modelResults.get(modelId)!.push(result);
        }
      }
      
      // Calculate aggregate metrics for each model
      let totalSuccessRate = 0;
      let totalQualityScore = 0;
      let modelCount = 0;
      
      for (const [modelId, modelResultList] of modelResults.entries()) {
        let successRateSum = 0;
        let qualityScoreSum = 0;
        let responseTimeSum = 0;
        let complexityScoreSum = 0;
        
        for (const result of modelResultList) {
          successRateSum += result.local.successRate;
          qualityScoreSum += result.local.qualityScore;
          responseTimeSum += result.local.timeTaken;
          complexityScoreSum += result.complexity;
        }
        
        // Calculate averages
        const avgSuccessRate = successRateSum / modelResultList.length;
        const avgQualityScore = qualityScoreSum / modelResultList.length;
        const avgResponseTime = responseTimeSum / modelResultList.length;
        const avgComplexityScore = complexityScoreSum / modelResultList.length;
        
        // Add to comprehensive results
        comprehensiveResults.models[modelId] = {
          successRate: avgSuccessRate,
          qualityScore: avgQualityScore,
          avgResponseTime: avgResponseTime,
          benchmarkCount: modelResultList.length,
          complexityScore: avgComplexityScore
        };
        
        logger.debug(`Model ${modelId}: ${modelResultList.length} results, quality=${avgQualityScore.toFixed(2)}, success=${avgSuccessRate.toFixed(2)}`);
        
        // Add to totals for summary
        totalSuccessRate += avgSuccessRate;
        totalQualityScore += avgQualityScore;
        modelCount++;
      }
      
      // Set summary data
      if (modelCount > 0) {
        comprehensiveResults.summary!.totalModels = modelCount;
        comprehensiveResults.summary!.averageSuccessRate = totalSuccessRate / modelCount;
        comprehensiveResults.summary!.averageQualityScore = totalQualityScore / modelCount;
      }
      
      // Save comprehensive results
      const timestamp = new Date().toISOString().replace(/:/g, '-');
      const comprehensiveResultsPath = path.join(benchmarkDir, `comprehensive-results-${timestamp}.json`);
      await fs.writeFile(comprehensiveResultsPath, JSON.stringify(comprehensiveResults, null, 2));
      
      logger.info(`Generated and saved comprehensive benchmark summary for ${modelCount} models`);
    } catch (error) {
      logger.error('Error generating comprehensive summary:', error);
    }
  }
};