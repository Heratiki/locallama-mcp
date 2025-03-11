import { config } from '../../config/index.js';
import { BenchmarkConfig, BenchmarkTaskParams } from '../../types/index.js';

// Import core functionality
import { benchmarkTask } from './core/runner.js';
import { generateSummary } from './core/summary.js';

// Import API integrations
import { callLmStudioApi } from './api/lm-studio.js';
import { callOllamaApi } from './api/ollama.js';
import { simulateOpenAiApi, simulateGenericApi } from './api/simulation.js';

// Import evaluation tools
import { evaluateQuality } from './evaluation/quality.js';

// Import storage utilities
import { saveResult, saveSummary, loadResults, loadSummaries } from './storage/results.js';
import { logger } from '../../utils/logger.js';

/**
 * Default benchmark configuration
 */
const defaultConfig: BenchmarkConfig = {
  ...config.benchmark,
};

/**
 * Run a benchmark for multiple tasks
 */
async function benchmarkTasks(
  tasks: BenchmarkTaskParams[],
  config: BenchmarkConfig = defaultConfig
) {
  logger.info(`Benchmarking ${tasks.length} tasks`);
  
  // Run tasks sequentially or in parallel
  const results = await Promise.all(
    tasks.map(task => benchmarkTask(task, config))
  );
  
  // Generate and save summary
  const summary = generateSummary(results);
  if (config.saveResults) {
    await saveSummary(summary, config.resultsPath);
  }
  
  return summary;
}

/**
 * Benchmark Module
 * 
 * A modular benchmarking system for comparing local LLMs with paid APIs.
 * Features:
 * - API integration with LM Studio, Ollama, and OpenRouter
 * - Quality evaluation metrics
 * - Result storage and analysis
 * - Configurable benchmarking parameters
 */
export const benchmarkModule = {
  // Core functionality
  defaultConfig,
  benchmarkTask,
  benchmarkTasks,
  generateSummary,
  
  // API integrations
  api: {
    lmStudio: callLmStudioApi,
    ollama: callOllamaApi,
    simulation: {
      openai: simulateOpenAiApi,
      generic: simulateGenericApi
    }
  },
  
  // Evaluation tools
  evaluation: {
    quality: evaluateQuality
  },
  
  // Storage utilities
  saveResult,
  saveSummary,
  loadResults,
  loadSummaries
};