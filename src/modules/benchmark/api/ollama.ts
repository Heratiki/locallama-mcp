import axios from 'axios';
import { config } from '../../../config/index.js';
import { logger } from '../../../utils/logger.js';

// Define interface for Ollama API response
interface OllamaResponse {
  model: string;
  message: {
    role: string;
    content: string;
  };
  done: boolean;
  total_duration?: number;
  load_duration?: number;
  prompt_eval_duration?: number;
  eval_duration?: number;
  speculativeDecoding?: {
    draft_model?: string;
    total_draft_tokens?: number;
    accepted_draft_tokens?: number;
    tokens_per_second?: number;
  };
}

/**
 * Call Ollama API with support for speculative decoding
 */
export async function callOllamaApi(
  modelId: string,
  task: string,
  timeout: number,
  draftModelId?: string
): Promise<{
  success: boolean;
  text?: string;
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
  };
  stats?: {
    tokens_per_second?: number;
    draft_model?: string;
    accepted_draft_tokens_count?: number;
    total_draft_tokens_count?: number;
  };
}> {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);
    
    // Use temperature and other parameters from the default model config
    const temperature = config.defaultModelConfig.temperature;
    const maxTokens = config.defaultModelConfig.maxTokens;
    
    // Prepare request body
    const requestBody: Record<string, unknown> = {
      model: modelId,
      messages: [
        { role: 'system', content: 'You are a helpful assistant.' },
        { role: 'user', content: task }
      ],
      options: {
        temperature: temperature,
        num_predict: maxTokens,
      },
      stream: false,
    };
    
    // Add draft model if provided
    if (draftModelId) {
      logger.info(`Using speculative decoding with draft model ${draftModelId} for Ollama model ${modelId}`);
      (requestBody.options as Record<string, unknown>).draft_model = draftModelId;
    }
    
    logger.debug(`Ollama API call for ${modelId} using temperature: ${temperature}, maxTokens: ${maxTokens}`);
    
    const response = await axios.post<OllamaResponse>(
      `${config.ollamaEndpoint}/chat`,
      requestBody,
      {
        signal: controller.signal,
        headers: {
          'Content-Type': 'application/json',
        },
      }
    );
    
    clearTimeout(timeoutId);
    
    if (response.status === 200 && response.data.message) {
      // Ollama doesn't provide token counts directly, so we estimate
      const promptTokens = Math.ceil(task.length / 4);
      const completionTokens = Math.ceil(response.data.message.content.length / 4);
      
      const result: {
        success: boolean;
        text?: string;
        usage?: {
          prompt_tokens: number;
          completion_tokens: number;
        };
        stats?: {
          tokens_per_second?: number;
          draft_model?: string;
          accepted_draft_tokens_count?: number;
          total_draft_tokens_count?: number;
        };
      } = {
        success: true,
        text: response.data.message.content,
        usage: {
          prompt_tokens: promptTokens,
          completion_tokens: completionTokens,
        },
      };
      
      // Add speculative decoding stats if available
      if (response.data.speculativeDecoding) {
        result.stats = {
          tokens_per_second: response.data.speculativeDecoding.tokens_per_second,
          draft_model: response.data.speculativeDecoding.draft_model,
          accepted_draft_tokens_count: response.data.speculativeDecoding.accepted_draft_tokens,
          total_draft_tokens_count: response.data.speculativeDecoding.total_draft_tokens
        };
        
        // Log speculative decoding stats if available
        if (response.data.speculativeDecoding.draft_model && 
            response.data.speculativeDecoding.accepted_draft_tokens) {
          logger.info(`Speculative decoding stats for Ollama model ${modelId}:`);
          logger.info(` - Draft model: ${response.data.speculativeDecoding.draft_model}`);
          logger.info(` - Total draft tokens: ${response.data.speculativeDecoding.total_draft_tokens}`);
          logger.info(` - Accepted draft tokens: ${response.data.speculativeDecoding.accepted_draft_tokens}`);
          logger.info(` - Tokens per second: ${response.data.speculativeDecoding.tokens_per_second}`);
          logger.info(` - Acceptance rate: ${(response.data.speculativeDecoding.accepted_draft_tokens / 
            (response.data.speculativeDecoding.total_draft_tokens || 1) * 100).toFixed(1)}%`);
        }
      }
      
      return result;
    } else {
      return { success: false };
    }
  } catch (error) {
    logger.error(`Error calling Ollama API for model ${modelId}:`, error);
    return { success: false };
  }
}