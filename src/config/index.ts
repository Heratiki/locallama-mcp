import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

// Resolve project root from the compiled file location so the server works
// regardless of what cwd the MCP host process uses when spawning us.
// dist/config/index.js → dist/config/ → dist/ → project root (3 levels up).
// LOCALLAMA_ROOT_DIR overrides for tests or custom deployments.
const rootDir = process.env.LOCALLAMA_ROOT_DIR ||
  path.resolve(fileURLToPath(import.meta.url), '..', '..', '..');
// Load environment variables from a stable root path instead of caller cwd.
dotenv.config({ path: path.join(rootDir, '.env') });

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
export interface Config {
  // Server configuration
  server: ServerConfig;

  // Local LLM endpoints
  lmStudioEndpoint: string;
  ollamaEndpoint: string;
  ollamaTimeout: number;
  providerTimeoutMs: number;
  providerMaxConcurrentLocal: number;
  providerMaxConcurrentRemote: number;
  localLlamaEndpoint: string; // Added local Llama endpoint
  llamaCppEndpoint: string; // llama-server OpenAI-compatible endpoint
  llamaCppServerBin: string; // Explicit path to llama-server binary
  llamaCppCliBin: string; // Explicit path to llama-cli binary
  llamaCppModelPath?: string; // Explicit path to a model file for sibling discovery
  llamaCppHealthProbeEnabled: boolean;
  llamaCppHealthProbePrompt: string;
  llamaCppHealthProbeTimeoutMs: number;

  // Model configuration
  defaultLocalModel: string;
  defaultModelConfig: ModelConfig;

  // Decision thresholds
  tokenThreshold: number;
  costThreshold: number;
  qualityThreshold: number;
  codeScoreThreshold: number;

  // API Keys
  openRouterApiKey?: string;
  // When true, only free-tier OpenRouter models (cost === 0) are eligible — no paid calls
  openRouterFreeOnly: boolean;
  // Max OpenRouter API calls per minute across all free models (0 = no limit)
  openRouterRateLimitPerMinute: number;
  providerHealthProbeIntervalMs: number;

  // Benchmark configuration
  benchmark: BenchmarkConfig;

  // How old a benchmark result can be before it is considered stale (hours).
  // Route-time freshness checks use this value; 0 is invalid (clamped to 1).
  benchmarkFreshnessHours: number;

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

  // Startup benchmark targets — defaults to [] (disabled).
  // Set STARTUP_BENCHMARK_TARGETS=local,free to opt in to startup sweeps.
  startupBenchmarkTargets: string[];

  // Hardware profile — controls routing aggressiveness toward local models
  // 'lightweight': raises complexity/token thresholds so small local models are
  //   preferred and paid APIs are only used for genuinely complex work.
  // 'default': standard thresholds from benchmark results.
  profile: 'default' | 'lightweight';

}

export const HOT_RELOADABLE_CONFIG_FIELDS = [
  'defaultLocalModel',
  'defaultModelConfig.temperature',
  'defaultModelConfig.maxTokens',
  'defaultModelConfig.topP',
  'defaultModelConfig.frequencyPenalty',
  'defaultModelConfig.presencePenalty',
  'tokenThreshold',
  'costThreshold',
  'qualityThreshold',
  'codeScoreThreshold',
  'openRouterFreeOnly',
  'openRouterRateLimitPerMinute',
  'providerTimeoutMs',
  'providerMaxConcurrentLocal',
  'providerMaxConcurrentRemote',
  'ollamaTimeout',
  'providerHealthProbeIntervalMs',
  'benchmark.runsPerTask',
  'benchmark.parallel',
  'benchmark.maxParallelTasks',
  'benchmark.taskTimeout',
  'benchmark.saveResults',
  'startupBenchmarkTargets',
  'benchmarkFreshnessHours',
  'logLevel',
  'profile',
] as const;

