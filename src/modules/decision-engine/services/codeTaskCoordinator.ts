import { logger } from '../../../utils/logger.js';
import { codeTaskAnalyzer } from './codeTaskAnalyzer.js';
import { dependencyMapper } from './dependencyMapper.js';
import { codeModelSelector } from './codeModelSelector.js';
import { openRouterModule, ModelNotFoundError } from '../../openrouter/index.js'; // Import ModelNotFoundError
import { lmStudioModule } from '../../lm-studio/index.js'; // Import LM Studio module
import { ollamaModule } from '../../ollama/index.js'; // Import Ollama module
import { costMonitor, CodeSearchEngine, CodeSearchResult } from '../../cost-monitor/index.js';
import { CodeTaskAnalysisOptions, DecomposedCodeTask, CodeSubtask } from '../types/codeTask.js';
import { Model } from '../../../types/index.js';

/**
 * Coordinates the entire code task analysis flow
 * This is the main entry point for code task decomposition and model selection
 */
export const codeTaskCoordinator = {
  // Private properties
  _codeSearchEngine: null as CodeSearchEngine | null,

  /**
   * Evaluate code quality based on simple heuristics
   * @param decomposedTask The decomposed code task
   * @returns A string describing the evaluation results
   */
  evaluateCodeQuality(decomposedTask: DecomposedCodeTask): string {
    let issues = '';

    for (const subtask of decomposedTask.subtasks) {
      if (!subtask.description) {
        issues += `Subtask "${subtask.id}" is missing a description. `;
      }
      if (subtask.complexity > 0.8) {
        issues += `Subtask "${subtask.id}" has high complexity (${subtask.complexity.toFixed(2)}). `;
      }
    }

    if (issues === '') {
      return 'No code quality issues found.';
    } else {
      return `Potential code quality issues found: ${issues}`;
    }
  },

  /**
   * Initialize the code search engine
   * @param workspacePath The root path of the workspace to index
   */
  async initializeCodeSearch(workspacePath?: string): Promise<void> {
    if (this._codeSearchEngine) {
      return; // Already initialized
    }
    
    try {
      // Use the provided workspace path or default to current directory
      const rootPath = workspacePath || process.cwd();
      logger.info(`Initializing code search engine for workspace: ${rootPath}`);
      
      // Create and initialize the code search engine
      this._codeSearchEngine = costMonitor.createCodeSearchEngine(rootPath);
      await this._codeSearchEngine.initialize();
      
      // Index all code files in the workspace
      logger.info('Indexing workspace code files...');
      await this._codeSearchEngine.indexWorkspace();
      
      const docCount = this._codeSearchEngine.getDocumentCount();
      logger.info(`Successfully indexed ${docCount} code files for semantic search`);
    } catch (error) {
      logger.error('Failed to initialize code search engine:', error);
      this._codeSearchEngine = null;
      // We don't throw here - the system should work even if code search fails
    }
  },
  
  /**
   * Search for relevant code snippets using the BM25 algorithm
   * @param query The search query - typically a subtask description
   * @param limit Maximum number of results to return
   * @returns Array of search results or empty array if search failed
   */
  async searchRelevantCode(query: string, limit: number = 3): Promise<CodeSearchResult[]> {
    if (!this._codeSearchEngine) {
      try {
        await this.initializeCodeSearch();
      } catch (error) {
        logger.warn('Could not initialize code search engine for query', error);
        return [];
      }
    }
    
    if (!this._codeSearchEngine) {
      return []; // Still failed to initialize
    }
    
    try {
      // Perform the search
      const results = await this._codeSearchEngine.search(query, limit);
      return results;
    } catch (error) {
      logger.warn('Error searching for code:', error);
      return [];
    }
  },

  /**
   * Process a coding task from start to finish
   * 
   * @param task The coding task to process
   * @param options Options for task analysis
   * @returns Results including decomposed task, model assignments, and execution plan
   */
  async processCodeTask(
    task: string,
    options: CodeTaskAnalysisOptions = {}
  ): Promise<{
    decomposedTask: DecomposedCodeTask;
    modelAssignments: Map<string, Model>;
    executionOrder: CodeSubtask[];
    criticalPath: CodeSubtask[];
    dependencyVisualization: string;
    estimatedCost: number;
  }> {
    logger.info('Processing code task:', task);
    
    try {
      // Initialize code search if not already done
      if (!this._codeSearchEngine && options.workspacePath) {
        await this.initializeCodeSearch(options.workspacePath);
      }
      
      // Step 1: Decompose the task into subtasks
      const decomposedTask = await codeTaskAnalyzer.decompose(task, options);
      logger.info(`Decomposed task into ${decomposedTask.subtasks.length} subtasks`);

      // Step 1.5: Perform basic code evaluation
      const codeEvaluation = this.evaluateCodeQuality(decomposedTask);
      logger.info(`Code evaluation: ${codeEvaluation}`);

      // NEW: Step 1.6: Check for high-complexity subtasks and adjust if needed
      const complexityThreshold = 0.8;
      const highComplexitySubtasks = decomposedTask.subtasks.filter(subtask => 
        subtask.complexity > complexityThreshold
      );
      
      if (highComplexitySubtasks.length > 0) {
        logger.warn(`Found ${highComplexitySubtasks.length} high-complexity subtasks`);
        
        // Adjust complexity to make routing more likely to succeed
        // This doesn't actually make the task easier, but prevents the system
        // from failing due to not finding suitable models
        for (const subtask of decomposedTask.subtasks) {
          if (subtask.complexity > complexityThreshold) {
            const originalComplexity = subtask.complexity;
            subtask.complexity = Math.min(subtask.complexity, complexityThreshold);
            logger.info(`Adjusted subtask "${subtask.id}" complexity from ${originalComplexity.toFixed(2)} to ${subtask.complexity.toFixed(2)}`);
          }
        }
      }

      // Step 2: Resolve any circular dependencies
      const resolvedTask = dependencyMapper.resolveCircularDependencies(decomposedTask);
      
      // Step 3: Determine execution order
      const executionOrder = dependencyMapper.sortByExecutionOrder(resolvedTask);
      
      // Step 4: Find the critical path
      const criticalPath = dependencyMapper.findCriticalPath(resolvedTask);
      
      // Step 5: Generate dependency visualization
      const dependencyVisualization = dependencyMapper.visualizeDependencies(resolvedTask);
      
      // Step 6: Select models for each subtask
      const useResourceEfficient = options.granularity === 'coarse';
      const modelAssignments = await codeModelSelector.selectModelsForSubtasks(
        resolvedTask.subtasks,
        useResourceEfficient
      );
      
      // Step 7: Calculate estimated cost
      const estimatedCost = await this.calculateEstimatedCost(
        resolvedTask.subtasks,
        modelAssignments
      );
      
      return {
        decomposedTask: resolvedTask,
        modelAssignments,
        executionOrder,
        criticalPath,
        dependencyVisualization,
        estimatedCost
      };
    } catch (error) {
      if (error instanceof Error) {
        throw new Error(`Failed to process code task: ${error.message}`);
      }
      throw new Error('Failed to process code task: Unknown error');
    }
  },
  
  /**
   * Calculate the estimated cost of processing all subtasks
   * 
   * @param subtasks The subtasks to process
   * @param modelAssignments The assigned models for each subtask
   * @returns Estimated cost in USD
   */
  async calculateEstimatedCost(
    subtasks: CodeSubtask[],
    modelAssignments: Map<string, Model>
  ): Promise<number> {
    let totalCost = 0;
    
    for (const subtask of subtasks) {
      const model = modelAssignments.get(subtask.id);
      if (!model) continue;
      
      // Get cost estimate for this subtask
      const estimate = await costMonitor.estimateCost({
        contextLength: Math.round(subtask.estimatedTokens * 0.7), // Approximate input tokens
        outputLength: Math.round(subtask.estimatedTokens * 0.3), // Approximate output tokens
        model: model.id
      });
      
      // Add to total cost
      totalCost += estimate.paid.cost.total;
    }
    
    return totalCost;
  },
  
  /**
   * Execute a single subtask using its assigned model
   * 
   * @param subtask The subtask to execute
   * @param model The model to use
   * @param fullContext Optional additional context for the model
   * @returns The model's response
   */
  async executeSubtask(
    subtask: CodeSubtask,
    model: Model,
    fullContext?: string
  ): Promise<string> {
    // Search for relevant code snippets before execution
    let relevantCodeSnippets = '';
    
    try {
      // Only search if code search is available and the subtask is appropriate for snippets
      if (this._codeSearchEngine && ['function', 'class', 'method', 'component'].includes(subtask.codeType || '')) {
        logger.info(`Searching for relevant code snippets for subtask: ${subtask.id}`);
        const searchResults = await this.searchRelevantCode(subtask.description);
        
        if (searchResults.length > 0) {
          relevantCodeSnippets = '\n\nRelevant code snippets that may help with this task:\n\n';
          searchResults.forEach((result, index) => {
            relevantCodeSnippets += `Snippet ${index + 1} (from ${result.relativePath || 'unknown'}):\n`;
            relevantCodeSnippets += '```\n' + result.content.substring(0, 800) + '\n```\n\n';
          });
        }
      }
    } catch (error) {
      // Just log the error, don't fail the subtask execution
      logger.warn('Error finding relevant code snippets:', error);
    }
    
    // Create a clear, focused prompt for the subtask
    const prompt = `You are tasked with implementing the following specific part of a larger coding task:
    
Task: ${subtask.description}
${fullContext ? `Context:\n${fullContext}\n\n` : ''}Code Type: ${subtask.codeType}
Complexity: ${subtask.complexity.toFixed(2)} (0-1 scale)
${relevantCodeSnippets}
Please provide a well-structured, high-quality implementation for this specific part of the task.
Focus only on this subtask, don't worry about other parts of the larger task.`;

    const timeout = 180000; // 3 minutes timeout

    try {
      let resultText: string | undefined;
      let success = false;
      let errorInstance: Error | undefined;

      // Determine which module to call based on the provider
      switch (model.provider) {
        case 'lm-studio': {
          // LM Studio model IDs might have a prefix like "lm-studio:", remove it
          const lmStudioModelId = model.id.startsWith('lm-studio:') ? model.id.substring(10) : model.id;
          logger.info(`Executing subtask with LM Studio model: ${lmStudioModelId}`);
          const result = await lmStudioModule.callLMStudioApi(lmStudioModelId, prompt, timeout);
          success = result.success;
          resultText = result.text;
          if (!success) {
             errorInstance = new Error(`LM Studio Error: ${result.error}`);
          }
          break;
        }
        case 'ollama': {
          // Ollama model IDs might have a prefix like "ollama:", remove it
          const ollamaModelId = model.id.startsWith('ollama:') ? model.id.substring(7) : model.id;
          logger.info(`Executing subtask with Ollama model: ${ollamaModelId}`);
          const result = await ollamaModule.callOllamaApi(ollamaModelId, prompt, timeout);
          success = result.success;
          resultText = result.text;
           if (!success) {
             errorInstance = new Error(`Ollama Error: ${result.error}`);
          }
          break;
        }
        case 'openrouter':
        default: { // Default to OpenRouter if provider is unknown or 'openrouter'
          // OpenRouter model IDs might have a prefix like "openrouter:", remove it if present
           const openRouterModelId = model.id.startsWith('openrouter:') ? model.id.substring(11) : model.id;
          logger.info(`Executing subtask with OpenRouter model: ${openRouterModelId}`);
          const result = await openRouterModule.callOpenRouterApi(openRouterModelId, prompt, timeout);
          success = result.success;
          resultText = result.text;
          errorInstance = result.errorInstance; // Use the specific error instance
          break;
        }
      }

      if (!success || !resultText) {
         // Use the specific error instance if available
         const errorToThrow = errorInstance || new Error(`Failed to execute subtask with ${model.provider}`);
         throw errorToThrow;
      }

      return resultText;

    } catch (error) {
       // Handle specific ModelNotFoundError from OpenRouter cache check
       if (error instanceof ModelNotFoundError) {
         logger.warn(`Model ${model.id} not found in ${model.provider} cache during execution.`);
         // Optionally: Implement retry logic here by calling codeModelSelector again
         // For now, just return the error message
         return `Error: Failed to execute subtask "${subtask.description}" - Model ${model.id} not found for provider ${model.provider}.`;
       }
      // General error handling
      if (error instanceof Error) {
        return `Error: Failed to execute subtask "${subtask.description}" with model "${model.id}" (Provider: ${model.provider}): ${error.message}`;
      }
      return `Error: Failed to execute subtask "${subtask.description}" with model "${model.id}" (Provider: ${model.provider}): Unknown error`;
    }
  },
  
  /**
   * Execute all subtasks in the proper order
   * 
   * @param decomposedTask The decomposed task
   * @param modelAssignments The model assignments for each subtask
   * @returns A map of subtask ID to results
   */
  async executeAllSubtasks(
    decomposedTask: DecomposedCodeTask,
    modelAssignments: Map<string, Model>
  ): Promise<Map<string, string>> {
    // Get execution order
    const executionOrder = dependencyMapper.sortByExecutionOrder(decomposedTask);
    const results = new Map<string, string>();
    
    // Process subtasks in order
    for (const subtask of executionOrder) {
      const model = modelAssignments.get(subtask.id);
      if (!model) {
        results.set(subtask.id, `Error: No model assigned for subtask "${subtask.description}"`);
        continue;
      }
      
      // Gather context from dependencies
      let dependencyContext = '';
      for (const depId of subtask.dependencies) {
        const depResult = results.get(depId);
        if (depResult) {
          const depSubtask = decomposedTask.subtasks.find(s => s.id === depId);
          if (depSubtask) {
            dependencyContext += `--- From dependency: ${depSubtask.description} ---\n\n`;
            dependencyContext += depResult + '\n\n';
          }
        }
      }
      
      // Execute the subtask
      const result = await this.executeSubtask(subtask, model, dependencyContext);
      results.set(subtask.id, result);
    }
    
    return results;
  },
  
  /**
   * Synthesize final results after executing all subtasks
   * 
   * @param decomposedTask The decomposed task
   * @param subtaskResults The results from each subtask
   * @returns Synthesized final result
   */
  async synthesizeFinalResult(
    decomposedTask: DecomposedCodeTask,
    subtaskResults: Map<string, string>
  ): Promise<string> {
    // Build a combined result with all outputs
    let combinedResults = `# Results for coding task: ${decomposedTask.originalTask}\n\n`;
    
    // Get execution order for a sensible presentation
    const executionOrder = dependencyMapper.sortByExecutionOrder(decomposedTask);
    
    for (const subtask of executionOrder) {
      const result = subtaskResults.get(subtask.id);
      if (result) {
        combinedResults += `## ${subtask.description}\n\n`;
        combinedResults += '```\n' + result + '\n```\n\n';
      }
    }
    
    // Use a model to synthesize the final result
    try {
      // Find a suitable model for synthesis - preferably a larger one
      const availableModels = await costMonitor.getAvailableModels();
      const freeModels = await costMonitor.getFreeModels();
      
      // Prefer a free model if available and suitable
      let synthesisModel: Model | null = null;
      
      if (freeModels.length > 0) {
        const suitableModel = freeModels.find(model => 
          (model.contextWindow || 0) >= combinedResults.length
        );
        if (suitableModel) {
          synthesisModel = suitableModel;
        }
      }
      
      // If no suitable free model, try available models
      if (!synthesisModel && availableModels.length > 0) {
        const suitableModel = availableModels.find(model => 
          (model.contextWindow || 0) >= combinedResults.length
        );
        if (suitableModel) {
          synthesisModel = suitableModel;
        }
      }
      
      // If still no suitable model, use GPT-3.5 Turbo as fallback
      if (!synthesisModel) {
        synthesisModel = {
          id: 'gpt-3.5-turbo',
          name: 'GPT-3.5 Turbo',
          provider: 'openai',
          capabilities: {
            chat: true,
            completion: true
          },
          costPerToken: {
            prompt: 0.000001,
            completion: 0.000002
          }
        };
      }
      
      const synthesisPrompt = `I've broken down a coding task into subtasks and have results for each. 
Please synthesize these into a coherent final solution.
Original Task: ${decomposedTask.originalTask}
Subtask Results:
${combinedResults}
Please provide a clean, consolidated solution that integrates all the components properly.`;
      
      const result = await openRouterModule.callOpenRouterApi(
        synthesisModel.id,
        synthesisPrompt,
        120000 // 2 minutes timeout
      );
      
      if (!result.success || !result.text) {
        throw new Error(`Failed to synthesize results: ${result.error}`);
      }
      
      return result.text;
    } catch (error) {
      logger.error('Error synthesizing results:', error);
      
      // If synthesis fails, return the combined results without additional processing
      combinedResults += '\n\n## Note\n\nAutomatic synthesis failed. The above components need to be manually integrated.';
      return combinedResults;
    }
  },

  /**
   * Cleans up resources used by the coordinator
   */
  dispose(): void {
    if (this._codeSearchEngine) {
      this._codeSearchEngine.dispose();
      this._codeSearchEngine = null;
    }
  }
};
