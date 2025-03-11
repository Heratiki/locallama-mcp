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
 */
export function calculateTokenEstimates(creditsUsed: number): { promptTokens: number, completionTokens: number, estimatedTokensUsed: number } {
  // Average OpenAI GPT-3.5 cost is ~0.002 USD per 1K tokens
  const averageCostPer1KTokens = 0.002;
  const estimatedTokensUsed = Math.round((creditsUsed / averageCostPer1KTokens) * 1000);
  
  // Assume a typical prompt/completion ratio of 2:1
  const promptTokens = Math.round(estimatedTokensUsed * 0.67); // 2/3 of tokens
  const completionTokens = Math.round(estimatedTokensUsed * 0.33); // 1/3 of tokens
  
  return { promptTokens, completionTokens, estimatedTokensUsed };
}
