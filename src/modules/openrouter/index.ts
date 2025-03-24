import axios, { AxiosError } from 'axios';
import fs from 'fs/promises';
import path from 'path';
import { mkdir } from 'fs/promises';
import { config } from '../../config/index.js';
import { logger } from '../../utils/logger.js';
import { Model } from '../../types/index.js';
import {
  OpenRouterModel,
  OpenRouterModelsResponse,
  OpenRouterErrorResponse,
  OpenRouterModelTracking,
  PromptingStrategy,
  OpenRouterErrorType
} from './types.js';

// Add type definitions for OpenRouter API responses
interface OpenRouterChatCompletion {
  choices: Array<{
    message: {
      content: string;
    };
  }>;
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
  };
}

// File path for storing OpenRouter model tracking data
const TRACKING_FILE_PATH = path.join(config.rootDir, 'openrouter-models.json');

// Default prompting strategies for different model families
const DEFAULT_PROMPTING_STRATEGIES: Record<string, Partial<PromptingStrategy>> = {
  'openai': {
    systemPrompt: 'You are a helpful assistant.',
    useChat: true
  },
  'anthropic': {
    systemPrompt: 'You are Claude, a helpful AI assistant.',
    useChat: true
  },
  'google': {
    systemPrompt: 'You are a helpful AI assistant.',
    useChat: true
  },
  'mistral': {
    systemPrompt: 'You are a helpful AI assistant.',
    useChat: true
  },
  'default': {
    systemPrompt: 'You are a helpful AI assistant.',
    useChat: true
  }
};

/**
 * OpenRouter Module
 * 
 * This module is responsible for:
 * - Querying OpenRouter for available models
 * - Tracking free models
 * - Handling errors from OpenRouter
 * - Determining the best prompting strategy for each model
 */
