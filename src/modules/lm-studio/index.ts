import axios, { AxiosError } from 'axios';
import fs from 'fs/promises';
import path from 'path';
import { mkdir } from 'fs/promises';
import { config } from '../../config/index.js';
import { logger } from '../../utils/logger.js';
import { Model } from '../../types/index.js';
import {
  LMStudioModel,
  LMStudioModelTracking,
  PromptingStrategy,
  LMStudioErrorType,
  LMStudioResponse,
  SpeculativeInferenceConfig,
  PromptImprovementConfig
} from './types.js';

// File path for storing LM Studio model tracking data
const TRACKING_FILE_PATH = path.join(config.rootDir, 'lm-studio-models.json');
const STRATEGIES_FILE_PATH = path.join(config.rootDir, 'lm-studio-strategies.json');

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
  'qwen': {
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
  'default': {
    systemPrompt: 'You are a helpful assistant.',
    useChat: true
  }
};

// Default speculative inference configuration
const DEFAULT_SPECULATIVE_INFERENCE_CONFIG: SpeculativeInferenceConfig = {
  enabled: true,
  maxTokens: 5,
  temperature: 0.1,
  acceptanceThreshold: 0.9
};

// Default prompt improvement configuration
const DEFAULT_PROMPT_IMPROVEMENT_CONFIG: PromptImprovementConfig = {
  enabled: true,
  minimumQualityThreshold: 0.6,
  maxAttempts: 5,
  cooldownPeriod: 24 // hours
};


/**
 * LM Studio Module
 *
 * This module is responsible for:
 * - Querying LM Studio for available models
 * - Tracking available models
 * - Handling errors from LM Studio
 * - Determining the best prompting strategy for each model
 * - Implementing speculative inference
 * - Automatically improving prompting strategies over time
 */
