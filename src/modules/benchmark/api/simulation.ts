import { logger } from '../../../utils/logger.js';

/**
 * Simulate OpenAI API (for testing)
 */
export async function simulateOpenAiApi(
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
  // Simulate API call delay
  await new Promise(resolve => setTimeout(resolve, Math.random() * 1000 + 500));
  
  // Simulate success rate
  const success = Math.random() > 0.1; // 90% success rate
  
  if (success) {
    // Estimate token counts
    const promptTokens = Math.ceil(task.length / 4);
    const completionTokens = Math.ceil(promptTokens * 0.8); // Simulate response length
    
    return {
      success: true,
      text: `Simulated response for: ${task.substring(0, 50)}...`,
      usage: {
        prompt_tokens: promptTokens,
        completion_tokens: completionTokens,
      },
    };
  } else {
    return { success: false };
  }
}

/**
 * Simulate generic API (for testing)
 */
export async function simulateGenericApi(
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
  // Simulate API call delay
  await new Promise(resolve => setTimeout(resolve, Math.random() * 1500 + 1000));
  
  // Simulate success rate
  const success = Math.random() > 0.2; // 80% success rate
  
  if (success) {
    // Estimate token counts
    const promptTokens = Math.ceil(task.length / 4);
    const completionTokens = Math.ceil(promptTokens * 0.7); // Simulate response length
    
    return {
      success: true,
      text: `Simulated generic API response for: ${task.substring(0, 50)}...`,
      usage: {
        prompt_tokens: promptTokens,
        completion_tokens: completionTokens,
      },
    };
  } else {
    return { success: false };
  }
}