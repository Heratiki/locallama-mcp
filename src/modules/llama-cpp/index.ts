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
import { config } from '../../config/index.js';
import { logger } from '../../utils/logger.js';
import { Model } from '../../types/index.js';
import {
  LlamaCppApiCallResult,
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

export const llamaCppModule = {
  /** Detected runtime mode — set during initialize(). */
  mode: 'unknown' as LlamaCppMode,

  /** Capability flags populated during initialize(). */
  capabilities: {
    mode: 'unknown' as LlamaCppMode,
    modelCount: 0,
    supportsMultiModel: false,
  } as LlamaCppCapabilities,

  /** In-memory cache of models reported by the server. */
  cachedModels: [] as LlamaCppApiModel[],

  /**
   * Initialize the module. Fetches the live model list from the server and
   * detects the runtime mode. Failures are non-fatal: the provider will surface
   * as unavailable if the endpoint is unreachable.
   */
  async initialize(): Promise<void> {
    logger.debug('Initializing llama.cpp module');

    if (!config.llamaCppEndpoint) {
      logger.debug('LLAMA_CPP_ENDPOINT not set; llama.cpp provider will be unavailable');
      return;
    }

    try {
      await this.refreshModels();
    } catch (error) {
      logger.debug(
        `llama.cpp init failed (server may not be running): ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  },

  /**
   * Fetch the live model list from GET /v1/models and update the in-memory
   * cache plus capability flags.
   */
  async refreshModels(): Promise<void> {
    if (!config.llamaCppEndpoint) return;

    const url = `${config.llamaCppEndpoint}/v1/models`;
    logger.debug(`Fetching llama.cpp model list from ${url}`);

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

    logger.info(
      `llama.cpp detected mode=${this.mode}, models=${models.map((m) => m.id).join(', ')}`,
    );
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