export const openRouterModule = {
  // In-memory cache of model tracking data
  modelTracking: {
    models: {},
    lastUpdated: '',
    freeModels: []
  } as OpenRouterModelTracking,

  // In-memory cache of prompting strategies
  promptingStrategies: {} as Record<string, PromptingStrategy>,

  /**
   * Initialize the OpenRouter module
   * Loads tracking data from disk if available
   * @param forceUpdate Optional flag to force update of models regardless of timestamp
   */
  async initialize(forceUpdate = false): Promise<void> {
    logger.debug('Initializing OpenRouter module');
    
    try {
      // Check if API key is configured
      if (!config.openRouterApiKey) {
        logger.warn('OpenRouter API key not configured, free models will not be available');
        return;
      }
      
      // Ensure the directory exists for tracking files
      try {
        await mkdir(path.dirname(TRACKING_FILE_PATH), { recursive: true });
        logger.debug(`Ensured directory exists: ${path.dirname(TRACKING_FILE_PATH)}`);
      } catch {
        logger.debug('Unknown error during directory check');
      }
      
      // Load tracking data from disk if available
      try {
        const data = await fs.readFile(TRACKING_FILE_PATH, 'utf8');
        this.modelTracking = JSON.parse(data) as OpenRouterModelTracking;
        logger.debug(`Loaded OpenRouter tracking data with ${Object.keys(this.modelTracking.models).length} models and ${this.modelTracking.freeModels.length} free models`);
      } catch {
        logger.debug('No existing OpenRouter tracking data found, will create new tracking data');
        this.modelTracking = {
          models: {},
          lastUpdated: new Date().toISOString(),
          freeModels: []
        };
      }
      
      // Load prompting strategies from disk if available
      try {
        const strategiesPath = path.join(config.rootDir, 'openrouter-strategies.json');
        const data = await fs.readFile(strategiesPath, 'utf8');
        this.promptingStrategies = JSON.parse(data) as Record<string, PromptingStrategy>;
        logger.debug(`Loaded OpenRouter prompting strategies for ${Object.keys(this.promptingStrategies).length} models`);
      } catch {
        logger.debug('No existing OpenRouter prompting strategies found');
        this.promptingStrategies = {};
      }
      
      // Check if we need to update the models
      if (forceUpdate) {
        logger.info('Forcing update of OpenRouter models...');
        await this.updateModels();
      } else {
        const now = new Date();
        const lastUpdated = new Date(this.modelTracking.lastUpdated);
        const hoursSinceLastUpdate = (now.getTime() - lastUpdated.getTime()) / (1000 * 60 * 60);
        
        if (hoursSinceLastUpdate > 24) {
          logger.info('OpenRouter models data is more than 24 hours old, updating...');
          await this.updateModels();
        } else {
          logger.debug(`OpenRouter models data is ${hoursSinceLastUpdate.toFixed(1)} hours old, no update needed`);
        }
      }
    } catch {
      logger.error('Error initializing OpenRouter module');
    }
  },

  /**
   * Update the list of available models from OpenRouter
   */
  async updateModels(): Promise<void> {
    logger.debug('Updating OpenRouter models');
    
    try {
      // Check if API key is configured
      if (!config.openRouterApiKey) {
        logger.warn('OpenRouter API key not configured, free models will not be available');
        return;
      }
      
      // Query OpenRouter for available models
      logger.debug('Making request to OpenRouter API...');
      const response = await axios.get<OpenRouterModelsResponse>('https://openrouter.ai/api/v1/models', {
        headers: {
          'Authorization': `Bearer ${config.openRouterApiKey}`,
          'HTTP-Referer': 'https://locallama-mcp.local', // Required by OpenRouter
          'X-Title': 'LocalLama MCP'
        }
      });
      
      logger.debug(`OpenRouter API response status: ${response.status}`);
      
      // Process the response
      if (response.data && Array.isArray(response.data.data)) {
        const models = response.data.data;
        logger.debug(`Received ${models.length} models from OpenRouter API`);
        
        const freeModels: string[] = [];
        const updatedModels: Record<string, OpenRouterModel> = {};
        
        for (const model of models) {
          // Check if the model is free - using a more robust approach
          const promptPrice = parseFloat(String(model.pricing?.prompt || "0"));
          const completionPrice = parseFloat(String(model.pricing?.completion || "0"));
          
          // Adding epsilon comparison for floating point precision
          const EPSILON = 0.00000000001; // Small threshold to handle floating-point precision
          const isFree = promptPrice < EPSILON && completionPrice < EPSILON;
          
          // If the model is free, add it to the list
          if (isFree) {
            freeModels.push(model.id);
            logger.debug(`Found free model: ${model.id} (${model.name || 'Unnamed'})`);
          }
          
          // Create or update the model in our tracking
          const existingModel = this.modelTracking.models[model.id];
          
          updatedModels[model.id] = {
            id: model.id,
            name: model.name || model.id,
            provider: this.getProviderFromModelId(model.id),
            isFree,
            contextWindow: model.context_length || 4096,
            capabilities: {
              chat: model.features?.chat || false,
              completion: model.features?.completion || false,
              vision: model.features?.vision || false
            },
            costPerToken: {
              prompt: model.pricing?.prompt || 0,
              completion: model.pricing?.completion || 0
            },
            promptingStrategy: existingModel?.promptingStrategy || {
              systemPrompt: this.getDefaultPromptingStrategy(model.id).systemPrompt,
              userPrompt: this.getDefaultPromptingStrategy(model.id).userPrompt,
              assistantPrompt: this.getDefaultPromptingStrategy(model.id).assistantPrompt,
              useChat: this.getDefaultPromptingStrategy(model.id).useChat || true
            },
            lastUpdated: new Date().toISOString(),
            version: existingModel?.version || '1.0'
          };
        }
        
        // Update the tracking data
        this.modelTracking = {
          models: updatedModels,
          lastUpdated: new Date().toISOString(),
          freeModels
        };
        
        // Save the tracking data to disk
        await this.saveTrackingData();
        
        logger.info(`Updated OpenRouter models: ${Object.keys(updatedModels).length} total, ${freeModels.length} free`);
        
        if (freeModels.length === 0) {
          logger.warn('No free models found from OpenRouter API. This might indicate an issue with the API response or pricing data.');
        }
      } else {
        logger.warn('Invalid response from OpenRouter API:', response.data);
      }
    } catch {
      logger.error('Error updating OpenRouter models');
      this.handleOpenRouterError(new Error('Unknown error'));
    }
  },

  /**
   * Get the provider from a model ID
   */
  getProviderFromModelId(modelId: string): string {
    if (modelId.includes('openai')) return 'openai';
    if (modelId.includes('anthropic')) return 'anthropic';
    if (modelId.includes('claude')) return 'anthropic';
    if (modelId.includes('google')) return 'google';
    if (modelId.includes('gemini')) return 'google';
    if (modelId.includes('mistral')) return 'mistral';
    if (modelId.includes('meta')) return 'meta';
    if (modelId.includes('llama')) return 'meta';
    return 'unknown';
  },

  /**
   * Get the default prompting strategy for a model
   */
  getDefaultPromptingStrategy(modelId: string): {
    systemPrompt?: string;
    userPrompt?: string;
    assistantPrompt?: string;
    useChat: boolean;
  } {
    const provider = this.getProviderFromModelId(modelId);
    const defaultStrategy = DEFAULT_PROMPTING_STRATEGIES[provider] || DEFAULT_PROMPTING_STRATEGIES.default;
    
    return {
      systemPrompt: defaultStrategy.systemPrompt,
      userPrompt: defaultStrategy.userPrompt,
      assistantPrompt: defaultStrategy.assistantPrompt,
      useChat: defaultStrategy.useChat || true
    };
  },

  /**
   * Save the tracking data to disk
   */
  async saveTrackingData(): Promise<void> {
    try {
      logger.debug(`Saving tracking data to: ${TRACKING_FILE_PATH}`);
      logger.debug(`Tracking data contains ${Object.keys(this.modelTracking.models).length} models and ${this.modelTracking.freeModels.length} free models`);
      
      // Ensure the directory exists
      try {
        await mkdir(path.dirname(TRACKING_FILE_PATH), { recursive: true });
      } catch {
        logger.debug('Unknown error during directory check');
      }
      
      await fs.writeFile(TRACKING_FILE_PATH, JSON.stringify(this.modelTracking, null, 2));
      logger.debug('Successfully saved OpenRouter tracking data to disk');
    } catch (error) {
      if (error instanceof Error) {
        logger.error(`Error saving OpenRouter tracking data to ${TRACKING_FILE_PATH}:`, error);
        logger.error(`Error details: ${error.message}`);
      } else {
        logger.error('Unknown error occurred');
      }
    }
  },

  /**
   * Save the prompting strategies to disk
   */
  async savePromptingStrategies(): Promise<void> {
    try {
      const strategiesPath = path.join(config.rootDir, 'openrouter-strategies.json');
      logger.debug(`Saving prompting strategies to: ${strategiesPath}`);
      logger.debug(`Prompting strategies contains data for ${Object.keys(this.promptingStrategies).length} models`);
      
      // Ensure the directory exists
      try {
        await mkdir(path.dirname(strategiesPath), { recursive: true });
      } catch (error) {
        if (error instanceof Error) {
          logger.debug(`Directory check during save strategies: ${error.message}`);
        } else {
          logger.debug('Unknown error during directory check');
        }
      }
      
      await fs.writeFile(strategiesPath, JSON.stringify(this.promptingStrategies, null, 2));
      logger.debug('Successfully saved OpenRouter prompting strategies to disk');
    } catch (error) {
      if (error instanceof Error) {
        logger.error(`Error saving OpenRouter prompting strategies to ${path.join(config.rootDir, 'openrouter-strategies.json')}:`, error);
        logger.error(`Error details: ${error.message}`);
      } else {
        logger.error('Unknown error occurred');
      }
    }
  },

  /**
   * Get all available models from OpenRouter
   */
  async getAvailableModels(): Promise<Model[]> {
    logger.debug('Getting available models from OpenRouter');
    
    try {
      // Check if API key is configured
      if (!config.openRouterApiKey) {
        logger.warn('OpenRouter API key not configured, free models will not be available');
        return [];
      }
      
      // Check if we need to update the models
      const now = new Date();
      const lastUpdated = new Date(this.modelTracking.lastUpdated);
      const hoursSinceLastUpdate = (now.getTime() - lastUpdated.getTime()) / (1000 * 60 * 60);
      
      if (hoursSinceLastUpdate > 24) {
        logger.info('OpenRouter models data is more than 24 hours old, updating...');
        await this.updateModels();
      }
      
      // Convert OpenRouter models to the common Model format
      const models: Model[] = [];
      
      for (const [modelId, model] of Object.entries(this.modelTracking.models)) {
        models.push({
          id: modelId,
          name: model.name,
          provider: 'openrouter',
          capabilities: {
            chat: model.capabilities.chat,
            completion: model.capabilities.completion
          },
          costPerToken: {
            prompt: model.costPerToken.prompt,
            completion: model.costPerToken.completion
          },
          contextWindow: model.contextWindow
        });
      }
      
      return models;
    } catch (error) {
      this.handleOpenRouterError(error as Error);
      return [];
    }
  },

  /**
   * Get free models from OpenRouter
   * @param forceUpdate Optional flag to force update of models if no free models are found
   */
  async getFreeModels(forceUpdate = false): Promise<Model[]> {
    logger.debug('Getting free models from OpenRouter');
    
    try {
      // Check if API key is configured
      if (!config.openRouterApiKey) {
        logger.warn('OpenRouter API key not configured, free models will not be available');
        return [];
      }
      
      // Get all models
      const allModels = await this.getAvailableModels();
      
      // Filter for free models
      const freeModels = allModels.filter(model => {
        return this.modelTracking.freeModels.includes(model.id);
      });
      
      logger.debug(`Found ${freeModels.length} free models out of ${allModels.length} total models`);
      
      // If no free models are found and forceUpdate is true, force an update
      if (freeModels.length === 0 && forceUpdate) {
        logger.info('No free models found, forcing update...');
        await this.updateModels();
        
        // Try again after update
        const updatedAllModels = await this.getAvailableModels();
        const updatedFreeModels = updatedAllModels.filter(model => {
          return this.modelTracking.freeModels.includes(model.id);
        });
        
        logger.info(`After forced update: Found ${updatedFreeModels.length} free models out of ${updatedAllModels.length} total models`);
        return updatedFreeModels;
      }
      
      return freeModels;
    } catch {
      logger.error('Error getting free models from OpenRouter:');
      this.handleOpenRouterError(new Error('Unknown error'));
      return [];
    }
  },

  /**
   * Update the prompting strategy for a model based on benchmark results
   */
  async updatePromptingStrategy(
    modelId: string, 
    strategy: Partial<PromptingStrategy>,
    successRate: number,
    qualityScore: number
  ): Promise<void> {
    logger.debug(`Updating prompting strategy for model ${modelId}`);
    
    try {
      // Get the existing strategy or create a new one
      const existingStrategy = this.promptingStrategies[modelId] || {
        modelId,
        useChat: true,
        successRate: 0,
        qualityScore: 0,
        lastUpdated: new Date().toISOString()
      };
      
      // Only update if the new strategy is better
      if (successRate > existingStrategy.successRate || 
          (successRate === existingStrategy.successRate && qualityScore > existingStrategy.qualityScore)) {
        
        // Update the strategy
        this.promptingStrategies[modelId] = {
          ...existingStrategy,
          ...strategy,
          successRate,
          qualityScore,
          lastUpdated: new Date().toISOString()
        };
        
        // Update the model's prompting strategy
        if (this.modelTracking.models[modelId]) {
          this.modelTracking.models[modelId].promptingStrategy = {
            systemPrompt: strategy.systemPrompt || existingStrategy.systemPrompt,
            userPrompt: strategy.userPrompt || existingStrategy.userPrompt,
            assistantPrompt: strategy.assistantPrompt || existingStrategy.assistantPrompt,
            useChat: strategy.useChat !== undefined ? strategy.useChat : existingStrategy.useChat
          };
          
          // Save the tracking data
          await this.saveTrackingData();
        }
        
        // Save the prompting strategies
        await this.savePromptingStrategies();
        
        logger.info(`Updated prompting strategy for model ${modelId} with success rate ${successRate} and quality score ${qualityScore}`);
      } else {
        logger.debug(`Existing strategy for model ${modelId} is better (${existingStrategy.successRate}/${existingStrategy.qualityScore} vs ${successRate}/${qualityScore})`);
      }
    } catch (error) {
      if (error instanceof Error) {
        logger.error(`Error updating prompting strategy for model ${modelId}:`, error);
      } else {
        logger.error('Unknown error occurred');
      }
    }
  },

  /**
   * Get the best prompting strategy for a model
   */
  getPromptingStrategy(modelId: string): PromptingStrategy | undefined {
    return this.promptingStrategies[modelId];
  },

  /**
   * Handle errors from OpenRouter
   */
  handleOpenRouterError(error: Error): OpenRouterErrorType {
    if (axios.isAxiosError(error)) {
      const axiosError = error as AxiosError<OpenRouterErrorResponse>;
      
      // Process response members safely using type guards
      if (axiosError.response?.data?.error) {
        const errorData = axiosError.response.data.error;
        
        // Handle specific error types
        if (errorData.type === 'rate_limit_exceeded') {
          logger.warn('OpenRouter rate limit exceeded:', errorData.message);
          return OpenRouterErrorType.RATE_LIMIT;
        } else if (errorData.type === 'authentication_error') {
          logger.error('OpenRouter authentication error:', errorData.message);
          return OpenRouterErrorType.AUTHENTICATION;
        } else if (errorData.type === 'invalid_request_error') {
          logger.error('OpenRouter invalid request error:', errorData.message);
          return OpenRouterErrorType.INVALID_REQUEST;
        } else if (errorData.message.includes('context length')) {
          logger.warn('OpenRouter context length exceeded:', errorData.message);
          return OpenRouterErrorType.CONTEXT_LENGTH_EXCEEDED;
        } else if (errorData.message.includes('model not found')) {
          logger.warn('OpenRouter model not found:', errorData.message);
          return OpenRouterErrorType.MODEL_NOT_FOUND;
        } else {
          logger.error('OpenRouter error:', errorData.message);
          return OpenRouterErrorType.SERVER_ERROR;
        }
      } else if (axiosError.response && axiosError.response.status === 429) {
        logger.warn('OpenRouter rate limit exceeded');
        return OpenRouterErrorType.RATE_LIMIT;
      } else if (axiosError.response && (axiosError.response.status === 401 || axiosError.response.status === 403)) {
        logger.error('OpenRouter authentication error');
        return OpenRouterErrorType.AUTHENTICATION;
      } else if (axiosError.response && axiosError.response.status === 400) {
        logger.error('OpenRouter invalid request error');
        return OpenRouterErrorType.INVALID_REQUEST;
      } else if (axiosError.response && axiosError.response.status === 404) {
        logger.warn('OpenRouter resource not found');
        return OpenRouterErrorType.MODEL_NOT_FOUND;
      } else if (axiosError.response && axiosError.response.status >= 500) {
        logger.error('OpenRouter server error');
        return OpenRouterErrorType.SERVER_ERROR;
      }
    }
    
    logger.error('Unknown OpenRouter error');
    return OpenRouterErrorType.UNKNOWN;
  },

  /**
   * Call OpenRouter API with a task
   */
  async callOpenRouterApi(
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
    error?: OpenRouterErrorType;
  }> {
    logger.debug(`Calling OpenRouter API for model ${modelId}`);
    
    try {
      // Check if API key is configured
      if (!config.openRouterApiKey) {
        logger.warn('OpenRouter API key not configured, free models will not be available');
        return { success: false, error: OpenRouterErrorType.AUTHENTICATION };
      }
      
      // Get the model information
      const model = this.modelTracking.models[modelId];
      if (!model) {
        logger.warn(`Model ${modelId} not found in OpenRouter tracking data`);
        return { success: false, error: OpenRouterErrorType.MODEL_NOT_FOUND };
      }
      
      // Get the prompting strategy
      const strategy = this.getPromptingStrategy(modelId) || {
        modelId,
        systemPrompt: 'You are a helpful assistant.',
        useChat: true,
        successRate: 0,
        qualityScore: 0,
        lastUpdated: new Date().toISOString()
      };
      
      // Create the request
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeout);
      
      // Prepare the messages based on the prompting strategy
      const messages = [];
      
      if (strategy.systemPrompt) {
        messages.push({ role: 'system', content: strategy.systemPrompt });
      }
      
      if (strategy.userPrompt) {
        messages.push({ role: 'user', content: strategy.userPrompt.replace('{{task}}', task) });
      } else {
        messages.push({ role: 'user', content: task });
      }
      
      // Make the request
      const response = await axios.post<OpenRouterChatCompletion>(
        'https://openrouter.ai/api/v1/chat/completions',
        {
          model: modelId,
          messages,
          temperature: 0.7,
          max_tokens: 1000,
        },
        {
          signal: controller.signal,
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${config.openRouterApiKey}`,
            'HTTP-Referer': 'https://locallama-mcp.local', // Required by OpenRouter
            'X-Title': 'LocalLama MCP'
          },
        }
      );
      
      clearTimeout(timeoutId);
      
      // Process the response
      if (
        response.status === 200 &&
        response.data &&
        Array.isArray(response.data.choices) &&
        response.data.choices.length > 0
      ) {
        const firstChoice = response.data.choices[0] as { message: { content: string } };
        if (
          firstChoice.message &&
          typeof firstChoice.message.content === 'string'
        ) {
          return {
            success: true,
            text: firstChoice.message.content,
            usage: response.data.usage &&
              typeof response.data.usage === 'object' &&
              'prompt_tokens' in response.data.usage &&
              'completion_tokens' in response.data.usage
              ? (response.data.usage as { prompt_tokens: number; completion_tokens: number })
              : { prompt_tokens: 0, completion_tokens: 0 },
          };
        }
      }
      logger.warn('Invalid response from OpenRouter API:', response.data);
      return { success: false, error: OpenRouterErrorType.INVALID_REQUEST };
    } catch {
      logger.error('Unknown OpenRouter error');
      this.handleOpenRouterError(new Error('Unknown error'));
      return { success: false, error: OpenRouterErrorType.UNKNOWN };
    }
  },

  /**
   * Benchmark a model with different prompting strategies
   */
  async benchmarkPromptingStrategies(
    modelId: string,
    task: string,
    timeout: number
  ): Promise<{
    bestStrategy: PromptingStrategy;
    success: boolean;
    text?: string;
    usage?: {
      prompt_tokens: number;
      completion_tokens: number;
    };
  }> {
    logger.debug(`Benchmarking prompting strategies for model ${modelId}`);
    
    try {
      // Check if API key is configured
      if (!config.openRouterApiKey) {
        logger.warn('OpenRouter API key not configured, free models will not be available');
        return { 
          bestStrategy: {
            modelId,
            systemPrompt: 'You are a helpful assistant.',
            useChat: true,
            successRate: 0,
            qualityScore: 0,
            lastUpdated: new Date().toISOString()
          },
          success: false
        };
      }
      
      // Get the model information
      const model = this.modelTracking.models[modelId];
      if (!model) {
        logger.warn(`Model ${modelId} not found in OpenRouter tracking data`);
        return { 
          bestStrategy: {
            modelId,
            systemPrompt: 'You are a helpful assistant.',
            useChat: true,
            successRate: 0,
            qualityScore: 0,
            lastUpdated: new Date().toISOString()
          },
          success: false
        };
      }
      
      // Define different prompting strategies to try
      const strategiesToTry: Partial<PromptingStrategy>[] = [
        // Default strategy
        {
          systemPrompt: 'You are a helpful assistant.',
          useChat: true
        },
        // Code-focused strategy
        {
          systemPrompt: 'You are a helpful coding assistant. Provide clear, concise code solutions.',
          useChat: true
        },
        // Detailed strategy
        {
          systemPrompt: 'You are a helpful assistant. Provide detailed, step-by-step explanations.',
          useChat: true
        },
        // Provider-specific strategy
        DEFAULT_PROMPTING_STRATEGIES[this.getProviderFromModelId(modelId)] || DEFAULT_PROMPTING_STRATEGIES.default
      ];
      
      // Try each strategy
      let bestStrategy: PromptingStrategy | null = null;
      let bestResponse: { success: boolean; text?: string; usage?: { prompt_tokens: number; completion_tokens: number } } | null = null;
      let bestQualityScore = 0;
      
      for (const strategy of strategiesToTry) {
        // Create a temporary strategy
        const tempStrategy: PromptingStrategy = {
          modelId,
          systemPrompt: strategy.systemPrompt,
          userPrompt: strategy.userPrompt,
          assistantPrompt: strategy.assistantPrompt,
          useChat: strategy.useChat !== undefined ? strategy.useChat : true,
          successRate: 0,
          qualityScore: 0,
          lastUpdated: new Date().toISOString()
        };
        
        // Try the strategy
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), timeout);
        
        try {
          // Prepare the messages based on the prompting strategy
          const messages = [];
          
          if (tempStrategy.systemPrompt) {
            messages.push({ role: 'system', content: tempStrategy.systemPrompt });
          }
          
          if (tempStrategy.userPrompt) {
            messages.push({ role: 'user', content: tempStrategy.userPrompt.replace('{{task}}', task) });
          } else {
            messages.push({ role: 'user', content: task });
          }
          
          // Make the request
          const response = await axios.post<OpenRouterChatCompletion>(
            'https://openrouter.ai/api/v1/chat/completions',
            {
              model: modelId,
              messages,
              temperature: 0.7,
              max_tokens: 1000,
            },
            {
              signal: controller.signal,
              headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${config.openRouterApiKey}`,
                'HTTP-Referer': 'https://locallama-mcp.local', // Required by OpenRouter
                'X-Title': 'LocalLama MCP'
              },
            }
          );
          
          clearTimeout(timeoutId);
          
          // Process the response
          if (response.status === 200 && response.data.choices && response.data.choices.length > 0) {
            const text = response.data.choices[0].message.content;
            const qualityScore = this.evaluateQuality(task, text);
            
            // Update the strategy with the results
            tempStrategy.successRate = 1;
            tempStrategy.qualityScore = qualityScore;
            
            // Check if this is the best strategy so far
            if (qualityScore > bestQualityScore) {
              bestStrategy = tempStrategy;
              bestResponse = {
                success: true,
                text,
                usage: response.data.usage
              };
              bestQualityScore = qualityScore;
            }
          }
        } catch {
          clearTimeout(timeoutId);
          logger.debug(`Error trying prompting strategy for model ${modelId}`);
        }
      }
      
      // If we found a good strategy, update it
      if (bestStrategy && bestQualityScore > 0) {
        await this.updatePromptingStrategy(
          modelId,
          {
            systemPrompt: bestStrategy.systemPrompt,
            userPrompt: bestStrategy.userPrompt,
            assistantPrompt: bestStrategy.assistantPrompt,
            useChat: bestStrategy.useChat
          },
          bestStrategy.successRate,
          bestStrategy.qualityScore
        );
        
        return {
          bestStrategy,
          success: true,
          text: bestResponse?.text,
          usage: bestResponse?.usage
        };
      }
      
      // If we didn't find a good strategy, return the existing one
      const existingStrategy = this.getPromptingStrategy(modelId) || {
        modelId,
        systemPrompt: 'You are a helpful assistant.',
        useChat: true,
        successRate: 0,
        qualityScore: 0,
        lastUpdated: new Date().toISOString()
      };
      
      return {
        bestStrategy: existingStrategy,
        success: false
      };
    } catch {
      logger.error('Unknown error occurred');
      
      return {
        bestStrategy: {
          modelId,
          systemPrompt: 'You are a helpful assistant.',
          useChat: true,
          successRate: 0,
          qualityScore: 0,
          lastUpdated: new Date().toISOString()
        },
        success: false
      };
    }
  },

  /**
   * Evaluate the quality of a response
   * This is a more sophisticated heuristic for code quality
   */
  evaluateQuality(task: string, response: string): number {
    // Check if the response contains code
    const hasCode = response.includes('function') ||
                    response.includes('def ') ||
                    response.includes('class ') ||
                    response.includes('const ') ||
                    response.includes('let ') ||
                    response.includes('var ');
    
    // Check for code blocks (markdown or other formats)
    const hasCodeBlocks = response.includes('```') ||
                          response.includes('    ') || // Indented code
                          response.includes('<code>');
    
    // Check for common programming constructs
    const hasProgrammingConstructs =
      response.includes('return ') ||
      response.includes('if ') ||
      response.includes('for ') ||
      response.includes('while ') ||
      response.includes('import ') ||
      response.includes('require(') ||
      /\w+\s*\([^)]*\)/.test(response); // Function calls
    
    // Check if the response is relevant to the task
    const taskWords = task.toLowerCase().split(/\s+/);
    const relevantWords = taskWords.filter(word =>
      word.length > 4 &&
      !['write', 'implement', 'create', 'design', 'develop', 'build', 'function', 'method', 'class'].includes(word)
    );
    
    let relevanceScore = 0;
    if (relevantWords.length > 0) {
      const matchCount = relevantWords.filter(word =>
        response.toLowerCase().includes(word)
      ).length;
      relevanceScore = matchCount / relevantWords.length;
    }
    
    // Check for explanations
    const hasExplanation =
      response.includes('explanation') ||
      response.includes('explain') ||
      response.includes('works by') ||
      response.includes('algorithm') ||
      response.includes('complexity') ||
      response.includes('time complexity') ||
      response.includes('space complexity') ||
      response.includes('O(');
    
    // Check for code comments
    const hasComments =
      response.includes('//') ||
      response.includes('/*') ||
      response.includes('*/') ||
      response.includes('#') ||
      response.includes('"""') ||
      response.includes("'''");
    
    // Response length relative to task length
    const lengthScore = Math.min(1, response.length / (task.length * 3));
    
    // Combine factors with weighted scoring
    let score = 0;
    
    // For coding tasks, prioritize code quality
    if (task.toLowerCase().includes('code') ||
        task.toLowerCase().includes('function') ||
        task.toLowerCase().includes('algorithm') ||
        task.toLowerCase().includes('implement')) {
      if (hasCode) score += 0.3;
      if (hasCodeBlocks) score += 0.2;
      if (hasProgrammingConstructs) score += 0.2;
      if (hasExplanation) score += 0.1;
      if (hasComments) score += 0.1;
      score += lengthScore * 0.1;
    } else {
      // For non-coding tasks, prioritize relevance and structure
      score += relevanceScore * 0.4;
      score += lengthScore * 0.3;
      
      // Check for structure (paragraphs, bullet points, etc.)
      const hasStructure =
        response.includes('\n\n') ||
        response.includes('- ') ||
        response.includes('1. ') ||
        response.includes('* ');
      
      if (hasStructure) score += 0.3;
    }
    
    // Add relevance score for all tasks
    score = (score + relevanceScore) / 2;
    
    // Penalize very short responses
    if (response.length < 100) {
      score *= (response.length / 100);
    }
    
    return Math.min(1, Math.max(0, score));
  },

  /**
   * Clear tracking data and force an update
   * This is useful for troubleshooting and for forcing a fresh update when needed
   */
  async clearTrackingData(): Promise<void> {
    logger.info('Clearing OpenRouter tracking data...');
    
    // Reset the in-memory tracking data
    this.modelTracking = {
      models: {},
      lastUpdated: '',
      freeModels: []
    };
    
    try {
      // Delete the tracking file if it exists
      try {
        await fs.unlink(TRACKING_FILE_PATH).catch(() => {});
        logger.debug('Deleted tracking file');
      } catch (error) {
        if (error instanceof Error) {
          logger.debug('No tracking file to delete or error deleting file:', error.message);
        } else {
          logger.debug('Unknown error occurred');
        }
      }
      
      // Force an update
      logger.info('Forcing update after clearing tracking data...');
      await this.updateModels();
      
      logger.info('Successfully cleared tracking data and updated models');
    } catch (error) {
      if (error instanceof Error) {
        logger.error('Error clearing tracking data:', error);
        logger.error(`Error details: ${error.message}`);
      } else {
        logger.error('Unknown error occurred');
      }
    }
  },

  /**
   * Execute a task using a specific OpenRouter model
   * @param modelId The ID of the model to use
   * @param task The task to execute
   * @returns The result of the task execution
   */
  async executeTask(modelId: string, task: string): Promise<string> {
    logger.info(`Executing task using OpenRouter model ${modelId}`);
    
    try {
      // Check if API key is configured
      if (!config.openRouterApiKey) {
        throw new Error('OpenRouter API key not configured');
      }
      
      // Determine the execution timeout (default to 3 minutes)
      const timeout = 180000;
      
      // Call the OpenRouter API
      const result = await this.callOpenRouterApi(modelId, task, timeout);
      
      if (!result.success || !result.text) {
        if (result.error) {
          switch (result.error) {
            case OpenRouterErrorType.RATE_LIMIT:
              throw new Error('OpenRouter rate limit exceeded. Please try again later.');
            case OpenRouterErrorType.AUTHENTICATION:
              throw new Error('OpenRouter authentication error. Check your API key.');
            case OpenRouterErrorType.CONTEXT_LENGTH_EXCEEDED:
              throw new Error('Context length exceeded. Please reduce the size of your task.');
            case OpenRouterErrorType.MODEL_NOT_FOUND:
              throw new Error(`Model ${modelId} not found in OpenRouter.`);
            case OpenRouterErrorType.SERVER_ERROR:
              throw new Error('OpenRouter server error. Please try again later.');
            default:
              throw new Error(`Error executing task: ${result.error}`);
          }
        }
        throw new Error('Failed to execute task with OpenRouter');
      }
      
      // Log usage information
      if (result.usage) {
        logger.debug(`OpenRouter usage: ${result.usage.prompt_tokens} prompt tokens, ${result.usage.completion_tokens} completion tokens`);
      }
      
      return result.text;
    } catch (error) {
      if (error instanceof Error) {
        logger.error(`Error executing task with OpenRouter model ${modelId}:`, error);
      } else {
        logger.error('Unknown error occurred');
      }
      throw error;
    }
  }
};