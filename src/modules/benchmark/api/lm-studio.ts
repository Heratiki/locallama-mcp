import axios from 'axios';
import { config } from '../../../config/index.js';
import { logger } from '../../../utils/logger.js';

// Define the response structure
interface LmStudioResponse {
  choices: {
    message: {
      content: string;
      role: string;
    };
    finish_reason?: string;
    index: number;
  }[];
  usage: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
  created?: number;
  id?: string;
  model?: string;
  object?: string;
  stats?: {
    tokens_per_second?: number;
    time_to_first_token?: number;
    generation_time?: number;
    stop_reason?: string;
    draft_model?: string;
    total_draft_tokens_count?: number;
    accepted_draft_tokens_count?: number;
    rejected_draft_tokens_count?: number;
    ignored_draft_tokens_count?: number;
  };
}

/**
 * Call LM Studio API with support for speculative decoding
 */
export async function callLmStudioApi(
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
    
    // Use temperature and maxTokens from the default model config
    const temperature = config.defaultModelConfig.temperature;
    const maxTokens = config.defaultModelConfig.maxTokens;
    
    // Prepare request body
    const requestBody: Record<string, unknown> = {
      model: modelId,
      messages: [
        { role: 'system', content: 'You are a helpful assistant.' },
        { role: 'user', content: task }
      ],
      temperature: temperature,
      max_tokens: maxTokens,
    };
    
    // Add draft model if provided
    if (draftModelId) {
      logger.info(`Using speculative decoding with draft model ${draftModelId} for LM Studio model ${modelId}`);
      requestBody.draft_model = draftModelId;
    }
    
    logger.debug(`LM Studio API call for ${modelId} using temperature: ${temperature}, maxTokens: ${maxTokens}`);
    
    const response = await axios.post<LmStudioResponse>(
      `${config.lmStudioEndpoint}/chat/completions`,
      requestBody,
      {
        signal: controller.signal,
        headers: {
          'Content-Type': 'application/json',
        },
      }
    );
    
    clearTimeout(timeoutId);
    
    if (response.status === 200 && response.data.choices && response.data.choices.length > 0) {
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
        text: response.data.choices[0].message.content,
        usage: response.data.usage,
      };
      
      // Add speculative decoding stats if available
      if (response.data.stats) {
        result.stats = {
          tokens_per_second: response.data.stats.tokens_per_second,
          draft_model: response.data.stats.draft_model,
          accepted_draft_tokens_count: response.data.stats.accepted_draft_tokens_count,
          total_draft_tokens_count: response.data.stats.total_draft_tokens_count
        };
        
        // Log speculative decoding stats if available
        if (response.data.stats.draft_model && response.data.stats.accepted_draft_tokens_count) {
          logger.info(`Speculative decoding stats for LM Studio model ${modelId}:`);
          logger.info(` - Draft model: ${response.data.stats.draft_model}`);
          logger.info(` - Total draft tokens: ${response.data.stats.total_draft_tokens_count}`);
          logger.info(` - Accepted draft tokens: ${response.data.stats.accepted_draft_tokens_count}`);
          logger.info(` - Tokens per second: ${response.data.stats.tokens_per_second}`);
          logger.info(` - Acceptance rate: ${(response.data.stats.accepted_draft_tokens_count / 
            (response.data.stats.total_draft_tokens_count || 1) * 100).toFixed(1)}%`);
        }
      }
      
      return result;
    } else {
      return { success: false };
    }
  } catch (error) {
    logger.error(`Error calling LM Studio API for model ${modelId}:`, error);
    return { success: false };
  }
}