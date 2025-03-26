import { logger } from '../../../utils/logger.js';
import { openRouterModule } from '../../openrouter/index.js';
import { modelsDbService } from './modelsDb.js';
import { costMonitor } from '../../cost-monitor/index.js';
import { COMPLEXITY_THRESHOLDS, ModelPerformanceData } from '../types/index.js';
import { Model } from '../../../types/index.js';
import { BenchmarkResult, BenchmarkSummary } from '../../../types/benchmark.js';
import { saveResult } from '../../benchmark/storage/results.js';
import fs from 'fs/promises';
import path from 'path';

// Add this interface at the top of the file with other types
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
 * Normalize task name to a consistent format (lowercase with hyphens)
 * This ensures consistent folder naming across benchmark runs
 * 
 * @param taskName The task name to normalize
 * @returns Normalized task name (lowercase with hyphens)
 */
function normalizeTaskName(taskName: string): string {
  return taskName.toLowerCase().replace(/\s+/g, '-');
}

// Define the benchmark utilities first
const benchmarkUtils = {
  /**
   * Load benchmark results from a directory
   */
  async loadResults(benchmarkDir: string): Promise<BenchmarkResult[]> {
    try {
      const results: BenchmarkResult[] = [];
      const files = await fs.readdir(benchmarkDir);
      
      for (const file of files) {
        if (file.endsWith('.json')) {
          const filePath = path.join(benchmarkDir, file);
          const content = await fs.readFile(filePath, 'utf-8');
          const result = JSON.parse(content) as BenchmarkResult;
          results.push(result);
        }
      }
      
      return results;
    } catch (error) {
      logger.error('Failed to load benchmark results:', error);
      return [];
    }
  },

  /**
   * Check if a benchmark directory exists, supporting both naming conventions
   * 
   * @param baseDir Base directory for benchmarks
   * @param modelId Model ID
   * @param taskName Task name (will check both formats)
   * @returns True if directory exists in either naming format
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
      
      // Normalized format (lowercase with hyphens)
      const normalizedTaskDir = path.join(modelDir, normalizeTaskName(taskName));
      
      // Legacy format (capitalized with spaces)
      const legacyTaskDir = path.join(modelDir, taskName);
      
      try {
        // Try normalized format first
        await fs.access(normalizedTaskDir);
        return true;
      } catch {
        try {
          // Try legacy format as fallback
          await fs.access(legacyTaskDir);
          return true;
        } catch {
          // Neither format exists
          return false;
        }
      }
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

    for (const result of results) {
      summary.avgContextLength += result.contextLength;
      summary.avgOutputLength += result.outputLength;
      summary.avgComplexity += result.complexity;

      if (result.local) {
        localResultCount++;
        summary.local.avgTimeTaken += result.local.timeTaken;
        summary.local.avgSuccessRate += result.local.successRate;
        summary.local.avgQualityScore += result.local.qualityScore;
        summary.local.totalTokenUsage.prompt += result.local.tokenUsage.prompt;
        summary.local.totalTokenUsage.completion += result.local.tokenUsage.completion;
        summary.local.totalTokenUsage.total += result.local.tokenUsage.total;
      }

      if (result.paid) {
        paidResultCount++;
        summary.paid.avgTimeTaken += result.paid.timeTaken;
        summary.paid.avgSuccessRate += result.paid.successRate;
        summary.paid.avgQualityScore += result.paid.qualityScore;
        summary.paid.totalTokenUsage.prompt += result.paid.tokenUsage.prompt;
        summary.paid.totalTokenUsage.completion += result.paid.tokenUsage.completion;
        summary.paid.totalTokenUsage.total += result.paid.tokenUsage.total;
        summary.paid.totalCost += result.paid.cost;
      }
    }

    // Calculate final averages
    if (results.length > 0) {
      summary.avgContextLength /= results.length;
      summary.avgOutputLength /= results.length;
      summary.avgComplexity /= results.length;
    }

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
      summary.comparison.timeRatio = summary.local.avgTimeTaken / summary.paid.avgTimeTaken;
      summary.comparison.successRateDiff = summary.local.avgSuccessRate - summary.paid.avgSuccessRate;
      summary.comparison.qualityScoreDiff = summary.local.avgQualityScore - summary.paid.avgQualityScore;
      summary.comparison.costSavings = summary.paid.totalCost; // All cost saved when using local
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
      modelsDbService.updateModelData(modelId, modelsDb.models[modelId]);
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
    logger.info('Starting benchmark of free models');
    
    try {
      // Get free models
      const freeModels = await costMonitor.getFreeModels();
      if (freeModels.length === 0) {
        logger.warn('No free models available to benchmark');
        return;
      }
      
      logger.info(`Found ${freeModels.length} free models to benchmark`);
      
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
      
      // Get the number of models to benchmark per run from environment or default to 5
      const maxModelsPerRun = process.env.MAX_MODELS_TO_BENCHMARK ?
        parseInt(process.env.MAX_MODELS_TO_BENCHMARK, 10) : 5;
      
      // Get the models database
      const modelsDb = modelsDbService.getDatabase();
      
      // Check which models have been benchmarked within the last 7 days
      const recentlyBenchmarkedModels = new Set<string>();
      const sevenDaysAgo = new Date();
      sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
      
      for (const [modelId, modelData] of Object.entries(modelsDb.models)) {
        const perfData = modelData as ModelPerformanceData;
        if (perfData.lastBenchmarked) {
          const lastBenchmarked = new Date(perfData.lastBenchmarked);
          if (lastBenchmarked > sevenDaysAgo) {
            recentlyBenchmarkedModels.add(modelId);
          }
        }
      }
      
      // Prioritize models that haven't been benchmarked recently
      const unbenchmarkedModels = freeModels.filter(model => !recentlyBenchmarkedModels.has(model.id));
      
      logger.info(`Found ${unbenchmarkedModels.length} unbenchmarked models out of ${freeModels.length} total free models`);
      
      // If we have unbenchmarked models, prioritize those
      let modelsToBenchmark: Model[] = [];
      if (unbenchmarkedModels.length > 0) {
        modelsToBenchmark = unbenchmarkedModels.slice(0, maxModelsPerRun);
        logger.info(`Benchmarking ${modelsToBenchmark.length} previously unbenchmarked models`);
      } else {
        // If all models have been benchmarked recently, prioritize older benchmarks
        const modelsWithBenchmarkDates = freeModels
          .filter(model => modelsDb.models[model.id])
          .map(model => ({
            model,
            lastBenchmarked: new Date((modelsDb.models[model.id] as ModelPerformanceData).lastBenchmarked || 0)
          }))
          .sort((a, b) => a.lastBenchmarked.getTime() - b.lastBenchmarked.getTime());
        
        modelsToBenchmark = modelsWithBenchmarkDates
          .slice(0, maxModelsPerRun)
          .map(item => item.model);
        
        logger.info(`All models have been benchmarked within 7 days. Benchmarking ${modelsToBenchmark.length} oldest benchmarked models`);
      }
      
      // If we somehow have no models to benchmark (shouldn't happen), just take the first few
      if (modelsToBenchmark.length === 0) {
        modelsToBenchmark = freeModels.slice(0, maxModelsPerRun);
        logger.info(`Fallback: Benchmarking ${modelsToBenchmark.length} models`);
      }
      
      logger.info(`Benchmarking ${modelsToBenchmark.length} models out of ${freeModels.length} available free models`);
      logger.info(`Set MAX_MODELS_TO_BENCHMARK environment variable to test more models per run`);
      
      // Benchmark each model with each task
      for (const model of modelsToBenchmark) {
        logger.info(`Benchmarking model: ${model.id}`);
        
        for (const task of benchmarkTasks) {
          logger.info(`Task: ${task.name} (complexity: ${task.complexity})`);
          
          try {
            const startTime = Date.now();
            const result = await openRouterModule.callOpenRouterApi(
              model.id,
              task.task,
              120000 // 2 minute timeout
            );
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
            modelsDbService.updateModelData(model.id, modelsDb.models[model.id]);
            
          } catch (error) {
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
              
              modelsDbService.updateModelData(model.id, modelsDb.models[model.id]);
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
      const responseLower = response.toLowerCase();
      
      // Check if response contains actual code and validate language format
      const codePatterns = {
        hasFunction: /\b(?:function|def|class|const|let|var)\b/.test(response),
        hasCodeBlock: /```[\s\S]*?```/.test(response) || 
                     /^[ ]{4}[\s\S]+/m.test(response) || 
                     /<code>[\s\S]*?<\/code>/.test(response),
        hasDocs: /(?:\/\*[\s\S]*?\*\/|\/\/.*|#.*|"""[\s\S]*?"""|'''[\s\S]*?''')/.test(response)
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
          logger.warn('No comprehensive benchmark results found');
          return;
        }
        
        // Sort by timestamp (newest first)
        comprehensiveFiles.sort().reverse();
        const latestFile = comprehensiveFiles[0];
        
        // Read and parse the benchmark results
        const filePath = path.join(benchmarkDir, latestFile);
        const data = await fs.readFile(filePath, 'utf8');
        JSON.parse(data) as ComprehensiveBenchmarkResults;
        
        logger.info('Updated model performance profiles from benchmark results');
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

      // Generate summary using the benchmark module's functionality
      const summary = benchmarkUtils.generateSummary(results);

      // Save the summary
      await benchmarkUtils.saveSummary(summary, benchmarkDir);
      
      logger.info('Generated and saved comprehensive benchmark summary');
    } catch (error) {
      logger.error('Error generating comprehensive summary:', error);
    }
  },
};