export const RESTART_REQUIRED_CONFIG_FIELDS = [
  'server.port',
  'server.host',
  'server.apiPrefix',
  'lmStudioEndpoint',
  'ollamaEndpoint',
  'localLlamaEndpoint',
  'llamaCppEndpoint',
  'llamaCppServerBin',
  'llamaCppCliBin',
  'llamaCppModelPath',
  'openRouterApiKey',
  'benchmark.resultsPath',
  'cacheEnabled',
  'cacheDir',
  'maxCacheSize',
  'logFile',
  'rootDir',
] as const;

export interface ReloadConfigResult {
  success: true;
  message: string;
  envPath: string;
  appliedFields: readonly string[];
  restartRequiredFields: readonly string[];
  activeConfig: {
    defaultLocalModel: string;
    defaultModelConfig: ModelConfig;
    tokenThreshold: number;
    costThreshold: number;
    qualityThreshold: number;
    codeScoreThreshold: number;
    openRouterFreeOnly: boolean;
    openRouterRateLimitPerMinute: number;
    providerTimeoutMs: number;
    providerMaxConcurrentLocal: number;
    providerMaxConcurrentRemote: number;
    ollamaTimeout: number;
    providerHealthProbeIntervalMs: number;
    benchmark: Pick<BenchmarkConfig, 'runsPerTask' | 'parallel' | 'maxParallelTasks' | 'taskTimeout' | 'saveResults'>;
    startupBenchmarkTargets: string[];
    benchmarkFreshnessHours: number;
    logLevel: Config['logLevel'];
    profile: Config['profile'];
  };
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

function resolvePath(envPath: string | undefined, defaultPath: string): string {
    const p = envPath || defaultPath;
    if (path.isAbsolute(p)) {
        return p;
    }
    return path.join(rootDir, p);
}

function buildConfigFromEnv(env: NodeJS.ProcessEnv): Config {
  return {
    // Server configuration
    server: {
      port: parseInt(env.PORT || '3000', 10),
      host: env.HOST || '0.0.0.0',
      apiPrefix: env.API_PREFIX || '/api',
    },
    // Local LLM endpoints
    lmStudioEndpoint: env.LM_STUDIO_ENDPOINT || 'http://localhost:1234/v1',
    ollamaEndpoint: env.OLLAMA_ENDPOINT || 'http://localhost:11434/api',
    ollamaTimeout: parseInt(env.OLLAMA_TIMEOUT || '120', 10) * 1000,
    providerTimeoutMs: parseInt(env.PROVIDER_TIMEOUT_MS || '120000', 10),
    providerMaxConcurrentLocal: parseNumber(env.PROVIDER_MAX_CONCURRENT_LOCAL, 1, 1, 64),
    providerMaxConcurrentRemote: parseNumber(env.PROVIDER_MAX_CONCURRENT_REMOTE, 1, 1, 128),
    localLlamaEndpoint: env.LOCAL_LLAMA_ENDPOINT || 'http://localhost:12345/api',
    llamaCppEndpoint: env.LLAMA_CPP_ENDPOINT || '',
    llamaCppServerBin: env.LLAMA_CPP_SERVER_BIN || '',
    llamaCppCliBin: env.LLAMA_CPP_CLI_BIN || '',
    llamaCppModelPath: env.LLAMA_CPP_MODEL || undefined,
    llamaCppHealthProbeEnabled: parseBool(env.LLAMA_CPP_HEALTH_PROBE_ENABLED, true),
    llamaCppHealthProbePrompt: env.LLAMA_CPP_HEALTH_PROBE_PROMPT || `write 'ok'`,
    llamaCppHealthProbeTimeoutMs: parseNumber(env.LLAMA_CPP_HEALTH_PROBE_TIMEOUT_MS, 10000, 1000),

    // Model configuration
    defaultLocalModel: env.DEFAULT_LOCAL_MODEL || 'llama2',
    defaultModelConfig: {
      temperature: parseNumber(env.MODEL_TEMPERATURE, 0.7, 0, 2),
      maxTokens: parseInt(env.MODEL_MAX_TOKENS || '2048', 10),
      topP: parseNumber(env.MODEL_TOP_P, 0.95, 0, 1),
      frequencyPenalty: parseNumber(env.MODEL_FREQUENCY_PENALTY, 0, -2, 2),
      presencePenalty: parseNumber(env.MODEL_PRESENCE_PENALTY, 0, -2, 2),
    },

    // Decision thresholds
    tokenThreshold: parseInt(env.TOKEN_THRESHOLD || '1000', 10),
    costThreshold: parseFloat(env.COST_THRESHOLD || '0.02'),
    qualityThreshold: parseFloat(env.QUALITY_THRESHOLD || '0.7'),
    codeScoreThreshold: parseNumber(env.CODE_SCORE_THRESHOLD, 0.3),

    // API Keys
    openRouterApiKey: env.OPENROUTER_API_KEY,
    openRouterFreeOnly: parseBool(env.OPENROUTER_FREE_ONLY, true),
    openRouterRateLimitPerMinute: parseNumber(env.OPENROUTER_RATE_LIMIT_PER_MINUTE, 10, 0, 600),
    providerHealthProbeIntervalMs: parseNumber(env.PROVIDER_HEALTH_PROBE_INTERVAL_MS, 60_000, 1_000),

    // Benchmark configuration
    benchmark: {
      runsPerTask: parseInt(env.BENCHMARK_RUNS_PER_TASK || '3', 10),
      parallel: parseBool(env.BENCHMARK_PARALLEL, false),
      maxParallelTasks: parseInt(env.BENCHMARK_MAX_PARALLEL_TASKS || '2', 10),
      taskTimeout: parseInt(env.BENCHMARK_TASK_TIMEOUT || '60000', 10),
      saveResults: parseBool(env.BENCHMARK_SAVE_RESULTS, true),
      resultsPath: resolvePath(env.BENCHMARK_RESULTS_PATH, 'benchmark-results'),
    },

    // Logging configuration
    logLevel: (env.LOG_LEVEL || 'info') as Config['logLevel'],
    logFile: env.LOG_FILE ? resolvePath(env.LOG_FILE, '') : undefined,

    // Cache settings
    cacheEnabled: parseBool(env.CACHE_ENABLED, true),
    cacheDir: resolvePath(env.CACHE_DIR, '.cache'),
    maxCacheSize: parseInt(env.MAX_CACHE_SIZE || '1073741824', 10),

    // Startup benchmark targets — off by default; opt in via STARTUP_BENCHMARK_TARGETS
    startupBenchmarkTargets: (() => {
      const envVar = env.STARTUP_BENCHMARK_TARGETS;
      if (!envVar) {
        return [];
      }
      const targets = envVar.toLowerCase().split(',').map(t => t.trim()).filter(t => t);
      if (targets.includes('none')) {
        return [];
      }
      if (targets.includes('all')) {
        return ['local', 'free', 'paid'];
      }
      return [...new Set(targets)];
    })(),

    // Benchmark freshness TTL in hours (minimum 1h)
    benchmarkFreshnessHours: Math.max(1, parseNumber(env.BENCHMARK_FRESHNESS_HOURS, 24, 1)),

    // Hardware profile
    profile: (env.LOCALLAMA_PROFILE === 'lightweight' ? 'lightweight' : 'default') as 'default' | 'lightweight',

    // Paths
    rootDir,
  };
}

function getActiveHotReloadSnapshot(cfg: Config): ReloadConfigResult['activeConfig'] {
  return {
    defaultLocalModel: cfg.defaultLocalModel,
    defaultModelConfig: { ...cfg.defaultModelConfig },
    tokenThreshold: cfg.tokenThreshold,
    costThreshold: cfg.costThreshold,
    qualityThreshold: cfg.qualityThreshold,
    codeScoreThreshold: cfg.codeScoreThreshold,
    openRouterFreeOnly: cfg.openRouterFreeOnly,
    openRouterRateLimitPerMinute: cfg.openRouterRateLimitPerMinute,
    providerTimeoutMs: cfg.providerTimeoutMs,
    providerMaxConcurrentLocal: cfg.providerMaxConcurrentLocal,
    providerMaxConcurrentRemote: cfg.providerMaxConcurrentRemote,
    ollamaTimeout: cfg.ollamaTimeout,
    providerHealthProbeIntervalMs: cfg.providerHealthProbeIntervalMs,
    benchmark: {
      runsPerTask: cfg.benchmark.runsPerTask,
      parallel: cfg.benchmark.parallel,
      maxParallelTasks: cfg.benchmark.maxParallelTasks,
      taskTimeout: cfg.benchmark.taskTimeout,
      saveResults: cfg.benchmark.saveResults,
    },
    startupBenchmarkTargets: [...cfg.startupBenchmarkTargets],
    benchmarkFreshnessHours: cfg.benchmarkFreshnessHours,
    logLevel: cfg.logLevel,
    profile: cfg.profile,
  };
}

function applyHotReloadableFields(target: Config, source: Config): void {
  target.defaultLocalModel = source.defaultLocalModel;
  target.defaultModelConfig = { ...source.defaultModelConfig };
  target.tokenThreshold = source.tokenThreshold;
  target.costThreshold = source.costThreshold;
  target.qualityThreshold = source.qualityThreshold;
  target.codeScoreThreshold = source.codeScoreThreshold;
  target.openRouterFreeOnly = source.openRouterFreeOnly;
  target.openRouterRateLimitPerMinute = source.openRouterRateLimitPerMinute;
  target.providerTimeoutMs = source.providerTimeoutMs;
  target.providerMaxConcurrentLocal = source.providerMaxConcurrentLocal;
  target.providerMaxConcurrentRemote = source.providerMaxConcurrentRemote;
  target.ollamaTimeout = source.ollamaTimeout;
  target.providerHealthProbeIntervalMs = source.providerHealthProbeIntervalMs;
  target.benchmark.runsPerTask = source.benchmark.runsPerTask;
  target.benchmark.parallel = source.benchmark.parallel;
  target.benchmark.maxParallelTasks = source.benchmark.maxParallelTasks;
  target.benchmark.taskTimeout = source.benchmark.taskTimeout;
  target.benchmark.saveResults = source.benchmark.saveResults;
  target.startupBenchmarkTargets = [...source.startupBenchmarkTargets];
  target.benchmarkFreshnessHours = source.benchmarkFreshnessHours;
  target.logLevel = source.logLevel;
  target.profile = source.profile;
}
/**
 * Configuration for the LocalLama MCP Server
 */
export const config: Config = buildConfigFromEnv(process.env);
/**
 * Validate that the configuration is valid
 * @throws {Error} If the configuration is invalid
 */
export function validateConfig(): void {
  validateConfigValues(config);
}

function validateConfigValues(cfg: Config): void {
  const errors: string[] = [];
  // Validate server config
  if (cfg.server.port < 0 || cfg.server.port > 65535) {
    errors.push(`Invalid port number: ${cfg.server.port}`);
  }
  // Validate URLs
  try {
    new URL(cfg.lmStudioEndpoint);
    new URL(cfg.ollamaEndpoint);
    new URL(cfg.localLlamaEndpoint); // Added local Llama endpoint validation
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    errors.push(`Invalid endpoint URL in configuration: ${errorMessage}`);
  }
  // Validate thresholds
  if (cfg.tokenThreshold <= 0) {
    errors.push(`Invalid token threshold: ${cfg.tokenThreshold}`);
  }
  if (cfg.costThreshold <= 0) {
    errors.push(`Invalid cost threshold: ${cfg.costThreshold}`);
  }
  if (cfg.qualityThreshold <= 0 || cfg.qualityThreshold > 1) {
    errors.push(`Invalid quality threshold: ${cfg.qualityThreshold}`);
  }
  if (cfg.codeScoreThreshold < 0 || cfg.codeScoreThreshold > 1) {
    errors.push(`Invalid codeScoreThreshold: ${cfg.codeScoreThreshold}`);
  }
  // Validate model config
  const { temperature, topP, maxTokens } = cfg.defaultModelConfig;
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
  if (cfg.benchmark.runsPerTask <= 0) {
    errors.push(`Invalid runsPerTask: ${cfg.benchmark.runsPerTask}`);
  }
  if (cfg.benchmark.maxParallelTasks <= 0) {
    errors.push(`Invalid maxParallelTasks: ${cfg.benchmark.maxParallelTasks}`);
  }
  if (cfg.benchmark.taskTimeout <= 0) {
    errors.push(`Invalid taskTimeout: ${cfg.benchmark.taskTimeout}`);
  }
  if (cfg.providerHealthProbeIntervalMs <= 0) {
    errors.push(`Invalid providerHealthProbeIntervalMs: ${cfg.providerHealthProbeIntervalMs}`);
  }
  if (cfg.providerMaxConcurrentLocal <= 0) {
    errors.push(`Invalid providerMaxConcurrentLocal: ${cfg.providerMaxConcurrentLocal}`);
  }
  if (cfg.providerMaxConcurrentRemote <= 0) {
    errors.push(`Invalid providerMaxConcurrentRemote: ${cfg.providerMaxConcurrentRemote}`);
  }
  if (cfg.ollamaTimeout <= 0) {
    errors.push(`Invalid ollamaTimeout: ${cfg.ollamaTimeout}`);
  }
  if (cfg.providerTimeoutMs <= 0) {
    errors.push(`Invalid providerTimeoutMs: ${cfg.providerTimeoutMs}`);
  }
  // Validate cache config
  if (cfg.maxCacheSize <= 0) {
    errors.push(`Invalid maxCacheSize: ${cfg.maxCacheSize}`);
  }
  // Validate startup benchmark targets
  const validTargets = ['local', 'free', 'paid'];
  if (!Array.isArray(cfg.startupBenchmarkTargets)) {
    errors.push('Invalid startupBenchmarkTargets: Must be an array.');
  } else {
    for (const target of cfg.startupBenchmarkTargets) {
      if (!validTargets.includes(target)) {
        errors.push(`Invalid startupBenchmarkTarget: ${target}. Must be one of ${validTargets.join(', ')}.`);
      }
    }
  }
  if (errors.length > 0) {
    throw new Error(`Configuration validation failed:\n${errors.join('\n')}`);
  }
}

/**
 * Reload configuration from the root .env file and atomically apply hot-reloadable fields.
 * If validation fails, the active runtime config remains unchanged.
 */
export function reloadConfig(): ReloadConfigResult {
  const envPath = path.join(rootDir, '.env');
  const dotenvResult = dotenv.config({ path: envPath, override: true });
  if (dotenvResult.error) {
    const err = dotenvResult.error as NodeJS.ErrnoException;
    if (err.code !== 'ENOENT') {
      throw dotenvResult.error;
    }
  }

  const candidate = buildConfigFromEnv(process.env);
  validateConfigValues(candidate);
  applyHotReloadableFields(config, candidate);

  return {
    success: true,
    message:
      'Configuration reloaded from .env. Hot-reloadable fields were applied; restart-required fields were left unchanged.',
    envPath,
    appliedFields: HOT_RELOADABLE_CONFIG_FIELDS,
    restartRequiredFields: RESTART_REQUIRED_CONFIG_FIELDS,
    activeConfig: getActiveHotReloadSnapshot(config),
  };
}
