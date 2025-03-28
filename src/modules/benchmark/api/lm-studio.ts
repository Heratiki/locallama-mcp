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
}

/**
 * Call LM Studio API
 */
export async function callLmStudioApi(
  modelId: string,
  task: string,
  timeout: number
): Promise<{
  success: boolean;
  text?: string;
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
  };
}> {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);
    
    // Use temperature and maxTokens from the default model config
    const temperature = config.defaultModelConfig.temperature;
    const maxTokens = config.defaultModelConfig.maxTokens;
    
    logger.debug(`LM Studio API call for ${modelId} using temperature: ${temperature}, maxTokens: ${maxTokens}`);
    
    const response = await axios.post<LmStudioResponse>(
      `${config.lmStudioEndpoint}/chat/completions`,
      {
        model: modelId,
        messages: [
          { role: 'system', content: 'You are a helpful assistant.' },
          { role: 'user', content: task }
        ],
        temperature: temperature,
        max_tokens: maxTokens,
      },
      {
        signal: controller.signal,
        headers: {
          'Content-Type': 'application/json',
        },
      }
    );
    
    clearTimeout(timeoutId);
    
    if (response.status === 200 && response.data.choices && response.data.choices.length > 0) {
      return {
        success: true,
        text: response.data.choices[0].message.content,
        usage: response.data.usage,
      };
    } else {
      return { success: false };
    }
  } catch (error) {
    logger.error(`Error calling LM Studio API for model ${modelId}:`, error);
    return { success: false };
  }
}