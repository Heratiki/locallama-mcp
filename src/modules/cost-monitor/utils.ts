// Utility functions for cost-monitor module

/**
 * Extract provider name from model ID
 * This is a helper function to categorize models by provider
 */
export function getProviderFromModelId(modelId: string): string {
  if (modelId.includes('openai')) return 'OpenAI';
  if (modelId.includes('anthropic')) return 'Anthropic';
  if (modelId.includes('claude')) return 'Anthropic';
  if (modelId.includes('google')) return 'Google';
  if (modelId.includes('gemini')) return 'Google';
  if (modelId.includes('mistral')) return 'Mistral';
  if (modelId.includes('meta')) return 'Meta';
  if (modelId.includes('llama')) return 'Meta';
  if (modelId.includes('deepseek')) return 'DeepSeek';
  if (modelId.includes('microsoft')) return 'Microsoft';
  if (modelId.includes('phi-3')) return 'Microsoft';
  if (modelId.includes('qwen')) return 'Qwen';
  if (modelId.includes('nvidia')) return 'NVIDIA';
  if (modelId.includes('openchat')) return 'OpenChat';
  return 'Other';
}

/**
 * Model context window sizes (in tokens)
 * These are used as fallbacks when API doesn't provide context window size
 */
export const modelContextWindows: Record<string, number> = {
  // LM Studio models
  'llama3': 8192,
  'llama3-8b': 8192,
  'llama3-70b': 8192,
  'mistral-7b': 8192,
  'mixtral-8x7b': 32768,
  'qwen2.5-coder-3b-instruct': 32768,
  'qwen2.5-7b-instruct': 32768,
  'qwen2.5-72b-instruct': 32768,
  'phi-3-mini-4k': 4096,
  'phi-3-medium-4k': 4096,
  'phi-3-small-8k': 8192,
  'gemma-7b': 8192,
  'gemma-2b': 8192,
  
  // Ollama models
  'llama3:8b': 8192,
  'llama3:70b': 8192,
  'mistral': 8192,
  'mixtral': 32768,
  'qwen2:7b': 32768,
  'qwen2:72b': 32768,
  'phi3:mini': 4096,
  'phi3:small': 8192,
  'gemma:7b': 8192,
  'gemma:2b': 8192,
  
  // Default fallbacks
  'default': 4096
};

/**
 * Calculate token estimates based on credits used
 * This function supports both old and new parameter patterns:
 * 1. Single parameter: creditsUsed (number) - for backward compatibility
 * 2. Three parameters: contextLength, outputLength, model - for detailed estimates
 */
export function calculateTokenEstimates(
  contextLengthOrCredits: number, 
  outputLength: number = 0, 
  model?: string
): { 
  promptTokens: number, 
  completionTokens: number, 
  totalTokens: number,
  promptCost: number,
  completionCost: number,
  totalCost: number,
  estimatedTokensUsed?: number // Added for backward compatibility
} {
  // Default rates (e.g., for GPT-3.5-turbo)
  let promptRate = 0.000001; // $1 per million tokens
  let completionRate = 0.000002; // $2 per million tokens
  
  // Handle old usage pattern (single creditsUsed parameter)
  if (arguments.length === 1) {
    const creditsUsed = contextLengthOrCredits;
    // Estimate tokens based on credits (assuming $1 per million tokens on average)
    const estimatedTokensUsed = creditsUsed * 1000000;
    // Assume 2:1 ratio of prompt:completion tokens
    const promptTokens = Math.round(estimatedTokensUsed * 0.67);
    const completionTokens = Math.round(estimatedTokensUsed * 0.33);
    
    return {
      promptTokens,
      completionTokens,
      totalTokens: promptTokens + completionTokens,
      promptCost: creditsUsed * 0.67,
      completionCost: creditsUsed * 0.33,
      totalCost: creditsUsed,
      estimatedTokensUsed // Include for backward compatibility
    };
  }
  
  // Handle new usage pattern (contextLength, outputLength, model)
  // Adjust rates based on model if provided
  if (model) {
    // Model-specific rate logic here
    if (model.includes('gpt-4')) {
      promptRate = 0.00003; // $30 per million tokens
      completionRate = 0.00006; // $60 per million tokens
    } else if (model.includes('claude-3')) {
      promptRate = 0.000015; // $15 per million tokens
      completionRate = 0.00007; // $70 per million tokens
    }
  }
  
  const promptCost = contextLengthOrCredits * promptRate;
  const completionCost = outputLength * completionRate;
  
  return {
    promptTokens: contextLengthOrCredits,
    completionTokens: outputLength,
    totalTokens: contextLengthOrCredits + outputLength,
    promptCost,
    completionCost,
    totalCost: promptCost + completionCost
  };
}
