import { logger } from '../../../utils/logger.js';
import { Model } from '../../../types/index.js';

/**
 * Compatible model pairs for speculative decoding
 * Maps target models to appropriate draft models
 */
export const compatibleModelPairs: Record<string, string[]> = {
  // Meta family models
  'meta-llama/llama-3.2-11b-instruct': ['meta-llama/llama-3.2-1b-instruct', 'meta-llama/llama-3.2-3b-instruct'],
  'meta-llama/llama-3.2-70b-instruct': ['meta-llama/llama-3.2-1b-instruct', 'meta-llama/llama-3.2-3b-instruct'],
  'meta-llama/llama-3.1-8b-instruct': ['meta-llama/llama-3.2-1b-instruct'],
  'meta-llama/llama-3-8b-instruct': ['meta-llama/llama-3.2-1b-instruct'],
  'meta-llama/llama-3.3-70b-instruct': ['meta-llama/llama-3.2-1b-instruct', 'meta-llama/llama-3.2-3b-instruct'],
  
  // Mistral family models
  'mistralai/mistral-small-3.1-24b-instruct': ['mistralai/mistral-7b-instruct'],
  'mistralai/mistral-7b-instruct': ['meta-llama/llama-3.2-1b-instruct'],
  
  // Microsoft family models
  'microsoft/phi-3-medium-128k-instruct': ['microsoft/phi-3-mini-128k-instruct'],
  
  // Google family models
  'google/gemma-3-27b-it': ['google/gemma-3-1b-it', 'google/gemma-3-4b-it'],
  'google/gemma-3-12b-it': ['google/gemma-3-1b-it', 'google/gemma-3-4b-it'],
  'google/gemma-3-4b-it': ['google/gemma-3-1b-it'],
  
  // LM Studio models - for local usage
  'llama3': ['llama-3.2-1b-instruct', 'phi-3-mini-128k-instruct'],
  'llama-3.1-70b-instruct': ['llama-3.2-1b-instruct', 'phi-3-mini-128k-instruct'],
  'llama-3.1-405b-instruct': ['llama-3.2-1b-instruct', 'phi-3-mini-128k-instruct']
};

/**
 * Models to avoid using as draft models, typically due to 
 * performance issues or incompatible architectures
 */
export const excludedDraftModels = [
  'gpt-4',
  'claude-',
  'qwen-2.5-72b',
  'google/gemini-2.0-pro'
];

/**
 * Speculative Decoding Service
 * 
 * This service handles configuration and compatibility for speculative decoding,
 * which can significantly accelerate generation by using a smaller model to
 * draft tokens that are then verified by a larger model.
 */
export const speculativeDecodingService = {
  /**
   * Find a compatible draft model for the given target model
   * @param targetModel The model to find a draft for
   * @param availableModels List of all available models to choose from
   * @returns A compatible draft model or null if none found
   */
  findCompatibleDraftModel(targetModel: Model, availableModels: Model[]): Model | null {
    const targetId = targetModel.id;
    
    // Check our predefined compatible pairs first
    let compatibleDraftIds: string[] = [];
    
    // Look for exact matches
    if (compatibleModelPairs[targetId]) {
      compatibleDraftIds = [...compatibleModelPairs[targetId]];
    }
    
    // Look for partial matches (for models not explicitly defined)
    for (const [key, values] of Object.entries(compatibleModelPairs)) {
      if (targetId.includes(key) || key.includes(targetId)) {
        compatibleDraftIds = [...compatibleDraftIds, ...values];
      }
    }
    
    // If no compatible models from our map, try heuristics
    if (compatibleDraftIds.length === 0) {
      // Try to find smaller models from the same family
      const targetFamily = this.getModelFamily(targetId);
      if (targetFamily) {
        // Find small models from the same family
        const smallModels = availableModels.filter(model => 
          this.getModelFamily(model.id) === targetFamily && this.isSmaller(model.id, targetId)
        );
        
        if (smallModels.length > 0) {
          // Sort by size (smallest first)
          smallModels.sort((a, b) => this.estimateModelSize(a.id) - this.estimateModelSize(b.id));
          return smallModels[0];
        }
      }
      
      // Return null if no compatible models found
      logger.debug(`No compatible draft model found for ${targetId}`);
      return null;
    }
    
    // Filter to only models that are available
    const availableDraftModels = availableModels.filter(model => 
      compatibleDraftIds.some(id => model.id.includes(id) || id.includes(model.id))
    );
    
    // Exclude known problematic models
    const viableDraftModels = availableDraftModels.filter(model => 
      !excludedDraftModels.some(excludedId => model.id.includes(excludedId))
    );
    
    if (viableDraftModels.length === 0) {
      logger.debug(`No available draft models found for ${targetId}`);
      return null;
    }
    
    // Sort by size (smallest first) to get the most efficient draft model
    viableDraftModels.sort((a, b) => this.estimateModelSize(a.id) - this.estimateModelSize(b.id));
    
    logger.debug(`Found compatible draft model ${viableDraftModels[0].id} for ${targetId}`);
    return viableDraftModels[0];
  },
  
  /**
   * Get the model family based on model ID
   * @param modelId Model ID to check
   * @returns Model family identifier or null if unknown
   */
  getModelFamily(modelId: string): string | null {
    const id = modelId.toLowerCase();
    
    if (id.includes('llama')) return 'llama';
    if (id.includes('mistral')) return 'mistral';
    if (id.includes('gemma')) return 'gemma';
    if (id.includes('phi')) return 'phi';
    if (id.includes('claude')) return 'claude';
    if (id.includes('gpt')) return 'gpt';
    if (id.includes('qwen')) return 'qwen';
    
    return null;
  },
  
  /**
   * Check if modelA is likely to be smaller than modelB based on IDs
   * @param modelAId First model ID
   * @param modelBId Second model ID 
   * @returns True if modelA is likely smaller than modelB
   */
  isSmaller(modelAId: string, modelBId: string): boolean {
    const sizeA = this.estimateModelSize(modelAId);
    const sizeB = this.estimateModelSize(modelBId);
    
    return sizeA < sizeB;
  },
  
  /**
   * Estimate the rough size of a model based on its ID
   * @param modelId Model ID to analyze
   * @returns Estimated billions of parameters
   */
  estimateModelSize(modelId: string): number {
    const id = modelId.toLowerCase();
    
    // Extract size indicators like "7b", "70b", etc.
    const sizeMatch = id.match(/(\d+)b/);
    if (sizeMatch) {
      return parseInt(sizeMatch[1], 10);
    }
    
    // For models with explicit size markers
    if (id.includes('tiny') || id.includes('mini') || id.includes('small')) return 1;
    if (id.includes('medium')) return 7;
    if (id.includes('large')) return 13;
    if (id.includes('xl')) return 20;
    if (id.includes('xxl')) return 40;
    
    // Default estimates
    if (id.includes('3-1b')) return 1;
    if (id.includes('3-3b')) return 3;
    if (id.includes('3-4b')) return 4;
    if (id.includes('3-8b')) return 8;
    if (id.includes('3-12b')) return 12;
    if (id.includes('3-24b')) return 24;
    
    // Default size
    return 7;
  }
};

export default speculativeDecodingService;