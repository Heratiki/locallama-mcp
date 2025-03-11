import { ModelPerformanceProfile } from '../../../types/index.js';

/**
 * Model performance profiles based on benchmark results
 * These profiles help the decision engine make more informed decisions
 * about which models to use for different types of tasks
 */
export const modelProfiles: Record<string, ModelPerformanceProfile> = {
  // Small, efficient models (good for simple tasks)
  'qwen2.5-coder-1.5b-instruct': {
    simpleTaskQuality: 0.85,
    mediumTaskQuality: 0.85,
    complexTaskQuality: 0.85,
    avgResponseTime: 3225, // milliseconds
    successRate: 1.0,
    contextWindow: 32768,
    recommendedComplexityRange: [0, 0.4]
  },
  'tinycodellama-1.3b-5k': {
    simpleTaskQuality: 0.76,
    mediumTaskQuality: 0.81,
    complexTaskQuality: 0.79,
    avgResponseTime: 6087, // milliseconds
    successRate: 1.0,
    contextWindow: 5120,
    recommendedComplexityRange: [0, 0.3]
  },
  'stable-code-instruct-3b': {
    simpleTaskQuality: 0.85,
    mediumTaskQuality: 0.85,
    complexTaskQuality: 0.85,
    avgResponseTime: 4721, // milliseconds
    successRate: 1.0,
    contextWindow: 8192,
    recommendedComplexityRange: [0, 0.5]
  },
  // Medium-sized models (good balance)
  'qwen2.5-coder-3b-instruct': {
    simpleTaskQuality: 0.85,
    mediumTaskQuality: 0.85,
    complexTaskQuality: 0.85,
    avgResponseTime: 6068, // milliseconds
    successRate: 1.0,
    contextWindow: 32768,
    recommendedComplexityRange: [0, 0.7]
  },
  'deepseek-r1-distill-qwen-1.5b': {
    simpleTaskQuality: 0.85,
    mediumTaskQuality: 0.85,
    complexTaskQuality: 0.85,
    avgResponseTime: 7366, // milliseconds
    successRate: 1.0,
    contextWindow: 8192,
    recommendedComplexityRange: [0, 0.5]
  },
  // Larger models (better for complex tasks)
  'qwen2.5-7b-instruct-1m': {
    simpleTaskQuality: 0.85,
    mediumTaskQuality: 0.85,
    complexTaskQuality: 0.85,
    avgResponseTime: 31026, // milliseconds
    successRate: 1.0,
    contextWindow: 32768,
    recommendedComplexityRange: [0.3, 0.8]
  },
  // Paid API models
  'gpt-3.5-turbo': {
    simpleTaskQuality: 0.85,
    mediumTaskQuality: 0.85,
    complexTaskQuality: 0.85,
    avgResponseTime: 3296, // milliseconds
    successRate: 1.0,
    contextWindow: 16385,
    recommendedComplexityRange: [0, 0.7]
  },
  'gpt-4o': {
    simpleTaskQuality: 0.85,
    mediumTaskQuality: 0.85,
    complexTaskQuality: 0.85,
    avgResponseTime: 13202, // milliseconds
    successRate: 1.0,
    contextWindow: 128000,
    recommendedComplexityRange: [0.5, 1.0]
  },
  'claude-3-sonnet-20240229': {
    simpleTaskQuality: 0.85,
    mediumTaskQuality: 0.85,
    complexTaskQuality: 0.85,
    avgResponseTime: 11606, // milliseconds
    successRate: 1.0,
    contextWindow: 200000,
    recommendedComplexityRange: [0.4, 1.0]
  }
};