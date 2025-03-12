import dotenv from 'dotenv';
import path from 'path';

// Load environment variables from .env file
dotenv.config();

// Determine root directory in a way that works with both runtime and tests
const rootDir = process.cwd();

/**
 * Type definitions for the configuration
 */
interface BenchmarkConfig {
  runsPerTask: number;
  parallel: boolean;
  maxParallelTasks: number;
  taskTimeout: number;
  saveResults: boolean;
  resultsPath: string;
}

interface ServerConfig {
  port: number;
  host: string;
  apiPrefix: string;
}

interface ModelConfig {
  temperature: number;
  maxTokens: number;
  topP: number;
  frequencyPenalty: number;
  presencePenalty: number;
}

interface PythonConfig {
  path?: string;
  virtualEnv?: string;
  detectVirtualEnv?: boolean;
}

export interface Config {
  // Server configuration
  server: ServerConfig;
  
  // Local LLM endpoints
  lmStudioEndpoint: string;
  ollamaEndpoint: string;
  localLlamaEndpoint: string; // Added local Llama endpoint
  
  // Model configuration
  defaultLocalModel: string;
  defaultModelConfig: ModelConfig;
  
  // Decision thresholds
  tokenThreshold: number;
  costThreshold: number;
  qualityThreshold: number;
  
  // API Keys
  openRouterApiKey?: string;
  
  // Benchmark configuration
  benchmark: BenchmarkConfig;
  
  // Logging
  logLevel: 'error' | 'warn' | 'info' | 'debug' | 'trace';
  logFile?: string;
  
  // Cache settings
  cacheEnabled: boolean;
  cacheDir: string;
  maxCacheSize: number;
  
  // Code Search Configuration
  directoriesToIndex?: string[]; // Directories to index for code search
  codeSearchExcludePatterns?: string[]; // Patterns to exclude from indexing
  
  // Paths
  rootDir: string;
  
  // Python configuration
  python?: PythonConfig;
}

/**
 * Helper function to parse boolean environment variables
 */
function parseBool(value: string | undefined, defaultValue: boolean): boolean {
  if (value === undefined) return defaultValue;
  return value.toLowerCase() === 'true';
}

/**
 * Helper function to parse number with validation
 */
function parseNumber(value: string | undefined, defaultValue: number, min?: number, max?: number): number {
  if (value === undefined) return defaultValue;
  const num = parseFloat(value);
  if (isNaN(num)) return defaultValue;
  if (min !== undefined && num < min) return min;
  if (max !== undefined && num > max) return max;
  return num;
}

/**
 * Configuration for the LocalLama MCP Server
 */
