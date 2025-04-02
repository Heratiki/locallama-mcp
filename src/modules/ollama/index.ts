import axios, { AxiosError } from 'axios';
import fs from 'fs/promises';
import path from 'path';
import { mkdir } from 'fs/promises';
import { config } from '../../config/index.js';
import { logger } from '../../utils/logger.js';
import { Model } from '../../types/index.js';
import {
  OllamaModel,
  OllamaModelTracking,
  PromptingStrategy,
  OllamaErrorType,
  OllamaChatResponse,
  OllamaListModelsResponse
} from './types.js';

// File path for storing Ollama model tracking data
const TRACKING_FILE_PATH = path.join(config.rootDir, 'ollama-models.json');
const STRATEGIES_FILE_PATH = path.join(config.rootDir, 'ollama-strategies.json');

// Default prompting strategies for different model families
const DEFAULT_PROMPTING_STRATEGIES: Record<string, Partial<PromptingStrategy>> = {
  'llama': {
    systemPrompt: 'You are a helpful assistant.',
    useChat: true
  },
  'mistral': {
    systemPrompt: 'You are a helpful assistant.',
    useChat: true
  },
  'mixtral': {
    systemPrompt: 'You are a helpful assistant.',
    useChat: true
  },
  'vicuna': {
    systemPrompt: 'You are a helpful assistant.',
    useChat: true
  },
  'phi': {
    systemPrompt: 'You are a helpful assistant.',
    useChat: true
  },
  'gemma': {
    systemPrompt: 'You are a helpful assistant.',
    useChat: true
  },
  'codegemma': {
    systemPrompt: 'You are a helpful coding assistant.',
    useChat: true
  },
  'codellama': {
    systemPrompt: 'You are a helpful coding assistant.',
    useChat: true
  },
  'wizardcoder': {
    systemPrompt: 'You are a helpful coding assistant.',
    useChat: true
  },
  'default': {
    systemPrompt: 'You are a helpful assistant.',
    useChat: true
  }
};

/**
 * Ollama Module
 * 
 * This module is responsible for:
 * - Querying Ollama for available models
 * - Tracking available models
 * - Handling errors from Ollama
 * - Determining the best prompting strategy for each model
 */
