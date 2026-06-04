},

/**
 * Execute a task using a local model
 */
async executeLocalTask(params: {
  task: string;
  model: string;
  provider: string;
  maxTokens?: number;
}): Promise<string> {
  logger.info(`Executing task using local model ${params.model} with provider ${params.provider}`);
  
  try {
    // We'll use a simple implementation that simulates execution with a local model
    // In a real implementation, this would connect to local model servers 
    // like Ollama, LM Studio, etc.
    const { task, model, provider, maxTokens = 4096 } = params;
    
    // For now we'll use a mock implementation
    // This should be replaced with actual calls to local model providers
    
    if (provider === 'ollama') {
      return await this.executeOllamaModel(model, task, maxTokens);
    } else if (provider === 'lm-studio') {
      return await this.executeLMStudioModel(model, task, maxTokens);
    } else if (provider === 'local') {
      return await this.executeLocalLlamaModel(model, task, maxTokens);
    } else {
      throw new Error(`Unsupported local model provider: ${provider}`);
    }
  } catch (error) {
    logger.error(`Error executing task with local model:`, error);
    throw error;
  }
},

/**
 * Execute a task with an Ollama model
 */
async executeOllamaModel(model: string, task: string, maxTokens: number): Promise<string> {
  logger.debug(`Executing task with Ollama model ${model}`);
  
  try {
    // Get Ollama API endpoint from config or use default
    const ollamaEndpoint = config.ollamaEndpoint || 'http://localhost:11434/api/generate';
    
    // Make a request to the Ollama API
    const response = await fetch(ollamaEndpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        prompt: task,
        stream: false,
        max_tokens: maxTokens
      }),
    });
    
    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Ollama API error (${response.status}): ${errorText}`);
    }
    
    const result = await response.json();
    return result.response || 'No response from Ollama';
  } catch (error) {
    logger.error(`Error executing task with Ollama model ${model}:`, error);
    throw error;
  }
},

/**
 * Execute a task with an LM Studio model
 */
async executeLMStudioModel(model: string, task: string, maxTokens: number): Promise<string> {
  logger.info(`Executing task with LM Studio model ${model}`);
  
  try {
    // Get LM Studio API endpoint from config or use default
    const lmStudioEndpoint = config.lmStudioEndpoint || 'http://localhost:1234/v1/completions';
    
    // Make a request to the LM Studio API
    const response = await fetch(lmStudioEndpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: model,
        prompt: task,
        max_tokens: maxTokens,
        temperature: 0.7,
        stream: false
      }),
    });
    
    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`LM Studio API error (${response.status}): ${errorText}`);
    }
    
    const result = await response.json();
    return result.choices?.[0]?.text || 'No response from LM Studio';
  } catch (error) {
    logger.error(`Error executing task with LM Studio model ${model}:`, error);
    throw error;
  }
},

/**
 * Execute a task with a local llama model
 */
async executeLocalLlamaModel(model: string, task: string, maxTokens: number): Promise<string> {
  logger.info(`Executing task with local Llama model ${model}`);
  
  try {
    // Use configuration to determine the API endpoint for the local model
    // This could be a local server running on localhost or a remote server
    const localApiEndpoint = config.localLlamaEndpoint || 'http://localhost:8080/v1/completions';
    
    // Make a request to the local API
    const response = await fetch(localApiEndpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: model,
        prompt: task,
        max_tokens: maxTokens,
        temperature: 0.7,
        stream: false
      }),
    });
    
    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Local API error (${response.status}): ${errorText}`);
    }
    
    const result = await response.json();
    return result.choices?.[0]?.text || result.response || 'No response from local model';
    
  } catch (error: unknown) {
    logger.error(`Error executing task with local Llama model ${model}:`, error);
    // If the local model fails, return a clear error message that can be shown to the user
    if (error instanceof Error) {
      throw new Error(`Failed to execute task with local model ${model}: ${error.message}. Please check if your local model server is running.`);
    } else {
      throw new Error(`Failed to execute task with local model ${model}. Please check if your local model server is running.`);
    }
  }