export const lmStudioModule = {
  // In-memory cache of model tracking data
  modelTracking: {
    models: {},
    lastUpdated: ''
  } as LMStudioModelTracking,

  // In-memory cache of prompting strategies
  promptingStrategies: {} as Record<string, PromptingStrategy>,

  // Speculative inference configuration
  speculativeInferenceConfig: { ...DEFAULT_SPECULATIVE_INFERENCE_CONFIG },

  // Prompt improvement configuration
  promptImprovementConfig: { ...DEFAULT_PROMPT_IMPROVEMENT_CONFIG },

  // Helper function moved inside
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
      else if (modelLower.includes('qwen')) family = 'qwen';
      else if (modelLower.includes('phi')) family = 'phi';
      else if (modelLower.includes('gemma')) family = 'gemma';
      else family = 'default';
    }

    const defaultStrategy = DEFAULT_PROMPTING_STRATEGIES[family] || DEFAULT_PROMPTING_STRATEGIES.default;

    return {
      systemPrompt: defaultStrategy.systemPrompt,
      userPrompt: defaultStrategy.userPrompt,
      assistantPrompt: defaultStrategy.assistantPrompt,
      useChat: defaultStrategy.useChat || true
    };
  },

  // Helper function moved inside
  handleLMStudioError(error: Error): LMStudioErrorType {
      if (axios.isAxiosError(error)) {
        const axiosError = error as AxiosError;

        if (axiosError.response) {
          const statusCode = axiosError.response.status;

          // Handle specific error types based on status code
          if (statusCode === 429) {
            logger.warn('LM Studio rate limit exceeded');
            return LMStudioErrorType.RATE_LIMIT;
          } else if (statusCode === 401 || statusCode === 403) {
            logger.error('LM Studio authentication error');
            return LMStudioErrorType.AUTHENTICATION;
          } else if (statusCode === 400) {
            logger.error('LM Studio invalid request error');
            return LMStudioErrorType.INVALID_REQUEST;
          } else if (statusCode === 404) {
            logger.warn('LM Studio resource not found');
            return LMStudioErrorType.MODEL_NOT_FOUND;
          } else if (statusCode >= 500) {
            logger.error('LM Studio server error');
            return LMStudioErrorType.SERVER_ERROR;
          }
        } else if (axiosError.code === 'ECONNREFUSED' || axiosError.code === 'ECONNABORTED') {
          logger.error('LM Studio connection refused or timed out');
          return LMStudioErrorType.SERVER_ERROR;
        }
      } else if (error.message.includes('context length')) {
        logger.warn('LM Studio context length exceeded:', error.message);
        return LMStudioErrorType.CONTEXT_LENGTH_EXCEEDED;
      } else if (error.message.includes('model not found')) {
        logger.warn('LM Studio model not found:', error.message);
        return LMStudioErrorType.MODEL_NOT_FOUND;
      }

      logger.error(`Unknown LM Studio error: ${error.message}`);
      return LMStudioErrorType.UNKNOWN;
    },

  // Helper function moved inside
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
   * Initialize the LM Studio module
   * Loads tracking data from disk if available
   * @param forceUpdate Optional flag to force update of models regardless of timestamp
   */
  async initialize(forceUpdate = false): Promise<void> {
    logger.debug('Initializing LM Studio module');

    try {
      // Check if LM Studio endpoint is configured
      if (!config.lmStudioEndpoint) {
        logger.warn('LM Studio endpoint not configured, local models will not be available');
        return;
      }

      // Ensure the directory exists for tracking files
      try {
        await mkdir(path.dirname(TRACKING_FILE_PATH), { recursive: true });
        logger.debug(`Ensured directory exists: ${path.dirname(TRACKING_FILE_PATH)}`);
      } catch (error) {
        logger.debug('Unknown error during directory check');
      }

      // Flag to track if models file exists
      let modelsFileExists = true;

      // Load tracking data from disk if available
      try {
        const data = await fs.readFile(TRACKING_FILE_PATH, 'utf8');
        this.modelTracking = JSON.parse(data) as LMStudioModelTracking;
        logger.debug(`Loaded LM Studio tracking data with ${Object.keys(this.modelTracking.models).length} models`);
      } catch (error) {
        logger.debug('No existing LM Studio tracking data found, will create new tracking data');
        this.modelTracking = {
          models: {},
          lastUpdated: new Date().toISOString()
        };
        modelsFileExists = false;
      }

      // Load prompting strategies from disk if available
      try {
        const data = await fs.readFile(STRATEGIES_FILE_PATH, 'utf8');
        this.promptingStrategies = JSON.parse(data) as Record<string, PromptingStrategy>;
        logger.debug(`Loaded LM Studio prompting strategies for ${Object.keys(this.promptingStrategies).length} models`);
      } catch (error) {
        logger.debug('No existing LM Studio prompting strategies found');
        this.promptingStrategies = {};
      }

      // Check if we need to update the models
      if (forceUpdate || !modelsFileExists) {
        logger.info(`${forceUpdate ? 'Forcing' : 'Models file not found, forcing'} update of LM Studio models...`);
        await this.updateModels();
      } else {
        const now = new Date();
        const lastUpdated = new Date(this.modelTracking.lastUpdated || new Date(0));
        const hoursSinceLastUpdate = (now.getTime() - lastUpdated.getTime()) / (1000 * 60 * 60);

        if (hoursSinceLastUpdate > 24) {
          logger.info('LM Studio models data is more than 24 hours old, updating...');
          await this.updateModels();
        } else {
          logger.debug(`LM Studio models data is ${hoursSinceLastUpdate.toFixed(1)} hours old, no update needed`);
        }
      }
    } catch (error) {
      logger.error('Error initializing LM Studio module:', error);
    }
  },

  /**
   * Update the list of available models from LM Studio
   */
  async updateModels(): Promise<void> {
    logger.debug('Updating LM Studio models');

    // Check if LM Studio endpoint is configured
    if (!config.lmStudioEndpoint) {
      logger.warn('LM Studio endpoint not configured, local models will not be available');
      return;
    }

    // Query LM Studio for available models - Ensure we don't duplicate /v1/
    const baseUrl = config.lmStudioEndpoint.endsWith('/v1') ? 
      config.lmStudioEndpoint : 
      `${config.lmStudioEndpoint}/v1`;
    
    const url = `${baseUrl}/models`;
    logger.info(`Attempting to connect to LM Studio API at: ${url}`); // Use INFO level

    try {
      const response = await axios.get(url, {
        timeout: 5000, // Increased timeout slightly
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
        }
      });

      logger.debug(`LM Studio API response status: ${response.status}`);

      // Process the response - LM Studio returns an array of model objects
      if (response.data && Array.isArray(response.data.data)) {
        const models = response.data.data;
        logger.debug(`Received ${models.length} models from LM Studio API`);

        const updatedModels: Record<string, LMStudioModel> = {};

        for (const model of models) {
          const modelId = model.id;
          if (!modelId) continue;

          // Create or update the model in our tracking
          const existingModel = this.modelTracking.models[modelId];

          // Try to determine context window size
          let contextWindow = 4096; // Default fallback

          // Try to extract family from name
          let family = 'default';
          const modelNameLower = modelId.toLowerCase();
          if (modelNameLower.includes('llama')) family = 'llama';
          else if (modelNameLower.includes('mistral')) family = 'mistral';
          else if (modelNameLower.includes('mixtral')) family = 'mixtral';
          else if (modelNameLower.includes('qwen')) family = 'qwen';
          else if (modelNameLower.includes('phi')) family = 'phi';
          else if (modelNameLower.includes('gemma')) family = 'gemma';

          // Determine context window based on model family and name
          if (family === 'llama' && modelNameLower.includes('llama3')) {
            contextWindow = 8192;
          } else if (family === 'llama' && modelNameLower.includes('llama2')) {
            contextWindow = 4096;
          } else if (family === 'mistral') {
            contextWindow = 8192;
          } else if (family === 'mixtral') {
            contextWindow = 32768;
          } else if (family === 'qwen') {
            contextWindow = 32768;
          } else if (family === 'phi' && modelNameLower.includes('phi-3-mini')) {
            contextWindow = 4096;
          } else if (family === 'phi' && modelNameLower.includes('phi-3')) {
            contextWindow = 8192;
          } else if (family === 'gemma') {
            contextWindow = 8192;
          } else if (modelNameLower.includes('claude')) {
            contextWindow = 100000;
          }

          // Create the LMStudioModel object
          updatedModels[modelId] = {
            id: modelId,
            name: model.name || modelId,
            provider: 'lm-studio',
            contextWindow,
            capabilities: {
              chat: true,
              completion: true,
              contextWindow,
              speculativeInference: false,
              supportedFormats: ['chat', 'completion']
            },
            costPerToken: {
              prompt: 0,
              completion: 0
            },
            promptingStrategy: existingModel?.promptingStrategy || {
              systemPrompt: this.getDefaultPromptingStrategy(modelId, family).systemPrompt, // Use this.
              userPrompt: this.getDefaultPromptingStrategy(modelId, family).userPrompt, // Use this.
              assistantPrompt: this.getDefaultPromptingStrategy(modelId, family).assistantPrompt, // Use this.
              useChat: this.getDefaultPromptingStrategy(modelId, family).useChat || true // Use this.
            },
            lastUpdated: new Date().toISOString(),
            family: family
          };
        }

        // Update the tracking data
        this.modelTracking = {
          models: updatedModels,
          lastUpdated: new Date().toISOString()
        };

        // Save the tracking data to disk
        await this.saveTrackingData();

        logger.info(`Updated LM Studio models: ${Object.keys(updatedModels).length} total`);
      } else {
        logger.warn('Invalid response from LM Studio API:', response.data);
      }
    } catch (error) {
      // Enhanced error logging
      if (axios.isAxiosError(error)) {
        logger.error(`Axios error updating LM Studio models: ${error.message}`);
        if (error.response) {
          logger.error(`LM Studio API Response Status: ${error.response.status}`);
          logger.error(`LM Studio API Response Data: ${JSON.stringify(error.response.data)}`);
        } else if (error.request) {
          logger.error('LM Studio API request made but no response received.');
        } else {
          logger.error('Error setting up Axios request for LM Studio API.');
        }
      } else {
        logger.error('Non-Axios error updating LM Studio models:', error);
      }
      this.handleLMStudioError(error instanceof Error ? error : new Error('Unknown error')); // Use this.
    }
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
      logger.debug('Successfully saved LM Studio tracking data to disk');
    } catch (error) {
      if (error instanceof Error) {
        logger.error(`Error saving LM Studio tracking data to ${TRACKING_FILE_PATH}:`, error);
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
      logger.debug('Successfully saved LM Studio prompting strategies to disk');
    } catch (error) {
      if (error instanceof Error) {
        logger.error(`Error saving LM Studio prompting strategies:`, error);
        logger.error(`Error details: ${error.message}`);
      } else {
        logger.error('Unknown error occurred');
      }
    }
  },

  /**
   * Get all available models from LM Studio
   */
  async getAvailableModels(): Promise<Model[]> {
    logger.debug('Getting available models from LM Studio');

    try {
      // Check if LM Studio endpoint is configured
      if (!config.lmStudioEndpoint) {
        logger.warn('LM Studio endpoint not configured, local models will not be available');
        return [];
      }

      // Check if we need to update the models
      const now = new Date();
      const lastUpdated = new Date(this.modelTracking.lastUpdated || new Date(0));
      const hoursSinceLastUpdate = (now.getTime() - lastUpdated.getTime()) / (1000 * 60 * 60);

      if (hoursSinceLastUpdate > 24) {
        logger.info('LM Studio models data is more than 24 hours old, updating...');
        await this.updateModels();
      }

      // Convert LM Studio models to the common Model format
      const models: Model[] = [];

      for (const [modelId, model] of Object.entries(this.modelTracking.models)) {
        models.push({
          id: `lm-studio:${modelId}`, // Add prefix here
          name: model.name,
          provider: 'lm-studio',
          capabilities: {
            chat: true,
            completion: true
          },
          costPerToken: {
            prompt: 0,
            completion: 0
          },
          contextWindow: model.capabilities.contextWindow
        });
      }

      return models;
    } catch (error) {
      this.handleLMStudioError(error instanceof Error ? error : new Error('Unknown error')); // Use this.
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
          systemPrompt: strategy.systemPrompt || existingStrategy.systemPrompt || 'You are a helpful assistant.',
          successRate,
          qualityScore,
          lastUpdated: new Date().toISOString()
        };

        // Update the model's prompting strategy
        if (this.modelTracking.models[modelId]) {
          this.modelTracking.models[modelId].promptingStrategy = {
            systemPrompt: strategy.systemPrompt ?? existingStrategy.systemPrompt ?? 'You are a helpful assistant.',
            userPrompt: strategy.userPrompt ?? existingStrategy.userPrompt,
            assistantPrompt: strategy.assistantPrompt ?? existingStrategy.assistantPrompt,
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
   * Call LM Studio API with a task
   */
  async callLMStudioApi(
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
    error?: LMStudioErrorType;
  }> {
    logger.debug(`Calling LM Studio API for model ${modelId}`);

    try {
      // Check if LM Studio endpoint is configured
      if (!config.lmStudioEndpoint) {
        logger.warn('LM Studio endpoint not configured, local models will not be available');
        return { success: false, error: LMStudioErrorType.SERVER_ERROR };
      }

      // Get the model information - Use the raw modelId without prefix
      const rawModelId = modelId.startsWith('lm-studio:') ? modelId.substring(10) : modelId;
      const model = this.modelTracking.models[rawModelId];
      if (!model) {
        logger.warn(`Model ${rawModelId} not found in LM Studio tracking data`);
        return { success: false, error: LMStudioErrorType.MODEL_NOT_FOUND };
      }

      // Get the prompting strategy
      const strategy = this.getPromptingStrategy(rawModelId) || {
        modelId: rawModelId,
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
      const maxTokens = config.defaultModelConfig.maxTokens;

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

      // Create the request body - Use the rawModelId
      const requestBody = {
        model: rawModelId,
        messages,
        temperature,
        max_tokens: maxTokens
      };

      logger.debug(`LM Studio API call for ${rawModelId} using temperature: ${temperature}, maxTokens: ${maxTokens}`);

      // Ensure the URL is properly formatted without duplicating /v1/
      const baseUrl = config.lmStudioEndpoint.endsWith('/v1') ? 
        config.lmStudioEndpoint : 
        `${config.lmStudioEndpoint}/v1`;
      
      const url = `${baseUrl}/chat/completions`;

      // Make the request
      const response = await axios.post<LMStudioResponse>(
        url,
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
      if (response.status === 200 && response.data && response.data.choices && response.data.choices.length > 0) {
        return {
          success: true,
          text: response.data.choices[0].message.content,
          usage: response.data.usage
        };
      } else {
        logger.warn('Invalid response from LM Studio API:', response.data);
        return { success: false, error: LMStudioErrorType.INVALID_REQUEST };
      }
    } catch (error) {
      logger.error(`Error calling LM Studio API for model ${modelId}:`, error);
      const errorType = this.handleLMStudioError(error instanceof Error ? error : new Error('Unknown error')); // Use this.
      return { success: false, error: errorType };
    }
  },

  /**
   * Automatically improve the prompting strategy for a model
   * This function attempts to find a better prompting strategy if the current one is below the quality threshold.
   */
  async autoImprovePromptingStrategy(modelId: string): Promise<void> {
    logger.debug(`Attempting to auto-improve prompting strategy for model ${modelId}`);

    try {
      const rawModelId = modelId.startsWith('lm-studio:') ? modelId.substring(10) : modelId;
      const currentStrategy = this.getPromptingStrategy(rawModelId);
      const config = this.promptImprovementConfig;

      // Check if improvement is enabled and needed
      if (!config.enabled || (currentStrategy && currentStrategy.qualityScore >= (config.minimumQualityThreshold || 0.6))) {
        logger.debug(`Prompt improvement not needed or disabled for model ${rawModelId}`);
        return;
      }

      // Check cooldown period
      if (currentStrategy && currentStrategy.lastUpdated) {
        const lastUpdated = new Date(currentStrategy.lastUpdated);
        const now = new Date();
        const hoursSinceLastUpdate = (now.getTime() - lastUpdated.getTime()) / (1000 * 60 * 60);
        if (hoursSinceLastUpdate < (config.cooldownPeriod || 24)) {
          logger.debug(`Prompt improvement for model ${rawModelId} is on cooldown (${hoursSinceLastUpdate.toFixed(1)}h < ${config.cooldownPeriod || 24}h)`);
          return;
        }
      }

      // Define a simple task for benchmarking
      const benchmarkTask = 'Write a short explanation of what a large language model is.';
      const timeout = 30000; // 30 seconds timeout for benchmarking

      // Benchmark strategies
      logger.info(`Benchmarking prompting strategies for model ${rawModelId} to improve quality.`);
      await this.benchmarkPromptingStrategies(rawModelId, benchmarkTask, timeout); // Use this.

    } catch (error) {
      logger.error(`Error during auto-improvement of prompting strategy for model ${modelId}:`, error);
    }
  },

  /**
   * Call LM Studio API with speculative inference
   * Generates a small number of tokens speculatively and validates them.
   */
  async callWithSpeculativeInference(
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
    error?: LMStudioErrorType;
    speculativeStats?: {
      tokensGenerated: number;
      tokensAccepted: number;
      timeSavedMs: number; // Placeholder for potential time saving calculation
    };
  }> {
    logger.debug(`Calling LM Studio API for model ${modelId} with speculative inference`);
    const startTime = Date.now();
    const rawModelId = modelId.startsWith('lm-studio:') ? modelId.substring(10) : modelId;

    // Check if speculative inference is enabled globally or for the model
    const model = this.modelTracking.models[rawModelId];
    const speculativeEnabled = this.speculativeInferenceConfig.enabled && (model?.capabilities.speculativeInference ?? false);

    if (!speculativeEnabled) {
      logger.debug(`Speculative inference disabled for model ${rawModelId}, falling back to standard call.`);
      return this.callLMStudioApi(rawModelId, task, timeout); // Use this.
    }

    try {
      // Check if LM Studio endpoint is configured
      if (!config.lmStudioEndpoint) {
        logger.warn('LM Studio endpoint not configured, local models will not be available');
        return { success: false, error: LMStudioErrorType.SERVER_ERROR };
      }

      // Get the model information (already fetched above)
      if (!model) {
        logger.warn(`Model ${rawModelId} not found in LM Studio tracking data`);
        return { success: false, error: LMStudioErrorType.MODEL_NOT_FOUND };
      }

      // Get the prompting strategy
      const strategy = this.getPromptingStrategy(rawModelId) || {
        modelId: rawModelId,
        systemPrompt: 'You are a helpful assistant.',
        useChat: true,
        successRate: 0,
        qualityScore: 0,
        lastUpdated: new Date().toISOString()
      };

      // Prepare the messages
      const messages = [];
      if (strategy.systemPrompt) {
        messages.push({ role: 'system', content: strategy.systemPrompt });
      }
      if (strategy.userPrompt) {
        messages.push({ role: 'user', content: strategy.userPrompt.replace('{{task}}', task) });
      } else {
        messages.push({ role: 'user', content: task });
      }

      // Ensure the URL is properly formatted without duplicating /v1/
      const baseUrl = config.lmStudioEndpoint.endsWith('/v1') ? 
        config.lmStudioEndpoint : 
        `${config.lmStudioEndpoint}/v1`;
      
      const chatCompletionsUrl = `${baseUrl}/chat/completions`;

      // --- Speculative Generation ---
      let speculativeText = '';
      let speculativeTokensGenerated = 0;
      let speculativeTokensAccepted = 0;
      const speculativeConfig = this.speculativeInferenceConfig;

      try {
        const speculativeRequestBody = {
          model: rawModelId, // Use rawModelId
          messages,
          temperature: speculativeConfig.temperature,
          max_tokens: speculativeConfig.maxTokens
        };

        logger.debug(`Making speculative request for ${rawModelId}`);
        const speculativeResponse = await axios.post<LMStudioResponse>(
          chatCompletionsUrl,
          speculativeRequestBody,
          {
            timeout: Math.min(timeout, 5000), // Shorter timeout for speculative part
            headers: { 'Content-Type': 'application/json' },
          }
        );

        if (speculativeResponse.status === 200 && speculativeResponse.data?.choices?.[0]?.message?.content) {
          speculativeText = speculativeResponse.data.choices[0].message.content;
          speculativeTokensGenerated = speculativeResponse.data.usage?.completion_tokens || speculativeText.split(/\s+/).length; // Estimate if not provided
          logger.debug(`Speculative response received: "${speculativeText.substring(0, 50)}..."`);
        }
      } catch (speculativeError) {
        logger.warn(`Speculative generation failed for ${rawModelId}:`, speculativeError);
        // Proceed without speculative text
      }

      // --- Main Generation & Validation ---
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeout);

      const mainRequestBody = {
        model: rawModelId, // Use rawModelId
        messages: [...messages, ...(speculativeText ? [{ role: 'assistant', content: speculativeText }] : [])], // Include speculative text for validation/continuation
        temperature: config.defaultModelConfig.temperature,
        max_tokens: config.defaultModelConfig.maxTokens
      };

      logger.debug(`Making main request for ${rawModelId}`);
      const mainResponse = await axios.post<LMStudioResponse>(
        chatCompletionsUrl,
        mainRequestBody,
        {
          signal: controller.signal,
          headers: { 'Content-Type': 'application/json' },
        }
      );

      clearTimeout(timeoutId);

      // Process the main response
      if (mainResponse.status === 200 && mainResponse.data?.choices?.[0]?.message?.content) {
        const mainText = mainResponse.data.choices[0].message.content;
        let combinedText = mainText;

        // Simple validation: Check if the main response starts with the speculative text
        if (speculativeText && mainText.startsWith(speculativeText)) {
          // Speculative text accepted
          speculativeTokensAccepted = speculativeTokensGenerated;
          combinedText = mainText; // The main response already contains the validated speculative part
          logger.debug(`Speculative text accepted for ${rawModelId}`);
        } else if (speculativeText) {
          // Speculative text rejected or partially accepted (more complex logic needed for partial)
          speculativeTokensAccepted = 0; // Simple rejection for now
          combinedText = mainText; // Use only the main response
          logger.debug(`Speculative text rejected for ${rawModelId}`);
        } else {
           // No speculative text was generated
           combinedText = mainText;
        }


        const endTime = Date.now();
        // Basic time saved estimation (needs refinement)
        const timeSavedMs = speculativeTokensAccepted > 0 ? Math.max(0, (endTime - startTime) * 0.1) : 0; // Placeholder

        return {
          success: true,
          text: combinedText,
          usage: mainResponse.data.usage,
          speculativeStats: {
            tokensGenerated: speculativeTokensGenerated,
            tokensAccepted: speculativeTokensAccepted,
            timeSavedMs: Math.round(timeSavedMs)
          }
        };
      } else {
        logger.warn('Invalid main response from LM Studio API:', mainResponse.data);
        return { success: false, error: LMStudioErrorType.INVALID_REQUEST };
      }
    } catch (error) {
      logger.error(`Error calling LM Studio API with speculative inference for model ${modelId}:`, error);
      const errorType = this.handleLMStudioError(error instanceof Error ? error : new Error('Unknown error')); // Use this.
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
    const rawModelId = modelId.startsWith('lm-studio:') ? modelId.substring(10) : modelId;

    try {
      // Check if LM Studio endpoint is configured
      if (!config.lmStudioEndpoint) {
        logger.warn('LM Studio endpoint not configured, local models will not be available');
        return {
          bestStrategy: {
            modelId: rawModelId,
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
      const model = this.modelTracking.models[rawModelId];
      if (!model) {
        logger.warn(`Model ${rawModelId} not found in LM Studio tracking data`);
        return {
          bestStrategy: {
            modelId: rawModelId,
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

      // Try each strategy
      let bestStrategy: PromptingStrategy | null = null;
      let bestResponse: { success: boolean; text?: string; usage?: { prompt_tokens: number; completion_tokens: number } } | null = null;
      let bestQualityScore = 0;

      for (const strategy of strategiesToTry) {
        // Create a temporary strategy
        const tempStrategy: PromptingStrategy = {
          modelId: rawModelId,
          systemPrompt: strategy.systemPrompt ?? 'You are a helpful assistant.', // Provide default
          userPrompt: strategy.userPrompt,
          assistantPrompt: strategy.assistantPrompt,
          useChat: strategy.useChat !== undefined ? strategy.useChat : true,
          successRate: 0,
          qualityScore: 0,
          lastUpdated: new Date().toISOString()
        };

        try {
          // Try the strategy
          const result = await this.callLMStudioApi(rawModelId, task, timeout); // Use this.

          if (result.success && result.text) {
            const text = result.text;
            const qualityScore = this.evaluateQuality(task, text); // Use this.

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
          logger.debug(`Error trying prompting strategy for model ${rawModelId}:`, error);
        }
      }

      // If we found a good strategy, update it
      if (bestStrategy && bestQualityScore > 0) {
        await this.updatePromptingStrategy( // Use this.
          rawModelId,
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
      const existingStrategy = this.getPromptingStrategy(rawModelId) || { // Use this.
        modelId: rawModelId,
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
          modelId: rawModelId,
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
   * Execute a task using a specific LM Studio model
   * @param modelId The ID of the model to use
   * @param task The task to execute
   * @returns The result of the task execution
   */
  async executeTask(modelId: string, task: string): Promise<string> {
    logger.info(`Executing task using LM Studio model ${modelId}`);

    try {
      // Check if LM Studio endpoint is configured
      if (!config.lmStudioEndpoint) {
        throw new Error('LM Studio endpoint not configured');
      }

      // Determine the execution timeout (default to 3 minutes)
      const timeout = 180000;

      // Call the LM Studio API
      const result = await this.callLMStudioApi(modelId, task, timeout); // Use this.

      if (!result.success || !result.text) {
        if (result.error) {
          switch (result.error) {
            case LMStudioErrorType.RATE_LIMIT:
              throw new Error('LM Studio rate limit exceeded. Please try again later.');
            case LMStudioErrorType.AUTHENTICATION:
              throw new Error('LM Studio authentication error.');
            case LMStudioErrorType.CONTEXT_LENGTH_EXCEEDED:
              throw new Error('Context length exceeded. Please reduce the size of your task.');
            case LMStudioErrorType.MODEL_NOT_FOUND:
              throw new Error(`Model ${modelId} not found in LM Studio.`);
            case LMStudioErrorType.SERVER_ERROR:
              throw new Error('LM Studio server error. Please ensure LM Studio is running.');
            default:
              throw new Error(`Error executing task: ${result.error}`);
          }
        }
        throw new Error('Failed to execute task with LM Studio');
      }

      // Log usage information
      if (result.usage) {
        logger.debug(`LM Studio usage: ${result.usage.prompt_tokens} prompt tokens, ${result.usage.completion_tokens} completion tokens`);
      }

      return result.text;
    } catch (error) {
      if (error instanceof Error) {
        logger.error(`Error executing task with LM Studio model ${modelId}:`, error);
      } else {
        logger.error('Unknown error occurred');
      }
      throw error;
    }
  },

  /**
   * Execute a task using a specific LM Studio model with speculative inference
   * @param modelId The ID of the model to use
   * @param task The task to execute
   * @returns The result of the task execution
   */
  async executeSpeculativeTask(modelId: string, task: string): Promise<string> {
    logger.info(`Executing task using LM Studio model ${modelId} with speculative inference`);

    try {
      // Check if LM Studio endpoint is configured
      if (!config.lmStudioEndpoint) {
        throw new Error('LM Studio endpoint not configured');
      }

      // Determine the execution timeout (default to 3 minutes)
      const timeout = 180000;

      // Check if we should try to improve the prompting strategy
      const currentStrategy = this.getPromptingStrategy(modelId); // Use this.
      if (this.promptImprovementConfig.enabled &&
          (!currentStrategy ||
           currentStrategy.qualityScore < (this.promptImprovementConfig.minimumQualityThreshold || 0.6))) {
        logger.debug(`Attempting to improve prompting strategy for model ${modelId}`);
        await this.autoImprovePromptingStrategy(modelId); // Use this.
      }

      // Call the LM Studio API with speculative inference
      const result = await this.callWithSpeculativeInference(modelId, task, timeout); // Use this.

      if (!result.success || !result.text) {
        if (result.error) {
          switch (result.error) {
            case LMStudioErrorType.RATE_LIMIT:
              throw new Error('LM Studio rate limit exceeded. Please try again later.');
            case LMStudioErrorType.AUTHENTICATION:
              throw new Error('LM Studio authentication error.');
            case LMStudioErrorType.CONTEXT_LENGTH_EXCEEDED:
              throw new Error('Context length exceeded. Please reduce the size of your task.');
            case LMStudioErrorType.MODEL_NOT_FOUND:
              throw new Error(`Model ${modelId} not found in LM Studio.`);
            case LMStudioErrorType.SERVER_ERROR:
              throw new Error('LM Studio server error. Please ensure LM Studio is running.');
            default:
              throw new Error(`Error executing task: ${result.error}`);
          }
        }
        throw new Error('Failed to execute task with LM Studio');
      }

      // Log usage information
      if (result.usage) {
        logger.debug(`LM Studio usage: ${result.usage.prompt_tokens} prompt tokens, ${result.usage.completion_tokens} completion tokens`);
      }

      // Log speculative inference stats
      if (result.speculativeStats) {
        logger.debug(`Speculative inference stats: ${result.speculativeStats.tokensGenerated} tokens generated, ${result.speculativeStats.tokensAccepted} tokens accepted, ${result.speculativeStats.timeSavedMs}ms saved`);
      }

      return result.text;
    } catch (error) {
      if (error instanceof Error) {
        logger.error(`Error executing task with LM Studio model ${modelId}:`, error);
      } else {
        logger.error('Unknown error occurred');
      }
      throw error;
    }
  },

  /**
   * Update model capabilities based on testing
   * Tests if the model supports speculative inference
   */
  async updateModelCapabilities(modelId: string): Promise<void> {
    logger.debug(`Testing capabilities for model ${modelId}`);

    try {
      // Check if LM Studio endpoint is configured
      if (!config.lmStudioEndpoint) {
        logger.warn('LM Studio endpoint not configured, local models will not be available');
        return;
      }

      // Get the model information
      const model = this.modelTracking.models[modelId];
      if (!model) {
        logger.warn(`Model ${modelId} not found in LM Studio tracking data`);
        return;
      }

      // Test speculative inference capability
      try {
        const originalSetting = this.speculativeInferenceConfig.enabled;
        this.speculativeInferenceConfig.enabled = true;

        const result = await this.callWithSpeculativeInference( // Use this.
          modelId,
          'Test speculative inference capability',
          10000
        );

        // Restore original setting
        this.speculativeInferenceConfig.enabled = originalSetting;

        if (result.success && result.speculativeStats && result.speculativeStats.tokensAccepted > 0) {
          logger.info(`Model ${modelId} supports speculative inference`);
          model.capabilities.speculativeInference = true;
        } else {
          logger.info(`Model ${modelId} does not support speculative inference`);
          model.capabilities.speculativeInference = false;
        }

        // Update the model in tracking
        this.modelTracking.models[modelId] = model;
        await this.saveTrackingData(); // Use this.
      } catch (error) {
        logger.debug(`Error testing speculative inference for model ${modelId}:`, error);
        model.capabilities.speculativeInference = false;

        // Update the model in tracking
        this.modelTracking.models[modelId] = model;
        await this.saveTrackingData(); // Use this.
      }
    } catch (error) {
      logger.error(`Error updating capabilities for model ${modelId}:`, error);
    }
  }
};