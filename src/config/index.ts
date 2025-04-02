import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';
import { execSync } from 'child_process';

// Load environment variables from .env file
dotenv.config();
// Determine root directory in a way that works with both runtime and tests
const rootDir = process.cwd();

/**
 * Helper function to detect python executable with retriv installed
 */
function detectPythonWithRetriv(): string | undefined {
  // Explicitly defined path has highest priority
  if (process.env.RETRIV_PYTHON_PATH) {
    const pythonPath = process.env.RETRIV_PYTHON_PATH.trim();
    try {
      execSync(`${pythonPath} -c "import retriv"`, { stdio: 'pipe' });
      return pythonPath;
    } catch {
      // Python path set but retriv module not found
    }
  }

  if (process.env.PYTHON_PATH) {
    const pythonPath = process.env.PYTHON_PATH.trim();
    try {
      execSync(`${pythonPath} -c "import retriv"`, { stdio: 'pipe' });
      return pythonPath;
    } catch {
      // Python path set but retriv module not found
    }
  }

  // Determine if we're running from dist directory
  const currentDir = process.cwd();
  const isRunningFromDist = currentDir.endsWith('/dist') || currentDir.endsWith('\\dist');
  const projectRoot = isRunningFromDist ? path.resolve(currentDir, '..') : currentDir;

  // Look for virtual environments
  const possibleVenvPaths = [
    // Absolute paths relative to project root
    path.resolve(projectRoot, '.venv/bin/python'),
    path.resolve(projectRoot, 'venv/bin/python'),
    path.resolve(projectRoot, 'env/bin/python'),
    // For Windows
    path.resolve(projectRoot, '.venv/Scripts/python.exe'),
    path.resolve(projectRoot, 'venv/Scripts/python.exe'),
    path.resolve(projectRoot, 'env/Scripts/python.exe'),
    // Current directory paths
    path.resolve(currentDir, '.venv/bin/python'),
    path.resolve(currentDir, 'venv/bin/python'),
    path.resolve(currentDir, 'env/bin/python'),
    // For Windows in current directory
    path.resolve(currentDir, '.venv/Scripts/python.exe'),
    path.resolve(currentDir, 'venv/Scripts/python.exe'),
    path.resolve(currentDir, 'env/Scripts/python.exe'),
    // Check parent directories too (in case running from dist)
    path.resolve(currentDir, '../.venv/bin/python'),
    path.resolve(currentDir, '../venv/bin/python'),
    path.resolve(currentDir, '../env/bin/python'),
    // For Windows in parent directory
    path.resolve(currentDir, '../.venv/Scripts/python.exe'),
    path.resolve(currentDir, '../venv/Scripts/python.exe'),
    path.resolve(currentDir, '../env/Scripts/python.exe'),
  ];

  for (const venvPath of possibleVenvPaths) {
    if (fs.existsSync(venvPath)) {
      try {
        execSync(`${venvPath} -c "import retriv"`, { stdio: 'pipe' });
        return venvPath;
      } catch {
        // Continue to next path, no need to log every failure
      }
    }
  }

  // Try common Python commands as last resort
  for (const cmd of ['python3', 'python', 'py']) {
    try {
      execSync(`${cmd} -c "import retriv"`, { stdio: 'pipe' });
      return cmd;
    } catch {
      // Continue to next command, no need to log every failure
    }
  }

  return undefined;
}

// Find best Python executable before config initialization
const detectedPythonPath = detectPythonWithRetriv();

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

  // Startup benchmark targets
  startupBenchmarkTargets: string[];
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
    path: process.env.PYTHON_PATH || process.env.RETRIV_PYTHON_PATH || detectedPythonPath || path.join(process.cwd(), '.venv/bin/python'),
    virtualEnv: process.env.PYTHON_VENV_PATH || path.join(process.cwd(), '.venv'),
    detectVirtualEnv: parseBool(process.env.PYTHON_DETECT_VENV, true),
  },

  // Startup benchmark targets
  startupBenchmarkTargets: (() => {
    const envVar = process.env.STARTUP_BENCHMARK_TARGETS;
    const defaultTargets = process.env.OPENROUTER_API_KEY ? ['free'] : ['local'];
    if (!envVar) {
      return defaultTargets;
    }
    const targets = envVar.toLowerCase().split(',').map(t => t.trim()).filter(t => t);
    if (targets.includes('none')) {
      return [];
    }
    if (targets.includes('all')) {
      return ['local', 'free', 'paid'];
    }
    // Remove duplicates
    return [...new Set(targets)];
  })(),
  
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
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    errors.push(`Invalid endpoint URL in configuration: ${errorMessage}`);
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
  // Validate startup benchmark targets
  const validTargets = ['local', 'free', 'paid'];
  if (!Array.isArray(config.startupBenchmarkTargets)) {
    errors.push('Invalid startupBenchmarkTargets: Must be an array.');
  } else {
    for (const target of config.startupBenchmarkTargets) {
      if (!validTargets.includes(target)) {
        errors.push(`Invalid startupBenchmarkTarget: ${target}. Must be one of ${validTargets.join(', ')}.`);
      }
    }
  }
  // Validate Python path if provided
  if (config.python?.path && typeof config.python.path === 'string') {
    try {
      const pythonPath = path.resolve(config.python.path);
      if (!fs.existsSync(pythonPath)) {
        errors.push(`Python executable not found at configured path: ${pythonPath}`);
      } else {
        try {
          // Verify Python can import retriv
          execSync(`${pythonPath} -c "import retriv"`, { stdio: 'pipe' });
        } catch (error: unknown) {
          const errorMessage = error instanceof Error ? error.message : String(error);
          errors.push(`Python at ${pythonPath} cannot import retriv: ${errorMessage}`);
        }
      }
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      errors.push(`Invalid Python path configuration: ${errorMessage}`);
    }
  }

  if (errors.length > 0) {
    throw new Error(`Configuration validation failed:\n${errors.join('\n')}`);
  }
}