/**
 * llama.cpp (llama-server) Module
 *
 * Communicates with a running llama-server instance via its OpenAI-compatible
 * HTTP API. Phase 1 only — no subprocess lifecycle management.
 *
 * Runtime modes
 * -------------
 * single-model  GET /v1/models returns exactly one entry.
 * router        GET /v1/models returns more than one entry.
 *
 * releaseResources is a documented no-op: llama-server has no stable public
 * model-unload endpoint as of the b3xxx builds. If a verified unload API is
 * added in a future llama.cpp release, implement it here.
 */

import axios, { AxiosError } from 'axios';
import { spawn } from 'child_process';
import { config } from '../../config/index.js';
import { logger } from '../../utils/logger.js';
import { Model } from '../../types/index.js';
import {
  LlamaCppApiCallResult,
  LlamaBinarySet,
  LlamaCppApiModel,
  LlamaCppCapabilities,
  LlamaCppChatRequest,
  LlamaCppChatResponse,
  LlamaCppErrorType,
  LlamaCppListModelsResponse,
  LlamaCppMode,
} from './types.js';
import { InferenceTimeoutError } from '../utils/inferenceTimeout.js';
import { sanitizeErrorForLogging } from '../utils/sanitizeErrorForLogging.js';
import { discoverLlamaBinaries } from './discovery.js';
import { LlamaServerManager } from './manager.js';
import { readGgufMetadata, GgufMetadata } from './gguf.js';

function isDegenerate(text: string): boolean {
  if (!text || /^\s*$/.test(text)) return true; // empty or whitespace
  if (text.toLowerCase().includes('thinking')) return true;

  const uniqueChars = new Set(text);
  if (uniqueChars.size <= 2) {
    // It's only non-degenerate if it's a short, simple word like 'ok'
    if (text.length > 4) return true; // Definitely degenerate if long and repetitive
    if (text.toLowerCase() !== 'ok') return true; // '..', '??', 'aa' are degenerate
  }

  return false;
}