export const ollamaModule = {
  // In-memory cache of model tracking data
  modelTracking: {
    models: {},
    lastUpdated: ''
  } as OllamaModelTracking,

  // In-memory cache of prompting strategies
  promptingStrategies: {} as Record<string, PromptingStrategy>,

  /**
   * Initialize the Ollama module
   * Loads tracking data from disk if available
   * @param forceUpdate Optional flag to force update of models regardless of timestamp
   */
  async initialize(forceUpdate = false): Promise<void> {
    logger.debug('Initializing Ollama module');
    
    try {
      // Check if Ollama endpoint is configured
      if (!config.ollamaEndpoint) {
        logger.warn('Ollama endpoint not configured, local models will not be available');
        return;
      }
      
      // Ensure the directory exists for tracking files
      try {
        await mkdir(path.dirname(TRACKING_FILE_PATH), { recursive: true });
        logger.debug(`Ensured directory exists: ${path.dirname(TRACKING_FILE_PATH)}`);
      } catch (error) {
        logger.debug('Unknown error during directory check');
      }
      
      // Load tracking data from disk if available
      try {
        const data = await fs.readFile(TRACKING_FILE_PATH, 'utf8');
        this.modelTracking = JSON.parse(data) as OllamaModelTracking;
        logger.debug(`Loaded Ollama tracking data with ${Object.keys(this.modelTracking.models).length} models`);
      } catch (error) {
        logger.debug('No existing Ollama tracking data found, will create new tracking data');
        this.modelTracking = {
          models: {},
          lastUpdated: new Date().toISOString()
        };
      }
      
      // Load prompting strategies from disk if available
      try {
        const data = await fs.readFile(STRATEGIES_FILE_PATH, 'utf8');
        this.promptingStrategies = JSON.parse(data) as Record<string, PromptingStrategy>;
        logger.debug(`Loaded Ollama prompting strategies for ${Object.keys(this.promptingStrategies).length} models`);
      } catch (error) {
        logger.debug('No existing Ollama prompting strategies found');
        this.promptingStrategies = {};
      }
      
      // Check if we need to update the models
      if (forceUpdate) {
        logger.info('Forcing update of Ollama models...');
        await this.updateModels();
      } else {
        const now = new Date();
        const lastUpdated = new Date(this.modelTracking.lastUpdated || new Date(0));
        const hoursSinceLastUpdate = (now.getTime() - lastUpdated.getTime()) / (1000 * 60 * 60);
        
        if (hoursSinceLastUpdate > 24) {
          logger.info('Ollama models data is more than 24 hours old, updating...');
          await this.updateModels();
        } else {
          logger.debug(`Ollama models data is ${hoursSinceLastUpdate.toFixed(1)} hours old, no update needed`);
        }
      }
    } catch (error) {
      logger.error('Error initializing Ollama module:', error);
    }
  },

  /**
   * Update the list of available models from Ollama
   */
  async updateModels(): Promise<void> {
    logger.debug('Updating Ollama models');
    
    try {
      // Check if Ollama endpoint is configured
      if (!config.ollamaEndpoint) {
        logger.warn('Ollama endpoint not configured, local models will not be available');
        return;
      }
      
      // Query Ollama for available models
      logger.debug('Making request to Ollama API...');
      const url = `${config.ollamaEndpoint}/api/tags`;
      logger.debug(`Attempting to connect to Ollama at: ${url}`);
      
      const response = await axios.get<OllamaListModelsResponse>(url, {
        timeout: 5000,
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
        }
      });
      
      logger.debug(`Ollama API response status: ${response.status}`);
      
      // Process the response
      if (response.data && Array.isArray(response.data.models)) {
        const ollamaModels = response.data.models;
        logger.debug(`Received ${ollamaModels.length} models from Ollama API`);
        
        const updatedModels: Record<string, OllamaModel> = {};
        
        for (const ollamaModel of ollamaModels) {
          const modelName = ollamaModel.name;
          if (!modelName) continue;
          
          // Create or update the model in our tracking
          const existingModel = this.modelTracking.models[modelName];
          
          // Try to determine context window size and model family
          let contextWindow = 4096; // Default fallback
          let family = 'default';
          let size = '7B'; // Default size
          let quantization: string | undefined;
          
          // Extract information from model name
          const modelNameLower = modelName.toLowerCase();
          
          // Determine family
          if (modelNameLower.includes('llama')) family = 'llama';
          else if (modelNameLower.includes('mistral')) family = 'mistral';
          else if (modelNameLower.includes('mixtral')) family = 'mixtral';
          else if (modelNameLower.includes('vicuna')) family = 'vicuna';
          else if (modelNameLower.includes('phi')) family = 'phi';
          else if (modelNameLower.includes('gemma')) family = 'gemma';
          else if (modelNameLower.includes('codegemma')) family = 'codegemma';
          else if (modelNameLower.includes('codellama')) family = 'codellama';
          else if (modelNameLower.includes('wizardcoder')) family = 'wizardcoder';
          
          // Check for size indicators in the name
          if (modelNameLower.includes('70b')) size = '70B';
          else if (modelNameLower.includes('34b')) size = '34B';
          else if (modelNameLower.includes('33b')) size = '33B';
          else if (modelNameLower.includes('13b')) size = '13B';
          else if (modelNameLower.includes('8b')) size = '8B';
          else if (modelNameLower.includes('7b')) size = '7B';
          else if (modelNameLower.includes('3b')) size = '3B';
          else if (modelNameLower.includes('1b')) size = '1B';
          
          // Check for quantization indicators
          if (modelNameLower.includes('q2')) quantization = 'Q2';
          else if (modelNameLower.includes('q3')) quantization = 'Q3';
          else if (modelNameLower.includes('q4')) quantization = 'Q4';
          else if (modelNameLower.includes('q5')) quantization = 'Q5';
          else if (modelNameLower.includes('q6')) quantization = 'Q6';
          else if (modelNameLower.includes('q8')) quantization = 'Q8';
          
          // Determine context window based on model family and size
          if (family === 'llama' && modelNameLower.includes('llama3')) {
            contextWindow = 8192;
          } else if (family === 'llama' && modelNameLower.includes('llama2')) {
            contextWindow = 4096;
          } else if (family === 'mistral') {
            contextWindow = 8192;
          } else if (family === 'mixtral') {
            contextWindow = 32768;
          } else if (family === 'vicuna') {
            contextWindow = 4096;
          } else if (family === 'phi' && modelNameLower.includes('phi-3')) {
            contextWindow = 8192;
          } else if (family === 'phi') {
            contextWindow = 4096;
          } else if (family === 'gemma') {
            contextWindow = 8192;
          } else if (family === 'codellama') {
            contextWindow = 16384;
          }
          
          // Create the OllamaModel object
          updatedModels[modelName] = {
            id: modelName,
            name: this.formatModelName(modelName),
            provider: 'ollama',
            contextWindow,
            family,
            size,
            quantization,
            capabilities: {
              chat: true,
              completion: true,
              embedding: modelNameLower.includes('embed')
            },
            promptingStrategy: existingModel?.promptingStrategy || {
              systemPrompt: this.getDefaultPromptingStrategy(modelName, family).systemPrompt,
              userPrompt: this.getDefaultPromptingStrategy(modelName, family).userPrompt,
              assistantPrompt: this.getDefaultPromptingStrategy(modelName, family).assistantPrompt,
              useChat: this.getDefaultPromptingStrategy(modelName, family).useChat || true
            },
            lastUpdated: new Date().toISOString(),
            version: existingModel?.version || '1.0',
            fileSize: ollamaModel.size,
            isLocal: true
          };
        }
        
        // Update the tracking data
        this.modelTracking = {
          models: updatedModels,
          lastUpdated: new Date().toISOString()
        };
        
        // Save the tracking data to disk
        await this.saveTrackingData();
        
        logger.info(`Updated Ollama models: ${Object.keys(updatedModels).length} total`);
      } else {
        logger.warn('Invalid response from Ollama API:', response.data);
      }
    } catch (error) {
      logger.error('Error updating Ollama models:', error);
      this.handleOllamaError(error instanceof Error ? error : new Error('Unknown error'));
    }
  },

  /**
   * Format a model name for display
   */
  formatModelName(modelId: string): string {
    // Remove common prefixes and separators
    let name = modelId
      .replace(/:latest$/, '')
      .replace(/^ollama\//, '')
      .replace(/^ollama-/, '')
      .replace(/-/g, ' ')
      .replace(/_/g, ' ');
    
    // Capitalize words
    name = name
      .split(' ')
      .map(word => word.charAt(0).toUpperCase() + word.slice(1))
      .join(' ');
    
    // Special formatting for common LLM names
    name = name
      .replace(/Llama/i, 'Llama')
      .replace(/Mistral/i, 'Mistral')
      .replace(/Mixtral/i, 'Mixtral')
      .replace(/Vicuna/i, 'Vicuna')
      .replace(/Phi/i, 'Phi')
      .replace(/Gemma/i, 'Gemma')
      .replace(/Gpt/i, 'GPT')
      .replace(/Llm/i, 'LLM');
    
    // Add quantization info more cleanly if present
    if (modelId.toLowerCase().includes('q2') || 
        modelId.toLowerCase().includes('q3') || 
        modelId.toLowerCase().includes('q4') || 
        modelId.toLowerCase().includes('q5') || 
        modelId.toLowerCase().includes('q6') || 
        modelId.toLowerCase().includes('q8')) {
      
      if (!name.includes('Q')) {
        // Extract the Q level
        const qMatch = modelId.match(/q([2-8])/i);
        if (qMatch) {
          name += ` (Q${qMatch[1]})`;
        }
      }
    }
    
    return name;
  },

  /**
   * Get the default prompting strategy for a model
   */
  getDefaultPromptingStrategy(modelId: string, family?: string): {
    systemPrompt?: string;
    userPrompt?: string;
    assistantPrompt?: string;
    useChat: boolean;
  } {
    // Determine family if not provided
    if (!family) {
      const modelLower = modelId.toLowerCase();
      if (modelLower.includes('llama')) family = 'llama';
      else if (modelLower.includes('mistral')) family = 'mistral';
      else if (modelLower.includes('mixtral')) family = 'mixtral';
      else if (modelLower.includes('vicuna')) family = 'vicuna';
      else if (modelLower.includes('phi')) family = 'phi';
      else if (modelLower.includes('gemma')) family = 'gemma';
      else if (modelLower.includes('codegemma')) family = 'codegemma';
      else if (modelLower.includes('codellama')) family = 'codellama';
      else if (modelLower.includes('wizardcoder')) family = 'wizardcoder';
      else family = 'default';
    }
    
    // Special case for code models
    if (modelId.toLowerCase().includes('code') && family !== 'codegemma' && family !== 'codellama' && family !== 'wizardcoder') {
      family = 'codellama'; // Use code-specific prompting
    }
    
    const defaultStrategy = DEFAULT_PROMPTING_STRATEGIES[family] || DEFAULT_PROMPTING_STRATEGIES.default;
    
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
      logger.debug(`Tracking data contains ${Object.keys(this.modelTracking.models).length} models`);
      
      // Ensure the directory exists
      try {
        await mkdir(path.dirname(TRACKING_FILE_PATH), { recursive: true });
      } catch (error) {
        logger.debug('Unknown error during directory check');
      }
      
      await fs.writeFile(TRACKING_FILE_PATH, JSON.stringify(this.modelTracking, null, 2));
      logger.debug('Successfully saved Ollama tracking data to disk');
    } catch (error) {
      if (error instanceof Error) {
        logger.error(`Error saving Ollama tracking data to ${TRACKING_FILE_PATH}:`, error);
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
      logger.debug(`Saving prompting strategies to: ${STRATEGIES_FILE_PATH}`);
      logger.debug(`Prompting strategies contains data for ${Object.keys(this.promptingStrategies).length} models`);
      
      // Ensure the directory exists
      try {
        await mkdir(path.dirname(STRATEGIES_FILE_PATH), { recursive: true });
      } catch (error) {
        if (error instanceof Error) {
          logger.debug(`Directory check during save strategies: ${error.message}`);
        } else {
          logger.debug('Unknown error during directory check');
        }
      }
      
      await fs.writeFile(STRATEGIES_FILE_PATH, JSON.stringify(this.promptingStrategies, null, 2));
      logger.debug('Successfully saved Ollama prompting strategies to disk');
    } catch (error) {
      if (error instanceof Error) {
        logger.error(`Error saving Ollama prompting strategies:`, error);
        logger.error(`Error details: ${error.message}`);
      } else {
        logger.error('Unknown error occurred');
      }
    }
  },

  /**
   * Get all available models from Ollama
   */
  async getAvailableModels(): Promise<Model[]> {
    logger.debug('Getting available models from Ollama');
    
    try {
      // Check if Ollama endpoint is configured
      if (!config.ollamaEndpoint) {
        logger.warn('Ollama endpoint not configured, local models will not be available');
        return [];
      }
      
      // Check if we need to update the models
      const now = new Date();
      const lastUpdated = new Date(this.modelTracking.lastUpdated || new Date(0));
      const hoursSinceLastUpdate = (now.getTime() - lastUpdated.getTime()) / (1000 * 60 * 60);
      
      if (hoursSinceLastUpdate > 24) {
        logger.info('Ollama models data is more than 24 hours old, updating...');
        await this.updateModels();
      }
      
      // Convert Ollama models to the common Model format
      const models: Model[] = [];
      
      for (const [modelId, model] of Object.entries(this.modelTracking.models)) {
        models.push({
          id: `ollama:${modelId}`,
          name: model.name,
          provider: 'ollama',
          capabilities: {
            chat: model.capabilities.chat,
            completion: model.capabilities.completion
          },
          costPerToken: {
            prompt: 0,
            completion: 0
          },
          contextWindow: model.contextWindow
        });
      }
      
      return models;
    } catch (error) {
      this.handleOllamaError(error instanceof Error ? error : new Error('Unknown error'));
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
   * Handle errors from Ollama
   */
  handleOllamaError(error: Error): OllamaErrorType {
    if (axios.isAxiosError(error)) {
      const axiosError = error as AxiosError;
      
      if (axiosError.response) {
        const statusCode = axiosError.response.status;
        
        // Handle specific error types based on status code
        if (statusCode === 429) {
          logger.warn('Ollama rate limit exceeded');
          return OllamaErrorType.RATE_LIMIT;
        } else if (statusCode === 401 || statusCode === 403) {
          logger.error('Ollama authentication error');
          return OllamaErrorType.AUTHENTICATION;
        } else if (statusCode === 400) {
          logger.error('Ollama invalid request error');
          return OllamaErrorType.INVALID_REQUEST;
        } else if (statusCode === 404) {
          logger.warn('Ollama resource not found');
          return OllamaErrorType.MODEL_NOT_FOUND;
        } else if (statusCode >= 500) {
          logger.error('Ollama server error');
          return OllamaErrorType.SERVER_ERROR;
        }
      } else if (axiosError.code === 'ECONNREFUSED' || axiosError.code === 'ECONNABORTED') {
        logger.error('Ollama connection refused or timed out');
        return OllamaErrorType.SERVER_ERROR;
      }
    } else if (error.message.includes('context length')) {
      logger.warn('Ollama context length exceeded:', error.message);
      return OllamaErrorType.CONTEXT_LENGTH_EXCEEDED;
    } else if (error.message.includes('model not found')) {
      logger.warn('Ollama model not found:', error.message);
      return OllamaErrorType.MODEL_NOT_FOUND;
    }
    
    logger.error(`Unknown Ollama error: ${error.message}`);
    return OllamaErrorType.UNKNOWN;
  },

  /**
   * Call Ollama API with a task
   */
  async callOllamaApi(
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
    error?: OllamaErrorType;
  }> {
    logger.debug(`Calling Ollama API for model ${modelId}`);
    
    try {
      // Check if Ollama endpoint is configured
      if (!config.ollamaEndpoint) {
        logger.warn('Ollama endpoint not configured, local models will not be available');
        return { success: false, error: OllamaErrorType.SERVER_ERROR };
      }
      
      // Get the model information
      const model = this.modelTracking.models[modelId];
      if (!model) {
        logger.warn(`Model ${modelId} not found in Ollama tracking data`);
        return { success: false, error: OllamaErrorType.MODEL_NOT_FOUND };
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
      
      // Use temperature and maxTokens from the default model config
      const temperature = config.defaultModelConfig.temperature;
      
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
      
      // Create the request body
      const requestBody = {
        model: modelId,
        messages,
        stream: false,
        temperature,
        // Ollama doesn't support max_tokens in the same way as OpenAI
        options: {
          temperature
        }
      };
      
      logger.debug(`Ollama API call for ${modelId} using temperature: ${temperature}`);
      
      // Make the request
      const response = await axios.post<OllamaChatResponse>(
        `${config.ollamaEndpoint}/api/chat`,
        requestBody,
        {
          signal: controller.signal,
          headers: {
            'Content-Type': 'application/json',
          },
        }
      );
      
      clearTimeout(timeoutId);
      
      // Process the response
      if (response.status === 200 && response.data && response.data.message) {
        return {
          success: true,
          text: response.data.message.content,
          usage: response.data.usage || {
            prompt_tokens: 0,
            completion_tokens: 0
          }
        };
      } else {
        logger.warn('Invalid response from Ollama API:', response.data);
        return { success: false, error: OllamaErrorType.INVALID_REQUEST };
      }
    } catch (error) {
      logger.error(`Error calling Ollama API for model ${modelId}:`, error);
      const errorType = this.handleOllamaError(error instanceof Error ? error : new Error('Unknown error'));
      return { success: false, error: errorType };
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
      // Check if Ollama endpoint is configured
      if (!config.ollamaEndpoint) {
        logger.warn('Ollama endpoint not configured, local models will not be available');
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
        logger.warn(`Model ${modelId} not found in Ollama tracking data`);
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
        // Model family specific strategy
        DEFAULT_PROMPTING_STRATEGIES[model.family || 'default'] || DEFAULT_PROMPTING_STRATEGIES.default
      ];
      
      // If this is a code model, add more code-specific strategies
      if (model.family === 'codellama' || model.family === 'codegemma' || model.family === 'wizardcoder' || 
          modelId.toLowerCase().includes('code')) {
        strategiesToTry.push({
          systemPrompt: 'You are a code assistant trained to write clean, efficient, and correct code. Provide working solutions with comments explaining the approach.',
          useChat: true
        });
        strategiesToTry.push({
          systemPrompt: 'You are a programming assistant that specializes in providing high-quality code solutions. Focus on correctness, efficiency, and readability.',
          useChat: true
        });
      }
      
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
        
        try {
          // Try the strategy
          const result = await this.callOllamaApi(modelId, task, timeout);
          
          if (result.success && result.text) {
            const text = result.text;
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
                usage: result.usage
              };
              bestQualityScore = qualityScore;
            }
          }
        } catch (error) {
          logger.debug(`Error trying prompting strategy for model ${modelId}:`, error);
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
    } catch (error) {
      logger.error('Error benchmarking prompting strategies:', error);
      
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
   * This is a heuristic for response quality
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
   * Execute a task using a specific Ollama model
   * @param modelId The ID of the model to use
   * @param task The task to execute
   * @returns The result of the task execution
   */
  async executeTask(modelId: string, task: string): Promise<string> {
    logger.info(`Executing task using Ollama model ${modelId}`);
    
    try {
      // Check if Ollama endpoint is configured
      if (!config.ollamaEndpoint) {
        throw new Error('Ollama endpoint not configured');
      }
      
      // Determine the execution timeout (default to 3 minutes)
      const timeout = 180000;
      
      // Call the Ollama API
      const result = await this.callOllamaApi(modelId, task, timeout);
      
      if (!result.success || !result.text) {
        if (result.error) {
          switch (result.error) {
            case OllamaErrorType.RATE_LIMIT:
              throw new Error('Ollama rate limit exceeded. Please try again later.');
            case OllamaErrorType.AUTHENTICATION:
              throw new Error('Ollama authentication error.');
            case OllamaErrorType.CONTEXT_LENGTH_EXCEEDED:
              throw new Error('Context length exceeded. Please reduce the size of your task.');
            case OllamaErrorType.MODEL_NOT_FOUND:
              throw new Error(`Model ${modelId} not found in Ollama.`);
            case OllamaErrorType.SERVER_ERROR:
              throw new Error('Ollama server error. Please ensure Ollama is running.');
            default:
              throw new Error(`Error executing task: ${result.error}`);
          }
        }
        throw new Error('Failed to execute task with Ollama');
      }
      
      // Log usage information
      if (result.usage) {
        logger.debug(`Ollama usage: ${result.usage.prompt_tokens} prompt tokens, ${result.usage.completion_tokens} completion tokens`);
      }
      
      return result.text;
    } catch (error) {
      if (error instanceof Error) {
        logger.error(`Error executing task with Ollama model ${modelId}:`, error);
      } else {
        logger.error('Unknown error occurred');
      }
      throw error;
    }
  }
};