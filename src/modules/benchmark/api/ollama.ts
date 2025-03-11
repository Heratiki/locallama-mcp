import axios from 'axios';
import { config } from '../../../config/index.js';
import { logger } from '../../../utils/logger.js';

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
    
    const response = await axios.post(
      `${config.ollamaEndpoint}/chat`,
      {
        model: modelId,
        messages: [
          { role: 'system', content: 'You are a helpful assistant.' },
          { role: 'user', content: task }
        ],
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