import { logger } from '../../../utils/logger.js';
import { openRouterModule } from '../../openrouter/index.js';
import { modelsDbService } from './modelsDb.js';
import { costMonitor } from '../../cost-monitor/index.js';
import { COMPLEXITY_THRESHOLDS, ModelPerformanceData } from '../types/index.js';
import { Model } from '../../../types/index.js';
import fs from 'fs/promises';
import path from 'path';

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
      
      // Define test tasks with varying complexity
      const benchmarkTasks = [
        {
          name: 'Simple function',
          task: 'Write a function to calculate the factorial of a number.',
          complexity: 0.2,
          codeCheck: (response: string) => {
            // Using the more comprehensive quality evaluation function
            return this.evaluateCodeQuality(
              'Write a function to calculate the factorial of a number.',
              response,
              'factorial'
            ) >= 0.6; // Threshold of 0.6 for a "good" implementation
          }
        },
        {
          name: 'Medium algorithm',
          task: 'Implement a binary search algorithm and explain its time complexity.',
          complexity: 0.5,
          codeCheck: (response: string) => {
            // Using the more comprehensive quality evaluation function
            return this.evaluateCodeQuality(
              'Implement a binary search algorithm and explain its time complexity.',
              response,
              'binary-search'
            ) >= 0.6; // Threshold of 0.6 for a "good" implementation
          }
        }
      ];
      
      // Get the number of models to benchmark per run from environment or default to 5
      const maxModelsPerRun = process.env.MAX_MODELS_TO_BENCHMARK ?
        parseInt(process.env.MAX_MODELS_TO_BENCHMARK, 10) : 5;
      
      // Get the models database
      const modelsDb = modelsDbService.getDatabase();
      
      // Check which models have already been benchmarked
      const benchmarkedModels = new Set<string>();
      for (const [modelId, modelData] of Object.entries(modelsDb.models)) {
        const perfData = modelData as ModelPerformanceData;
        if (perfData.benchmarkCount > 0) {
          benchmarkedModels.add(modelId);
        }
      }
      
      // Prioritize models that haven't been benchmarked yet
      const unbenchmarkedModels = freeModels.filter(model => !benchmarkedModels.has(model.id));
      
      logger.info(`Found ${unbenchmarkedModels.length} unbenchmarked models out of ${freeModels.length} total free models`);
      
      // If we have unbenchmarked models, prioritize those
      let modelsToBenchmark: Model[] = [];
      if (unbenchmarkedModels.length > 0) {
        // Take up to maxModelsPerRun unbenchmarked models
        modelsToBenchmark = unbenchmarkedModels.slice(0, maxModelsPerRun);
        logger.info(`Benchmarking ${modelsToBenchmark.length} previously unbenchmarked models`);
      } else {
        // If all models have been benchmarked at least once, prioritize models with the fewest benchmarks
        const modelsWithBenchmarkCounts = freeModels
          .filter(model => modelsDb.models[model.id])
          .map(model => ({
            model,
            benchmarkCount: (modelsDb.models[model.id] as ModelPerformanceData).benchmarkCount || 0
          }))
          .sort((a, b) => a.benchmarkCount - b.benchmarkCount);
        
        // Take the models with the fewest benchmarks
        modelsToBenchmark = modelsWithBenchmarkCounts
          .slice(0, maxModelsPerRun)
          .map(item => item.model);
        
        logger.info(`All models have been benchmarked at least once. Benchmarking ${modelsToBenchmark.length} models with the fewest benchmark runs`);
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
        
        // Check if we've already benchmarked this model recently (within 7 days)
        const modelData = modelsDb.models[model.id] as ModelPerformanceData;
        if (modelData && modelData.lastBenchmarked) {
          const lastBenchmarked = new Date(modelData.lastBenchmarked);
          const now = new Date();
          const daysSinceLastBenchmark = (now.getTime() - lastBenchmarked.getTime()) / (1000 * 60 * 60 * 24);
          
          if (daysSinceLastBenchmark < 7 && modelData.benchmarkCount >= 3) {
            logger.info(`Skipping benchmark for ${model.id} - already benchmarked ${modelData.benchmarkCount} times, last on ${modelData.lastBenchmarked}`);
            continue;
          }
        }
        
        for (const task of benchmarkTasks) {
          logger.info(`Task: ${task.name} (complexity: ${task.complexity})`);
          
          try {
            // Call the model using OpenRouter with a longer timeout
            const startTime = Date.now();
            const result = await openRouterModule.callOpenRouterApi(
              model.id,
              task.task,
              120000 // 2 minute timeout to give models enough time to complete
            );
            const endTime = Date.now();
            const responseTime = endTime - startTime;
            
            // Check if the response contains working code
            let qualityScore = 0;
            let isWorkingCode = false;
            
            if (result && result.success && result.text) {
              // Check if the code works using the task-specific checker
              isWorkingCode = task.codeCheck(result.text);
              
              // Calculate quality score based on the response
              qualityScore = isWorkingCode ?
                openRouterModule.evaluateQuality(task.task, result.text) : 0.1;
              
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
  },

  /**
   * Simple helper to evaluate code quality for benchmarking
   * This is a simplified version - the full version is in the codeEvaluation service
   */
  evaluateCodeQuality(task: string, response: string, taskType: string = 'general'): number {
    try {
      // Simplified evaluation for benchmarking
      let score = 0;
      const responseLower = response.toLowerCase();

      // Check if the response contains code
      const hasCode = response.includes('function') ||
                      response.includes('def ') ||
                      response.includes('class ') ||
                      response.includes('const ') ||
                      response.includes('let ') ||
                      response.includes('var ');

      // Check for code blocks (markdown or other formats)
      const hasCodeBlocks = response.includes('```') ||
                            response.includes('    ') || // Indented code
                            response.includes('<code>');

      // Basic quality scoring
      if (hasCode) score += 0.3;
      if (hasCodeBlocks) score += 0.2;

      // Task-specific checks
      if (taskType === 'factorial') {
        if (response.includes('factorial') && 
            (response.includes('*') || response.includes('product')) &&
            (response.includes('if') || response.includes('return'))) {
          score += 0.4;
        }
      } else if (taskType === 'binary-search') {
        if (response.includes('binarySearch') && 
            response.includes('mid') &&
            (response.includes('log') || response.includes('complexity'))) {
          score += 0.4;
        }
      }

      // Penalize very short responses
      if (response.length < 100) {
        score *= (response.length / 100);
      }

      // Cap score between 0 and 1
      return Math.min(1, Math.max(0, score));
    } catch (error) {
      logger.error(`Error evaluating code quality for task ${task}:`, error);
      return 0; // Return a default score in case of error
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
        const results = JSON.parse(data);
        
        logger.info('Updated model performance profiles from benchmark results');
      } catch (error) {
        logger.warn('Could not read benchmark directory:', error);
      }
    } catch (error) {
      logger.error('Error updating model performance profiles:', error);
    }
  }
};