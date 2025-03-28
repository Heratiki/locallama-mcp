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
}

/**
 * Call Ollama API
 */
export async function callOllamaApi(
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
    
    // Use temperature and other parameters from the default model config
    const temperature = config.defaultModelConfig.temperature;
    const maxTokens = config.defaultModelConfig.maxTokens;
    
    logger.debug(`Ollama API call for ${modelId} using temperature: ${temperature}, maxTokens: ${maxTokens}`);
    
    const response = await axios.post<OllamaResponse>(
      `${config.ollamaEndpoint}/chat`,
      {
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
      },
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
      
      return {
        success: true,
        text: response.data.message.content,
        usage: {
          prompt_tokens: promptTokens,
          completion_tokens: completionTokens,
        },
      };
    } else {
      return { success: false };
    }
  } catch (error) {
    logger.error(`Error calling Ollama API for model ${modelId}:`, error);
    return { success: false };
  }
}