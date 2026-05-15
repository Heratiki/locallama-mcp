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

// Import SQLite storage
import { 
  initBenchmarkDb, 
  saveBenchmarkResult, 
  getRecentModelResults, 
  cleanupOldResults 
} from './storage/benchmarkDb.js';

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
  
  // Initialize SQLite database
  await initBenchmarkDb();
  
  // Run tasks sequentially or in parallel
  const results = await Promise.all(
    tasks.map(task => benchmarkTask(task, config))
  );
  
  // Generate summary
  const summary = generateSummary(results);
  
  // Cleanup old results (keep last 30 days by default)
  await cleanupOldResults();
  
  return summary;
}

/**
 * Benchmark Module
 * 
 * A modular benchmarking system for comparing local LLMs with paid APIs.
 * Features:
 * - API integration with LM Studio, Ollama, and OpenRouter
 * - Quality evaluation metrics
 * - SQLite-based result storage and analysis
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
  storage: {
    init: initBenchmarkDb,
    save: saveBenchmarkResult,
    getRecentResults: getRecentModelResults,
    cleanup: cleanupOldResults
  }
};