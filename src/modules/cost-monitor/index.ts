import axios from 'axios';
import { config } from '../../config/index.js';
import { logger } from '../../utils/logger.js';
import { ApiUsage, CostEstimate, Model } from '../../types/index.js';
import { openRouterModule } from '../openrouter/index.js';
import { getProviderFromModelId, modelContextWindows, calculateTokenEstimates } from './utils.js';
import { getOpenRouterUsage, getAvailableModels } from './api.js';
import { tokenManager, TokenUsage, CodeTaskContext } from './tokenManager.js';
import { codeCache, CodePattern } from './codeCache.js';
import { CodeSubtask } from '../decision-engine/types/codeTask.js';
import { CodeSearchEngine, CodeSearchResult } from './codeSearch.js';
import { BM25Searcher, BM25Options } from './bm25.js';

/**
 * Code task optimization result interface
 */
export interface CodeTaskOptimization {
  subtasks: CodeSubtask[];
  cacheMatches: Record<string, { similarity: number; reuseScore: number }>;
  contextOptimization: {
    originalTokens: number;
    optimizedTokens: number;
    tokenSavings: number;
    savingsPercentage: number;
  };
  tokenUsage: TokenUsage;
}

/**
 * Cost & Token Monitoring Module
 * 
 * This module is responsible for:
 * - Monitoring token usage and costs
 * - Estimating costs for tasks
 * - Retrieving available models
 * - Token optimization for code tasks (Phase 2 features)
 */