export const config: Config = {
  // Server configuration
  server: {
    port: parseInt(process.env.PORT || '3000', 10),
    host: process.env.HOST || '0.0.0.0',
    apiPrefix: process.env.API_PREFIX || '/api',
  },

  // Local LLM endpoints
  lmStudioEndpoint: process.env.LM_STUDIO_ENDPOINT || 'http://localhost:1234/v1',
  ollamaEndpoint: process.env.OLLAMA_ENDPOINT || 'http://localhost:11434/api',
  localLlamaEndpoint: process.env.LOCAL_LLAMA_ENDPOINT || 'http://localhost:12345/api', // Added local Llama endpoint
  
  // Model configuration
  defaultLocalModel: process.env.DEFAULT_LOCAL_MODEL || 'llama2',
  defaultModelConfig: {
    temperature: parseNumber(process.env.MODEL_TEMPERATURE, 0.7, 0, 2),
    maxTokens: parseInt(process.env.MODEL_MAX_TOKENS || '2048', 10),
    topP: parseNumber(process.env.MODEL_TOP_P, 0.95, 0, 1),
    frequencyPenalty: parseNumber(process.env.MODEL_FREQUENCY_PENALTY, 0, -2, 2),
    presencePenalty: parseNumber(process.env.MODEL_PRESENCE_PENALTY, 0, -2, 2),
  },
  
  // Decision thresholds
  tokenThreshold: parseInt(process.env.TOKEN_THRESHOLD || '1000', 10),
  costThreshold: parseFloat(process.env.COST_THRESHOLD || '0.02'),
  qualityThreshold: parseFloat(process.env.QUALITY_THRESHOLD || '0.7'),
  
  // API Keys
  openRouterApiKey: process.env.OPENROUTER_API_KEY,
  
  // Benchmark configuration
  benchmark: {
    runsPerTask: parseInt(process.env.BENCHMARK_RUNS_PER_TASK || '3', 10),
    parallel: parseBool(process.env.BENCHMARK_PARALLEL, false),
    maxParallelTasks: parseInt(process.env.BENCHMARK_MAX_PARALLEL_TASKS || '2', 10),
    taskTimeout: parseInt(process.env.BENCHMARK_TASK_TIMEOUT || '60000', 10),
    saveResults: parseBool(process.env.BENCHMARK_SAVE_RESULTS, true),
    resultsPath: process.env.BENCHMARK_RESULTS_PATH || path.join(rootDir, 'benchmark-results'),
  },
  
  // Logging configuration
  logLevel: (process.env.LOG_LEVEL || 'info') as Config['logLevel'],
  logFile: process.env.LOG_FILE,
  
  // Cache settings
  cacheEnabled: parseBool(process.env.CACHE_ENABLED, true),
  cacheDir: process.env.CACHE_DIR || path.join(rootDir, '.cache'),
  maxCacheSize: parseInt(process.env.MAX_CACHE_SIZE || '1073741824', 10), // 1GB default
  
  // Python configuration
  python: {
    path: process.env.PYTHON_PATH || process.env.RETRIV_PYTHON_PATH,
    virtualEnv: process.env.PYTHON_VENV_PATH,
    detectVirtualEnv: parseBool(process.env.PYTHON_DETECT_VENV, true),
  },
  
  // Paths
  rootDir,
};

/**
 * Validate that the configuration is valid
 * @throws {Error} If the configuration is invalid
 */
export function validateConfig(): void {
  const errors: string[] = [];

  // Validate server config
  if (config.server.port < 0 || config.server.port > 65535) {
    errors.push(`Invalid port number: ${config.server.port}`);
  }

  // Validate URLs
  try {
    new URL(config.lmStudioEndpoint);
    new URL(config.ollamaEndpoint);
    new URL(config.localLlamaEndpoint); // Added local Llama endpoint validation
  } catch (error) {
    errors.push(`Invalid endpoint URL in configuration: ${error}`);
  }

  // Validate thresholds
  if (config.tokenThreshold <= 0) {
    errors.push(`Invalid token threshold: ${config.tokenThreshold}`);
  }

  if (config.costThreshold <= 0) {
    errors.push(`Invalid cost threshold: ${config.costThreshold}`);
  }

  if (config.qualityThreshold <= 0 || config.qualityThreshold > 1) {
    errors.push(`Invalid quality threshold: ${config.qualityThreshold}`);
  }

  // Validate model config
  const { temperature, topP, maxTokens } = config.defaultModelConfig;
  if (temperature < 0 || temperature > 2) {
    errors.push(`Invalid temperature: ${temperature}`);
  }
  if (topP < 0 || topP > 1) {
    errors.push(`Invalid topP: ${topP}`);
  }
  if (maxTokens <= 0) {
    errors.push(`Invalid maxTokens: ${maxTokens}`);
  }

  // Validate benchmark config
  if (config.benchmark.runsPerTask <= 0) {
    errors.push(`Invalid runsPerTask: ${config.benchmark.runsPerTask}`);
  }
  if (config.benchmark.maxParallelTasks <= 0) {
    errors.push(`Invalid maxParallelTasks: ${config.benchmark.maxParallelTasks}`);
  }
  if (config.benchmark.taskTimeout <= 0) {
    errors.push(`Invalid taskTimeout: ${config.benchmark.taskTimeout}`);
  }

  // Validate cache config
  if (config.maxCacheSize <= 0) {
    errors.push(`Invalid maxCacheSize: ${config.maxCacheSize}`);
  }

  // Validate Python path if provided
  if (config.python?.path && typeof config.python.path === 'string') {
    try {
      // No need for extensive validation - the path will be checked when used
    } catch (error) {
      errors.push(`Invalid Python path: ${config.python.path}`);
    }
  }

  if (errors.length > 0) {
    throw new Error(`Configuration validation failed:\n${errors.join('\n')}`);
  }
}