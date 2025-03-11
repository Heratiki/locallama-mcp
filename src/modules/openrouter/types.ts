/**
 * OpenRouter API response types
 */

/**
 * OpenRouter model information
 */
export interface OpenRouterModel {
  /** Unique identifier for the model */
  id: string;
  
  /** Human-readable name of the model */
  name: string;
  
  /** Provider of the model */
  provider: string;
  
  /** Whether the model is currently free to use */
  isFree: boolean;
  
  /** Context window size in tokens */
  contextWindow: number;
  
  /** Model capabilities */
  capabilities: {
    /** Whether the model supports chat */
    chat: boolean;
    /** Whether the model supports completion */
    completion: boolean;
    /** Whether the model supports vision */
    vision: boolean;
  };
  
  /** Cost per token */
  costPerToken: {
    /** Cost per prompt token */
    prompt: number;
    /** Cost per completion token */
    completion: number;
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
  };
  
  /** Last time the model was updated */
  lastUpdated: string;
  
  /** Model version */
  version?: string;
}

/**
 * OpenRouter API models response
 */
export interface OpenRouterModelsResponse {
  /** List of available models */
  data: {
    /** Model ID */
    id: string;
    
    /** Model name */
    name?: string;
    
    /** Model context window */
    context_length?: number;
    
    /** Model pricing */
    pricing?: {
      /** Prompt token price */
      prompt?: number;
      
      /** Completion token price */
      completion?: number;
    };
    
    /** Model features */
    features?: {
      /** Whether the model supports chat */
      chat?: boolean;
      
      /** Whether the model supports completion */
      completion?: boolean;
      
      /** Whether the model supports vision */
      vision?: boolean;
    };
  }[];
}

/**
 * OpenRouter error response
 */
export interface OpenRouterErrorResponse {
  /** Error object */
  error: {
    /** Error message */
    message: string;
    
    /** Error type */
    type: string;
    
    /** Error code */
    code?: string;
    
    /** Error param */
    param?: string;
  };
}

/**
 * OpenRouter model tracking information
 */
export interface OpenRouterModelTracking {
  /** Map of model IDs to model information */
  models: Record<string, OpenRouterModel>;
  
  /** Last time the models were updated */
  lastUpdated: string;
  
  /** Free models available */
  freeModels: string[];
}

/**
 * OpenRouter prompting strategy
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
}

/**
 * OpenRouter error types
 */
export enum OpenRouterErrorType {
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