export const costMonitor = {
  /**
   * Token manager for tracking and optimizing token usage
   */
  tokenManager,
  
  /**
   * Code cache for storing and retrieving code snippets
   */
  codeCache,
  
  /**
   * Get usage statistics for a specific API
   */
  async getApiUsage(api: string): Promise<ApiUsage> {
    logger.debug(`Getting usage for API: ${api}`);
    
    let result: ApiUsage;
    
    // Handle different API types
    switch(api.toLowerCase()) {
      case 'openrouter':
        result = await this.getOpenRouterUsage();
        break;
      case 'lm-studio':
        // LM Studio is local, so cost is always 0
        result = {
          api: 'lm-studio',
          tokenUsage: { prompt: 0, completion: 0, total: 0 },
          cost: { prompt: 0, completion: 0, total: 0 },
          timestamp: new Date().toISOString(),
        };
        break;
      case 'ollama':
        // Ollama is local, so cost is always 0
        result = {
          api: 'ollama',
          tokenUsage: { prompt: 0, completion: 0, total: 0 },
          cost: { prompt: 0, completion: 0, total: 0 },
          timestamp: new Date().toISOString(),
        };
        break;
      default:
        // Default case for unknown APIs
        logger.debug(`No usage statistics available for API: ${api}, returning placeholder data`);
        result = {
          api,
          tokenUsage: { prompt: 1000000, completion: 500000, total: 1500000 },
          cost: { prompt: 0.01, completion: 0.02, total: 0.03 },
          timestamp: new Date().toISOString(),
        };
    }
    
    return result;
  },
  async getOpenRouterUsage(): Promise<ApiUsage> {
    return getOpenRouterUsage();
  },
  async getAvailableModels(): Promise<Model[]> {
    return getAvailableModels();
  },
  /**
   * Get free models from OpenRouter
   * @param forceUpdate Optional flag to force update of models regardless of timestamp
   */
  async getFreeModels(forceUpdate = false): Promise<Model[]> {
    logger.debug(`Getting free models (forceUpdate=${forceUpdate})`);
    
    try {
      // Only try to get OpenRouter models if API key is configured
      if (config.openRouterApiKey) {
        // Initialize the OpenRouter module if needed
        if (Object.keys(openRouterModule.modelTracking.models).length === 0) {
          await openRouterModule.initialize(forceUpdate);
        }
        
        // Get free models from OpenRouter with forceUpdate parameter
        const freeModels = await openRouterModule.getFreeModels(forceUpdate);
        
        // If no free models were found and we didn't already force an update, try clearing tracking data
        if (freeModels.length === 0 && !forceUpdate) {
          logger.info('No free models found, clearing tracking data and forcing update...');
          await openRouterModule.clearTrackingData();
          return await openRouterModule.getFreeModels();
        }
        
        // Log information about free models
        if (freeModels.length > 0) {
          logger.info(`Found ${freeModels.length} free models from OpenRouter`);
          
          // Group models by provider for better logging
          const providerGroups: Record<string, string[]> = {};
          for (const model of freeModels) {
            const provider = getProviderFromModelId(model.id);
            if (!providerGroups[provider]) {
              providerGroups[provider] = [];
            }
            providerGroups[provider].push(model.id);
          }
          
          // Log provider groups
          for (const [provider, models] of Object.entries(providerGroups)) {
            logger.debug(`Provider ${provider}: ${models.length} free models`);
          }
          
          // Log models with large context windows
          const largeContextModels = freeModels.filter(model =>
            model.contextWindow && model.contextWindow >= 32000
          );
          
          if (largeContextModels.length > 0) {
            logger.debug(`Found ${largeContextModels.length} free models with large context windows (32K+):`);
            for (const model of largeContextModels.slice(0, 5)) {
              logger.debug(`- ${model.id} (${model.contextWindow} tokens)`);
            }
            if (largeContextModels.length > 5) {
              logger.debug(`... and ${largeContextModels.length - 5} more large context models`);
            }
          }
        } else {
          logger.warn('No free models found from OpenRouter');
        }
        
        return freeModels;
      }
    } catch (error) {
      logger.warn('Failed to get free models from OpenRouter:', error);
    }
    
    return [];
  },
  
  /**
   * Extract provider name from model ID
   * This is a helper function to categorize models by provider
   */
  getProviderFromModelId(modelId: string): string {
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
  },
  
  /**
   * Estimate the cost for a task
   */
  async estimateCost(params: {
    contextLength: number;
    outputLength?: number;
    model?: string;
  }): Promise<CostEstimate> {
    const { contextLength, outputLength = 0, model } = params;
    logger.debug(`Estimating cost for task with context length ${contextLength} and output length ${outputLength}`);
    
    // For local models, the cost is always 0
    const localCost = {
      prompt: 0,
      completion: 0,
      total: 0,
      currency: 'USD',
    };
    
    // For paid APIs, calculate the cost based on token counts
    // These are example rates for GPT-3.5-turbo
    let promptCost = contextLength * 0.000001;
    let completionCost = outputLength * 0.000002;
    
    // If a specific model was requested, try to get its actual cost
    if (model) {
      // Check if it's an OpenRouter model
      if (config.openRouterApiKey && openRouterModule.modelTracking.models[model]) {
        const openRouterModel = openRouterModule.modelTracking.models[model];
        promptCost = contextLength * openRouterModel.costPerToken.prompt;
        completionCost = outputLength * openRouterModel.costPerToken.completion;
        
        // If it's a free model, set costs to 0
        if (openRouterModel.isFree) {
          promptCost = 0;
          completionCost = 0;
        }
      }
    } else {
      // If no specific model was requested, check if there are free models available
      if (config.openRouterApiKey) {
        const freeModels = await this.getFreeModels();
        if (freeModels.length > 0) {
          // We have free models available, so we can set the paid cost to 0
          // This will make the recommendation favor the free models
          promptCost = 0;
          completionCost = 0;
        }
      }
    }
    
    const paidCost = {
      prompt: promptCost,
      completion: completionCost,
      total: promptCost + completionCost,
      currency: 'USD',
    };
    
    return {
      local: {
        cost: localCost,
        tokenCount: {
          prompt: contextLength,
          completion: outputLength,
          total: contextLength + outputLength,
        },
      },
      paid: {
        cost: paidCost,
        tokenCount: {
          prompt: contextLength,
          completion: outputLength,
          total: contextLength + outputLength,
        },
      },
      recommendation: paidCost.total > config.costThreshold ? 'local' : 'paid',
    };
  },

  /**
   * Count tokens in a string using the specified model
   * 
   * @param text The text to count tokens in
   * @param model The model to use for tokenization
   * @returns Number of tokens
   */
  countTokens(text: string, model: string = 'cl100k_base'): number {
    return this.tokenManager.countTokens(text, model);
  },

  /**
   * Count tokens in chat messages
   * 
   * @param messages Array of chat messages
   * @param model The model to use for tokenization
   * @returns Number of tokens
   */
  countTokensInMessages(
    messages: Array<{ role: string; content: string; name?: string }>,
    model: string = 'gpt-3.5-turbo'
  ): number {
    return this.tokenManager.countTokensInMessages(messages, model);
  },

  /**
   * Calculate token usage with caching awareness
   * 
   * @param prompt Input prompt
   * @param completion Generated completion
   * @param model Model used
   * @returns Token usage statistics
   */
  calculateUsage(prompt: string, completion: string, model: string = 'cl100k_base'): TokenUsage {
    return this.tokenManager.calculateUsage(prompt, completion, model);
  },

  /**
   * Calculate token usage for a code component specifically
   * 
   * @param code Code snippet
   * @param componentName Name of the component (function, class, etc.)
   * @param model Model used
   * @returns Token usage with component tracking
   */
  calculateCodeUsage(code: string, componentName: string, model: string = 'cl100k_base'): TokenUsage {
    return this.tokenManager.calculateCodeUsage(code, componentName, model);
  },

  /**
   * Optimize a code task for token efficiency
   * Main entry point for code-specific token optimization
   * 
   * @param taskDescription The code task description
   * @param codeContext Optional context code (e.g., existing files)
   * @param maxContextWindow Maximum context window size for the model
   * @param model Model to use for tokenization
   * @returns Optimized code task with subtasks and context
   */
  optimizeCodeTask(
    taskDescription: string,
    codeContext: string = "",
    maxContextWindow: number = 8192,
    model: string = 'cl100k_base'
  ): CodeTaskOptimization {
    logger.debug(`Optimizing code task with ${this.tokenManager.countTokens(taskDescription)} task tokens and ${this.tokenManager.countTokens(codeContext)} context tokens`);

    // Step 1: Parse the task and context to extract useful information
    const parsedContext = this.codeCache.analyzeCodeContext(codeContext);
    
    // Step 2: Split the task into smaller subtasks based on token limits
    const subtasks = this.tokenManager.splitCodeTaskByTokens(
      taskDescription,
      parsedContext,
      maxContextWindow,
      model
    );
    
    logger.debug(`Split code task into ${subtasks.length} subtasks`);

    // Step 3: Find matching code snippets in the cache for each subtask
    const cacheMatches = this.codeCache.findBestMatchesForSubtasks(subtasks);
    
    // Convert cache matches to a more serializable format
    const serializedMatches: Record<string, { similarity: number; reuseScore: number }> = {};
    cacheMatches.forEach((match, id) => {
      serializedMatches[id] = {
        similarity: match.similarity,
        reuseScore: match.reuseScore
      };
    });

    // Step 4: Optimize context for the task
    let optimizedContext = codeContext;
    const originalTokens = this.tokenManager.countTokens(codeContext, model);
    
    if (originalTokens > 0) {
      optimizedContext = this.tokenManager.optimizeCodeContext(
        codeContext,
        taskDescription,
        Math.floor(maxContextWindow * 0.7),  // Use up to 70% of context window for context
        model
      );
    }
    
    const optimizedTokens = this.tokenManager.countTokens(optimizedContext, model);
    
    // Calculate token savings
    const tokenSavings = Math.max(0, originalTokens - optimizedTokens);
    const savingsPercentage = originalTokens > 0 
      ? Math.round((tokenSavings / originalTokens) * 100)
      : 0;
    
    logger.debug(`Context optimization: ${originalTokens} → ${optimizedTokens} tokens (${savingsPercentage}% savings)`);

    // Step 5: Calculate token usage for this operation
    const tokenUsage = new TokenUsage();
    tokenUsage.promptTokens = this.tokenManager.countTokens(taskDescription, model);
    
    if (subtasks.length > 0) {
      // Record token usage by component
      subtasks.forEach(subtask => {
        tokenUsage.recordComponentTokens(
          subtask.codeType || 'unknown',
          subtask.tokenCount || this.tokenManager.countTokens(subtask.description, model)
        );
      });
    }

    return {
      subtasks,
      cacheMatches: serializedMatches,
      contextOptimization: {
        originalTokens,
        optimizedTokens,
        tokenSavings,
        savingsPercentage
      },
      tokenUsage
    };
  },

  /**
   * Add code to cache for future reuse
   * 
   * @param code The code to cache
   * @param taskType Type of task
   * @param codeType Type of code structure
   * @param complexity Complexity score
   * @returns Cache key
   */
  cacheCodeSnippet(
    code: string,
    taskType: string = 'general',
    codeType: string = 'other',
    complexity: number = 0.5
  ): string {
    return this.codeCache.add(code, taskType, codeType, complexity);
  },

  /**
   * Find code snippets similar to a given pattern
   * 
   * @param code Code to find similar snippets for
   * @param taskType Optional task type filter
   * @param codeType Optional code type filter
   * @param limit Maximum number of results
   * @returns Array of matching entries
   */
  findSimilarCode(
    code: string,
    taskType?: string,
    codeType?: string,
    limit: number = 5
  ): Array<{ similarity: number; code: string; codeType: string; tokenCount: number }> {
    const pattern: CodePattern = {
      code,
      taskType,
      codeType
    };
    
    const results = this.codeCache.findSimilar(pattern, limit);
    
    return results.map(result => ({
      similarity: result.similarity,
      code: result.entry.code,
      codeType: result.entry.codeType,
      tokenCount: result.entry.tokenCount
    }));
  },

  /**
   * Create an optimized context for a code task with the most relevant parts
   * 
   * @param context Full context code
   * @param taskDescription Task description
   * @param maxTokens Maximum tokens for the optimized context
   * @param model Model for tokenization
   * @returns Optimized context string
   */
  createOptimizedContext(
    context: string,
    taskDescription: string,
    maxTokens: number = 4096,
    model: string = 'cl100k_base'
  ): string {
    return this.codeCache.createOptimizedContext(
      context,
      taskDescription,
      maxTokens,
      model
    );
  },
  
  /**
   * Clear token and code caches
   */
  clearCaches(): void {
    this.tokenManager.clearCache();
    this.codeCache.clear();
    logger.debug("Cleared token and code caches");
  },

  /**
   * Create a new code search engine for semantic search
   * @param workspaceRoot Root directory of the workspace to index
   * @param options Options for the code search engine
   * @returns A new CodeSearchEngine instance
   */
  createCodeSearchEngine(workspaceRoot: string, options?: { excludePatterns?: string[] }): CodeSearchEngine {
    logger.info(`Creating code search engine for workspace: ${workspaceRoot}`);
    return new CodeSearchEngine(workspaceRoot, options);
  }
};

// Export types
export type { TokenUsage, CodeTaskContext, CodeSearchResult, BM25Options };
export { CodeSearchEngine, BM25Searcher };