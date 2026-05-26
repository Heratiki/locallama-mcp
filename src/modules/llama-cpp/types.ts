/**
 * Type definitions for the llama.cpp (llama-server) provider.
 *
 * llama-server exposes an OpenAI-compatible HTTP API. Two runtime modes:
 *   - single-model: one model loaded; POST /v1/chat/completions dispatches to it.
 *   - router: multiple models loaded; /v1/models lists them all.
 *
 * The server does NOT have a stable public unload API (as of llama.cpp b3xxx).
 * releaseResources() is therefore a documented no-op for both modes.
 */

export enum LlamaCppErrorType {
  SERVER_ERROR = 'server_error',
  MODEL_NOT_FOUND = 'model_not_found',
  CONTEXT_LENGTH_EXCEEDED = 'context_length_exceeded',
  INVALID_REQUEST = 'invalid_request',
  TIMEOUT = 'timeout',
  UNKNOWN = 'unknown',
}

/** Runtime mode detected from /v1/models response. */
export type LlamaCppMode = 'single-model' | 'router' | 'unknown';

/** A model entry as returned by GET /v1/models. */
export interface LlamaCppApiModel {
  id: string;
  object?: string;
  owned_by?: string;
  /** Some builds surface context window in metadata. */
  meta?: {
    n_ctx_train?: number;
    [key: string]: unknown;
  };
}

export interface LlamaCppListModelsResponse {
  object?: string;
  data: LlamaCppApiModel[];
}

export interface LlamaCppChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface LlamaCppChatRequest {
  model?: string;
  messages: LlamaCppChatMessage[];
  stream?: boolean;
  temperature?: number;
  max_tokens?: number;
}

export interface LlamaCppChatChoice {
  index: number;
  message: LlamaCppChatMessage;
  finish_reason?: string;
}

export interface LlamaCppUsage {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
}

export interface LlamaCppChatResponse {
  id?: string;
  object?: string;
  model?: string;
  choices: LlamaCppChatChoice[];
  usage?: LlamaCppUsage;
}

export interface LlamaCppApiCallResult {
  success: boolean;
  text?: string;
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
  };
  error?: LlamaCppErrorType;
}

/** Provider-level capability flags populated during init(). */
export interface LlamaCppCapabilities {
  mode: LlamaCppMode;
  modelCount: number;
  supportsMultiModel: boolean;
  health: 'healthy' | 'degraded' | 'unhealthy' | 'unknown';
  lastHealthCheck: string;
  lastHealthCheckResult: string;
  /** True if llama-server binary was discovered on disk. */
  binaryDiscovered: boolean;
}

/** Resolved paths and capabilities of local llama.cpp binaries. */
export interface LlamaBinarySet {
  /** Path to llama-server (or server) binary. */
  server: string | null;
  /** Path to llama-cli binary. */
  cli: string | null;
  /** Path to llama-run binary. */
  run: string | null;
  /** Version string extracted from --version. */
  version: string | null;
  /** True if the server binary supports the --reasoning-format flag. */
  supportsReasoningFormat: boolean;
  /** List of all paths searched during discovery. */
  searchedPaths: string[];
}
