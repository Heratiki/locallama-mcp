import { Model } from '../../types/index.js';

/**
 * Speculative inference configuration
 */
export interface SpeculativeInferenceConfig {
  enabled: boolean;
  maxTokens: number;
  temperature: number;
  acceptanceThreshold: number;
}

/**
 * Prompt improvement configuration
 */
export interface PromptImprovementConfig {
  enabled: boolean;
  minimumQualityThreshold: number;
  maxAttempts: number;
  cooldownPeriod: number; // hours
}

/**
 * LM Studio error types
 */
export enum LMStudioErrorType {
  AUTHENTICATION = 'authentication',
  RATE_LIMIT = 'rate_limit',
  INVALID_REQUEST = 'invalid_request',
  CONTENT_FILTER = 'content_filter',
  CONTEXT_LENGTH_EXCEEDED = 'context_length_exceeded',
  SERVER_ERROR = 'server_error',
  MODEL_NOT_FOUND = 'model_not_found',
  UNSUPPORTED_MODEL = 'unsupported_model',
  UNKNOWN = 'unknown'
}

/**
 * LM Studio model information
 */
export interface LMStudioModel extends Model {
  promptingStrategy?: Partial<PromptingStrategy>;
  capabilities: {
    chat: boolean;
    completion: boolean;
    contextWindow: number;
    speculativeInference: boolean;
    supportedFormats: string[];
  };
  lastUpdated?: string;
  family?: string;
}

/**
 * LM Studio model tracking
 */
export interface LMStudioModelTracking {
  models: Record<string, LMStudioModel>;
  lastUpdated: string;
}

/**
 * LM Studio chat message
 */
export interface LMStudioChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

/**
 * LM Studio response
 */
export interface LMStudioResponse {
  id: string;
  object: string;
  created: number;
  model: string;
  choices: {
    index: number;
    message: {
      role: string;
      content: string;
    };
    finish_reason: string;
  }[];
  usage: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

/**
 * Prompting strategy for a model
 */
export interface PromptingStrategy {
  modelId: string;
  systemPrompt: string;
  userPrompt?: string;
  assistantPrompt?: string;
  useChat: boolean;
  successRate: number;
  qualityScore: number;
  lastUpdated: string;
  improvementAttempts?: number;
  canAutoImprove?: boolean;
  previousVersions?: Partial<PromptingStrategy>[];
}