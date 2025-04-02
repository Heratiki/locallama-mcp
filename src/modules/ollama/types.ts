/**
 * Ollama API response types
 */

/**
 * Ollama model information
 */
export interface OllamaModel {
  /** Unique identifier for the model */
  id: string;
  
  /** Human-readable name of the model */
  name: string;
  
  /** Provider of the model (always 'ollama') */
  provider: string;
  
  /** Context window size in tokens */
  contextWindow: number;
  
  /** Model family (e.g., 'llama', 'mistral') */
  family?: string;
  
  /** Model capabilities */
  capabilities: {
    /** Whether the model supports chat */
    chat: boolean;
    /** Whether the model supports completion */
    completion: boolean;
    /** Whether the model supports embedding */
    embedding?: boolean;
    /** Whether the model supports speculative inference */
    speculativeInference?: boolean;
  };
  
  /** Recommended prompting strategy */
  promptingStrategy?: {
    /** System prompt template */
    systemPrompt?: string;
    /** User prompt template */
    userPrompt?: string;
    /** Assistant prompt template */
    assistantPrompt?: string;
    /** Whether to use chat format */
    useChat: boolean;
    /** Whether this strategy has been automatically improved */
    autoImproved?: boolean;
  };
  
  /** Last time the model was updated */
  lastUpdated: string;
  
  /** Model size in parameters (e.g., 7B, 13B) */
  size?: string;
  
  /** Model quantization (e.g., Q4_K_M, Q5_K_M) */
  quantization?: string;
  
  /** Model version */
  version?: string;
  
  /** File size on disk in bytes */
  fileSize?: number;
  
  /** Whether model can be used without downloading */
  isLocal?: boolean;
}

/**
 * Ollama model tracking information
 */
export interface OllamaModelTracking {
  /** Map of model IDs to model information */
  models: Record<string, OllamaModel>;
  
  /** Last time the models were updated */
  lastUpdated: string;
}

/**
 * Ollama prompting strategy
 */
export interface PromptingStrategy {
  /** Model ID */
  modelId: string;
  
  /** System prompt template */
  systemPrompt?: string;
  
  /** User prompt template */
  userPrompt?: string;
  
  /** Assistant prompt template */
  assistantPrompt?: string;
  
  /** Whether to use chat format */
  useChat: boolean;
  
  /** Success rate with this strategy */
  successRate: number;
  
  /** Quality score with this strategy */
  qualityScore: number;
  
  /** Last time the strategy was updated */
  lastUpdated: string;
  
  /** Number of automatic improvements attempted */
  improvementAttempts?: number;
  
  /** Whether this strategy can be automatically improved */
  canAutoImprove?: boolean;
  
  /** Array of past strategy versions for comparison */
  previousVersions?: Array<Omit<PromptingStrategy, 'previousVersions'>>;
}

/**
 * Speculative inference configuration
 */
export interface SpeculativeInferenceConfig {
  /** Whether speculative inference is enabled */
  enabled: boolean;
  
  /** The maximum number of tokens to predict */
  maxTokens?: number;
  
  /** The temperature for the speculative generation */
  temperature?: number;
  
  /** The acceptance threshold for speculative tokens */
  acceptanceThreshold?: number;
}

/**
 * Auto-improvement configuration for prompting strategies
 */
export interface PromptImprovementConfig {
  /** Whether auto-improvement is enabled */
  enabled: boolean;
  
  /** Minimum quality score that triggers improvement attempts */
  minimumQualityThreshold?: number;
  
  /** Maximum number of improvement attempts per strategy */
  maxAttempts?: number;
  
  /** Cooldown period between improvement attempts (in hours) */
  cooldownPeriod?: number;
}

/**
 * Ollama error types
 */
export enum OllamaErrorType {
  /** Rate limit exceeded */
  RATE_LIMIT = 'rate_limit',
  
  /** Authentication error */
  AUTHENTICATION = 'authentication',
  
  /** Invalid request */
  INVALID_REQUEST = 'invalid_request',
  
  /** Model not found */
  MODEL_NOT_FOUND = 'model_not_found',
  
  /** Context length exceeded */
  CONTEXT_LENGTH_EXCEEDED = 'context_length_exceeded',
  
  /** Server error */
  SERVER_ERROR = 'server_error',
  
  /** Unknown error */
  UNKNOWN = 'unknown'
}

/**
 * Ollama chat message
 */
export interface OllamaMessage {
  /** Message role (system, user, assistant) */
  role: string;
  
  /** Message content */
  content: string;
}

/**
 * Ollama API response for chat
 */
export interface OllamaChatResponse {
  /** Generated output message */
  message: {
    role: string;
    content: string;
  };
  
  /** Model used for generation */
  model: string;
  
  /** Time created */
  created_at: string;
  
  /** Processing metrics */
  done: boolean;
  
  /** Total duration in milliseconds */
  total_duration?: number;
  
  /** Load duration in milliseconds */
  load_duration?: number;
  
  /** Prompt evaluation duration */
  prompt_eval_duration?: number;
  
  /** Evaluation count */
  eval_count?: number;
  
  /** Evaluation duration */
  eval_duration?: number;
  
  /** Usage metrics */
  usage?: {
    /** Input token count */
    prompt_tokens: number;
    /** Output token count */
    completion_tokens: number;
    /** Total token count */
    total_tokens: number;
  };
  
  /** Speculative inference stats (new) */
  speculative_inference?: {
    /** Number of tokens generated using speculative inference */
    tokens_generated: number;
    /** Number of tokens accepted from speculative inference */
    tokens_accepted: number;
    /** Time saved in milliseconds */
    time_saved_ms: number;
  };
}

/**
 * Ollama API response from /api/list endpoint
 */
export interface OllamaListModelsResponse {
  /** List of available models */
  models: {
    /** Model name */
    name: string;
    /** Model ID */
    model: string;
    /** Model size in bytes */
    size?: number;
    /** Model digest */
    digest?: string;
    /** Model format version */
    format?: string;
    /** Model template */
    template?: string;
    /** Model parameters */
    parameter_size?: string;
    /** Model quantization format */
    quantization_level?: string;
    /** Last modification timestamp */
    modified_at?: string;
    /** Model details (JSON string as an object) */
    details?: Record<string, unknown>;
  }[];
}