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
import { CapabilityDetector } from '../core/capability-detector';
import { ModelRegistry } from '../core/model-registry';

const modelRegistry = new ModelRegistry();
const capabilityDetector = new CapabilityDetector(modelRegistry);

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
 * Benchmark Model
 */
async function benchmarkModel(modelId) {
  const capabilities = capabilityDetector.detectCapabilities(modelId);
  console.log(`Benchmarking model: ${modelId}`);
  console.log(`Capabilities:`, capabilities);

  // Add benchmarking logic based on capabilities
  if (capabilities.code) {
    console.log(`Running code benchmarks for ${modelId}...`);
    // Code benchmarking logic here
  }

  if (capabilities.chat) {
    console.log(`Running chat benchmarks for ${modelId}...`);
    // Chat benchmarking logic here
  }

  // Additional benchmarks as needed
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
  },
  benchmarkModel
};