export const llamaCppModule = {
  /** Detected runtime mode — set during initialize(). */
  mode: 'unknown' as LlamaCppMode,

  /** Capability flags populated during initialize(). */
  capabilities: {
    mode: 'unknown' as LlamaCppMode,
    modelCount: 0,
    supportsMultiModel: false,
    health: 'unknown',
    lastHealthCheck: new Date(0).toISOString(),
    lastHealthCheckResult: 'not yet run',
    binaryDiscovered: false,
    managedProcess: false,
    resolvedPort: null,
    restartCount: 0,
    modelMetadata: null,
  } as LlamaCppCapabilities,

  /** Managed child process manager. */
  manager: new LlamaServerManager(),

  /** Resolved local binaries and their capabilities. */
  binaries: null as LlamaBinarySet | null,

  /** GGUF metadata read from the configured model file. Null until populated. */
  modelMetadata: null as GgufMetadata | null,

  /** In-memory cache of models reported by the server. */
  cachedModels: [] as LlamaCppApiModel[],

  /**
   * Initialize the module. Fetches the live model list from the server and
   * detects the runtime mode. Failures are non-fatal: the provider will surface
   * as unavailable if the endpoint is unreachable.
   */
  async _runHealthProbe(): Promise<void> {
    if (!config.llamaCppHealthProbeEnabled) {
      this.capabilities.health = 'healthy';
      this.capabilities.lastHealthCheckResult = 'disabled';
      this.capabilities.lastHealthCheck = new Date().toISOString();
      return;
    }

    if (this.cachedModels.length === 0) {
      this.capabilities.health = 'unhealthy';
      this.capabilities.lastHealthCheckResult = 'no models found';
      this.capabilities.lastHealthCheck = new Date().toISOString();
      return;
    }

    const modelId = this.cachedModels[0].id;
    const result = await this.callApi(
      modelId,
      config.llamaCppHealthProbePrompt,
      config.llamaCppHealthProbeTimeoutMs,
    );

    this.capabilities.lastHealthCheck = new Date().toISOString();

    if (!result.success) {
      this.capabilities.health = 'unhealthy';
      this.capabilities.lastHealthCheckResult = `API call failed: ${result.error ?? 'unknown'}`;
    } else if (!result.text || isDegenerate(result.text)) {
      this.capabilities.health = 'degraded';
      this.capabilities.lastHealthCheckResult = `degenerate response: "${result.text?.slice(0, 50) ?? ''}"`;
    } else {
      this.capabilities.health = 'healthy';
      this.capabilities.lastHealthCheckResult = 'ok';
    }

    logger.info(
      `llama.cpp health probe: model=${modelId}, status=${this.capabilities.health} ` +
      `(${this.capabilities.lastHealthCheckResult})`,
    );
  },

  /**
   * Initialize the module. Fetches the live model list from the server and
   * detects the runtime mode. Failures are non-fatal: the provider will surface
   * as unavailable if the endpoint is unreachable.
   */
  async initialize(): Promise<void> {
    logger.debug('Initializing llama.cpp module');

    // 1. Discovery
    try {
      this.binaries = await discoverLlamaBinaries();
      if (this.binaries) {
        this.capabilities.binaryDiscovered = !!this.binaries.server;
        if (this.capabilities.binaryDiscovered) {
          logger.info(`llama.cpp binary found: ${this.binaries.server} (version: ${this.binaries.version ?? 'unknown'})`);
        }
      }
    } catch (error) {
      logger.debug(`llama.cpp binary discovery failed: ${error instanceof Error ? error.message : String(error)}`);
    }

    // 2. Try reaching existing endpoint
    if (config.llamaCppEndpoint) {
      try {
        await this.refreshModels();
        if (this.cachedModels.length > 0) {
          logger.info(`Connected to existing llama.cpp endpoint: ${config.llamaCppEndpoint}`);
          await this._runHealthProbe();
          return;
        }
      } catch {
        logger.debug(`Existing llama.cpp endpoint ${config.llamaCppEndpoint} unreachable`);
      }
    }

    // 3. Attempt managed spawn
    const binary = config.llamaCppServerBin || this.binaries?.server;
    const model = config.llamaCppModelPath;

    if (binary && model) {
      try {
        // Read GGUF metadata to inform flag selection before spawning
        const metadata = await readGgufMetadata(model, config.llamaCppMaxCtx ?? null);
        this.modelMetadata = metadata;
        this.capabilities.modelMetadata = metadata;

        const extraFlags = [...metadata.recommendedFlags, ...(config.llamaCppServerFlags ?? [])];

        const port = await this.manager.findFreePort(config.llamaCppPort);
        await this.manager.spawnServer(binary, model, port, extraFlags);
        
        // Update config endpoint for subsequent calls
        (config as any).llamaCppEndpoint = `http://localhost:${port}`;
        
        this.capabilities.managedProcess = true;
        this.capabilities.resolvedPort = port;
        
        await this.refreshModels();
        await this._runHealthProbe();
      } catch (error) {
        logger.error(`Failed to start managed llama-server: ${error instanceof Error ? error.message : String(error)}`);
        this.capabilities.health = 'unhealthy';
        this.capabilities.lastHealthCheckResult = 'managed spawn failed';
      }
    } else {
      if (!config.llamaCppEndpoint) {
        logger.debug('No llama.cpp endpoint or managed config (bin+model) set; provider unavailable');
      }
    }
  },

  /**
   * Stop the managed server if running.
   */
  async shutdown(): Promise<void> {
    if (this.capabilities.managedProcess) {
      await this.manager.stopServer();
      this.capabilities.managedProcess = false;
    }
  },

  /**
   * Fetch the live model list from GET /v1/models and update the in-memory
   */
  async refreshModels(): Promise<void> {
    if (!config.llamaCppEndpoint) return;

    const url = `${config.llamaCppEndpoint}/v1/models`;
    logger.debug(`Fetching llama.cpp model list from ${url}`);

    try {
      const response = await axios.get<LlamaCppListModelsResponse>(url, {
        timeout: 5000,
        headers: { Accept: 'application/json' },
      });

      const models: LlamaCppApiModel[] = Array.isArray(response.data?.data)
        ? response.data.data
        : [];

      this.cachedModels = models;
      this.capabilities.modelCount = models.length;

      if (models.length === 0) {
        this.mode = 'unknown';
      } else if (models.length === 1) {
        this.mode = 'single-model';
      } else {
        this.mode = 'router';
      }

      this.capabilities.mode = this.mode;
      this.capabilities.supportsMultiModel = this.mode === 'router';
      this.capabilities.restartCount = this.manager.getRestartCount();

      logger.info(
        `llama.cpp detected mode=${this.mode}, models=${models.map((m) => m.id).join(', ')}`,
      );
    } catch (error) {
      this.capabilities.restartCount = this.manager.getRestartCount();
      throw error;
    }
  },

  /**
   * Return the cached model list as the common Model shape used by the cost
   * monitor and model registry. Never scans disk — reflects server state only.
   */
  async getAvailableModels(): Promise<Model[]> {
    if (!config.llamaCppEndpoint) return [];

    if (this.cachedModels.length === 0) {
      try {
        await this.refreshModels();
      } catch {
        return [];
      }
    }

    return this.cachedModels.map((m) => ({
      id: `llama-cpp:${m.id}`,
      name: m.id,
      provider: 'llama-cpp',
      capabilities: { chat: true, completion: true },
      costPerToken: { prompt: 0, completion: 0 },
      contextWindow: m.meta?.n_ctx_train ?? 4096,
    }));
  },

  /**
   * Execute a task via POST /v1/chat/completions (OpenAI-compatible).
   */
  async executeTask(
    modelId: string,
    task: string,
    options?: { timeoutMs?: number; systemPrompt?: string; temperature?: number; maxTokens?: number },
  ): Promise<string> {
    if (!config.llamaCppEndpoint) {
      throw new Error('LLAMA_CPP_ENDPOINT not configured');
    }

    const timeout =
      options?.timeoutMs && options.timeoutMs > 0
        ? options.timeoutMs
        : config.providerTimeoutMs;

    const result = await this.callApi(modelId, task, timeout, options);

    if (!result.success || !result.text) {
      switch (result.error) {
        case LlamaCppErrorType.CONTEXT_LENGTH_EXCEEDED:
          throw new Error('Context length exceeded. Please reduce the size of your task.');
        case LlamaCppErrorType.MODEL_NOT_FOUND:
          throw new Error(`Model ${modelId} not found in llama.cpp server.`);
        case LlamaCppErrorType.TIMEOUT:
          throw new InferenceTimeoutError(
            'llama-cpp',
            timeout,
            `llama.cpp inference timed out after ${timeout}ms.`,
          );
        case LlamaCppErrorType.SERVER_ERROR:
          throw new Error('llama.cpp server error. Ensure llama-server is running.');
        default:
          throw new Error(`llama.cpp execution failed: ${result.error ?? 'unknown'}`);
      }
    }

    return result.text;
  },

  /**
   * Low-level API call. Exposed separately so tests can target it directly.
   */
  async callApi(
    modelId: string,
    task: string,
    timeout: number,
    options?: { systemPrompt?: string; temperature?: number; maxTokens?: number },
  ): Promise<LlamaCppApiCallResult> {
    const endpoint = config.llamaCppEndpoint;
    if (!endpoint) {
      return { success: false, error: LlamaCppErrorType.SERVER_ERROR };
    }

    const url = `${endpoint}/v1/chat/completions`;

    const temperature = options?.temperature ?? config.defaultModelConfig.temperature;
    const maxTokens = options?.maxTokens ?? config.defaultModelConfig.maxTokens;
    const systemPrompt = options?.systemPrompt ?? 'You are a helpful assistant.';

    const body: LlamaCppChatRequest = {
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: task },
      ],
      stream: false,
      temperature,
      max_tokens: maxTokens,
    };

    // In single-model mode the server ignores the model field; in router mode
    // it selects the target model. Always send it for router compatibility.
    if (modelId) {
      body.model = modelId;
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);

    try {
      const response = await axios.post<LlamaCppChatResponse>(url, body, {
        signal: controller.signal,
        headers: { 'Content-Type': 'application/json' },
      });
      clearTimeout(timeoutId);

      const content = response.data?.choices?.[0]?.message?.content;
      if (!content) {
        logger.warn('llama.cpp returned an empty choices array or missing content');
        return { success: false, error: LlamaCppErrorType.INVALID_REQUEST };
      }

      const usage = response.data.usage;
      return {
        success: true,
        text: content,
        usage: usage
          ? { prompt_tokens: usage.prompt_tokens, completion_tokens: usage.completion_tokens }
          : undefined,
      };
    } catch (error) {
      clearTimeout(timeoutId);
      return {
        success: false,
        error: this.classifyError(error instanceof Error ? error : new Error(String(error))),
      };
    }
  },

  /**
   * Execute a task via the llama-cli binary (subprocess, no server required).
   * Returns captured, filtered stdout.
   */
  async executeTaskViaCli(
    modelId: string,
    task: string,
    options?: { timeoutMs?: number; systemPrompt?: string; temperature?: number; maxTokens?: number },
  ): Promise<{ content: string; model: string }> {
    const cliBin = this.binaries?.cli;
    if (!cliBin) {
      throw new Error('llama-cli binary not available');
    }

    const modelPath = config.llamaCppModelPath;
    if (!modelPath) {
      throw new Error('No model path configured (LLAMA_CPP_MODEL_PATH)');
    }

    const temperature = options?.temperature ?? config.defaultModelConfig?.temperature ?? 0.7;
    const maxTokens = options?.maxTokens ?? config.defaultModelConfig?.maxTokens ?? 512;
    const recommendedFlags = this.modelMetadata?.recommendedFlags ?? [];

    const prompt = options?.systemPrompt
      ? `${options.systemPrompt}\n\n${task}`
      : task;

    const args = [
      '--model', modelPath,
      '--prompt', prompt,
      '--n-predict', String(maxTokens),
      '--temp', String(temperature),
      '--no-display-prompt',
      '--log-disable',
      ...recommendedFlags,
    ];

    return new Promise((resolve, reject) => {
      const proc = spawn(cliBin, args, { stdio: ['ignore', 'pipe', 'pipe'] });
      const chunks: Buffer[] = [];

      const timeoutMs = options?.timeoutMs && options.timeoutMs > 0 ? options.timeoutMs : 30000;
      const timer = setTimeout(() => {
        proc.kill('SIGKILL');
        reject(new Error(`llama-cli timeout after ${timeoutMs}ms`));
      }, timeoutMs);

      proc.stdout.on('data', (chunk: Buffer) => chunks.push(chunk));

      proc.on('exit', (code) => {
        clearTimeout(timer);
        if (code !== 0) {
          reject(new Error(`llama-cli exited with code ${code}`));
          return;
        }

        const raw = Buffer.concat(chunks).toString('utf-8');
        const filtered = raw
          .split('\n')
          .filter((line) => {
            if (/^llama_/.test(line)) return false;
            if (/^\[/.test(line)) return false;
            return true;
          })
          .join('\n')
          .trim();

        resolve({ content: filtered, model: modelId });
      });

      proc.on('error', (err) => {
        clearTimeout(timer);
        reject(err);
      });
    });
  },

  /**
   * releaseResources — documented no-op for Phase 1.
   *
   * llama-server (as of b3xxx) has no stable public model-unload endpoint.
   * Single-model mode: the single loaded model cannot be unloaded without
   * restarting the server. Router mode: no verified unload API exists.
   *
   * If a stable unload API is confirmed in a future llama.cpp release, implement
   * it here. Until then this is intentionally a no-op to avoid guessing at
   * unstable internal endpoints.
   */
  async releaseResources(_modelId?: string): Promise<void> {
    logger.debug(
      'llama.cpp releaseResources called — no-op (no stable unload API in llama-server)',
    );
  },

  /** Translate Axios/HTTP errors to LlamaCppErrorType. */
  classifyError(error: Error): LlamaCppErrorType {
    if (axios.isAxiosError(error)) {
      const axiosError = error as AxiosError;
      const status = axiosError.response?.status;
      const code = axiosError.code;

      if (code === 'ECONNABORTED' || code === 'ERR_CANCELED') return LlamaCppErrorType.TIMEOUT;
      if (code === 'ECONNREFUSED' || code === 'ENOTFOUND') return LlamaCppErrorType.SERVER_ERROR;
      if (status === 404) return LlamaCppErrorType.MODEL_NOT_FOUND;
      if (status === 400) {
        const body = axiosError.response?.data as Record<string, unknown> | undefined;
        const msg = typeof body?.error === 'string' ? body.error : '';
        if (msg.includes('context')) return LlamaCppErrorType.CONTEXT_LENGTH_EXCEEDED;
        return LlamaCppErrorType.INVALID_REQUEST;
      }
      if (status && status >= 500) return LlamaCppErrorType.SERVER_ERROR;
    } else if (error.name === 'AbortError') {
      return LlamaCppErrorType.TIMEOUT;
    } else {
      const msg = error.message.toLowerCase();
      if (msg.includes('context length') || msg.includes('context window')) {
        return LlamaCppErrorType.CONTEXT_LENGTH_EXCEEDED;
      }
      if (msg.includes('econnrefused') || msg.includes('enotfound')) {
        return LlamaCppErrorType.SERVER_ERROR;
      }
    }

    logger.debug(
      `llama.cpp unclassified error: ${sanitizeErrorForLogging(error)}`,
    );
    return LlamaCppErrorType.UNKNOWN;
  },
};
