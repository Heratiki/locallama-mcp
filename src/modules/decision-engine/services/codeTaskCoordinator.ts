import { logger } from '../../../utils/logger.js';
import { codeTaskAnalyzer } from './codeTaskAnalyzer.js';
import { dependencyMapper } from './dependencyMapper.js';
import { codeModelSelector } from './codeModelSelector.js';
import { openRouterModule, ModelNotFoundError } from '../../openrouter/index.js'; // Import ModelNotFoundError
import { lmStudioModule } from '../../lm-studio/index.js'; // Import LM Studio module
import { ollamaModule } from '../../ollama/index.js'; // Import Ollama module
import { fallbackHandler } from '../../fallback-handler/index.js'; // Import fallback handler for service availability checks
import { costMonitor, CodeSearchEngine, CodeSearchResult } from '../../cost-monitor/index.js';
import { CodeTaskAnalysisOptions, DecomposedCodeTask, CodeSubtask } from '../types/codeTask.js';
import { Model } from '../../../types/index.js';
import { getJobTracker, JobStatus } from './jobTracker.js'; // Import job tracker
import fs from 'fs';
import path from 'path';

// Path for the subtask results log
const SUBTASK_LOG_PATH = path.join(process.cwd(), 'subtask_results.log');

/**
 * Coordinates the entire code task analysis flow
 * This is the main entry point for code task decomposition and model selection
 */
export const codeTaskCoordinator = {
  // Private properties
  _codeSearchEngine: null as CodeSearchEngine | null,

  /**
   * Clears the subtask results log file
   * This should be called at the start of a new task execution
   */
  clearSubtaskLog(): void {
    try {
      // Create or clear the subtask log file
      fs.writeFileSync(SUBTASK_LOG_PATH, `# Subtask Results Log - ${new Date().toISOString()}\n\n`, 'utf-8');
      logger.info(`Cleared subtask results log at ${SUBTASK_LOG_PATH}`);
    } catch (error) {
      logger.error('Failed to clear subtask results log:', error);
    }
  },

  /**
   * Writes a subtask result to the log file
   * 
   * @param subtask The subtask that was executed
   * @param model The model that executed the subtask
   * @param result The result of the execution
   */
  logSubtaskResult(subtask: CodeSubtask, model: Model, result: string): void {
    try {
      const logEntry = `
## Subtask: ${subtask.description}
- **ID**: ${subtask.id}
- **Type**: ${subtask.codeType || 'unknown'}
- **Complexity**: ${subtask.complexity.toFixed(2)}
- **Model**: ${model.id} (${model.provider})
- **Time**: ${new Date().toISOString()}

\`\`\`
${result}
\`\`\`

---
`;
      
      // Append to the log file
      fs.appendFileSync(SUBTASK_LOG_PATH, logEntry, 'utf-8');
    } catch (error) {
      logger.error('Failed to log subtask result:', error);
    }
  },

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

      // Step 2: Resolve any circular dependencies using the new function
      const resolvedSubtasks = await codeTaskCoordinator.resolveDependencyCycles(decomposedTask.subtasks);
      const resolvedTask: DecomposedCodeTask = {
        ...decomposedTask,
        subtasks: resolvedSubtasks
      };
      
      // Step 3: Determine execution order using the resolved task
      const executionOrder = dependencyMapper.sortByExecutionOrder(resolvedTask);
      
      // Step 4: Find the critical path
      const criticalPath = dependencyMapper.findCriticalPath(resolvedTask);
      
      // Step 5: Generate dependency visualization
      const dependencyVisualization = dependencyMapper.visualizeDependencies(resolvedTask);
      
      // Step 6: Select models for each subtask
      const useResourceEfficient = options.granularity === 'coarse';
      // Pass the original task description to the model selector for context
      const modelAssignments = await codeModelSelector.selectModelsForSubtasks(
        resolvedTask.subtasks,
        useResourceEfficient,
        task // Pass original task description
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
   * @param originalTask Optional original task description for context
   * @returns The model's response
   */
  async executeSubtask(
    subtask: CodeSubtask,
    model: Model,
    fullContext?: string,
    originalTask?: string // Add originalTask parameter
  ): Promise<string> {
    // Enhanced logging: Log detailed subtask information
    logger.info(`------- SUBTASK EXECUTION START -------`);
    logger.info(`Subtask ID: ${subtask.id}`);
    logger.info(`Subtask Description: ${subtask.description}`);
    logger.info(`Subtask Type: ${subtask.codeType || 'unknown'}`);
    logger.info(`Subtask Complexity: ${subtask.complexity.toFixed(2)}`);
    logger.info(`Assigned Model: ${model.id} (Provider: ${model.provider})`);
    if (originalTask) {
      logger.info(`Original Task Context: ${originalTask.substring(0, 100)}...`);
    }
    
    // Search for relevant code snippets before execution
    let relevantCodeSnippets = '';
    
    try {
      // Only search if code search is available and the subtask is appropriate for snippets
      if (this._codeSearchEngine && ['function', 'class', 'method', 'component'].includes(subtask.codeType || '')) {
        logger.info(`Searching for relevant code snippets for subtask: ${subtask.id}`);
        const searchResults = await this.searchRelevantCode(subtask.description);
        
        if (searchResults.length > 0) {
          logger.info(`Found ${searchResults.length} relevant code snippets for subtask: ${subtask.id}`);
          relevantCodeSnippets = '\n\nRelevant code snippets that may help with this task:\n\n';
          searchResults.forEach((result, index) => {
            relevantCodeSnippets += `Snippet ${index + 1} (from ${result.relativePath || 'unknown'}):\n`;
            relevantCodeSnippets += '```\n' + result.content.substring(0, 800) + '\n```\n\n';
          });
        } else {
          logger.info(`No relevant code snippets found for subtask: ${subtask.id}`);
        }
      }
    } catch (error) {
      // Just log the error, don't fail the subtask execution
      logger.warn('Error finding relevant code snippets:', error);
    }
    
    // Create a clear, focused prompt for the subtask, including original task context
    const prompt = `You are an expert software developer assisting with a larger coding task.
Original Task: ${originalTask || '[Not Provided]'}

You are now focused *only* on implementing the following specific subtask:
Subtask Description: ${subtask.description}
${fullContext ? `Context from dependent subtasks:\n${fullContext}\n\n` : ''}Code Type Expected: ${subtask.codeType}
Complexity Level: ${subtask.complexity.toFixed(2)} (0-1 scale)
${relevantCodeSnippets}
Please provide a high-quality implementation for *only this subtask*, ensuring it aligns with the original task's requirements (including the programming language mentioned in the original task, if any).
Output only the code required for this subtask. Do not include explanations unless they are comments within the code.`;

    // Log the prompt we're sending to the model
    logger.debug(`Prompt for subtask ${subtask.id}:\n${prompt.substring(0, 500)}${prompt.length > 500 ? '...' : ''}`);

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
          logger.info(`Executing subtask ${subtask.id} with LM Studio model: ${lmStudioModelId}`);
          const result = await lmStudioModule.callLMStudioApi(lmStudioModelId, prompt, timeout);
          success = result.success;
          resultText = result.text;
          if (!success) {
             errorInstance = new Error(`LM Studio Error: ${result.error}`);
             logger.error(`Failed to execute subtask ${subtask.id} with LM Studio model ${lmStudioModelId}: ${result.error}`);
          } else {
             logger.info(`Successfully executed subtask ${subtask.id} with LM Studio model ${lmStudioModelId}`);
             logger.debug(`Result for subtask ${subtask.id}:\n${resultText?.substring(0, 500)}${resultText && resultText.length > 500 ? '...' : ''}`);
          }
          break;
        }
        case 'ollama': {
          // Ollama model IDs might have a prefix like "ollama:", remove it
          const ollamaModelId = model.id.startsWith('ollama:') ? model.id.substring(7) : model.id;
          logger.info(`Executing subtask ${subtask.id} with Ollama model: ${ollamaModelId}`);
          const result = await ollamaModule.callOllamaApi(ollamaModelId, prompt, timeout);
          success = result.success;
          resultText = result.text;
          if (!success) {
             errorInstance = new Error(`Ollama Error: ${result.error}`);
             logger.error(`Failed to execute subtask ${subtask.id} with Ollama model ${ollamaModelId}: ${result.error}`);
          } else {
             logger.info(`Successfully executed subtask ${subtask.id} with Ollama model ${ollamaModelId}`);
             logger.debug(`Result for subtask ${subtask.id}:\n${resultText?.substring(0, 500)}${resultText && resultText.length > 500 ? '...' : ''}`);
          }
          break;
        }
        case 'openrouter':
        default: { // Default to OpenRouter if provider is unknown or 'openrouter'
          // OpenRouter model IDs might have a prefix like "openrouter:", remove it if present
           const openRouterModelId = model.id.startsWith('openrouter:') ? model.id.substring(11) : model.id;
          logger.info(`Executing subtask ${subtask.id} with OpenRouter model: ${openRouterModelId}`);
          const result = await openRouterModule.callOpenRouterApi(openRouterModelId, prompt, timeout);
          success = result.success;
          resultText = result.text;
          errorInstance = result.errorInstance; // Use the specific error instance
          if (!success) {
             logger.error(`Failed to execute subtask ${subtask.id} with OpenRouter model ${openRouterModelId}: ${result.error}`);
          } else {
             logger.info(`Successfully executed subtask ${subtask.id} with OpenRouter model ${openRouterModelId}`);
             logger.debug(`Result for subtask ${subtask.id}:\n${resultText?.substring(0, 500)}${resultText && resultText.length > 500 ? '...' : ''}`);
          }
          break;
        }
      }

      if (!success || !resultText) {
         // Use the specific error instance if available, otherwise create a generic one
         const errorToThrow = errorInstance || new Error(`Failed to execute subtask with ${model.provider}. Success flag: ${success}, Result text available: ${!!resultText}`);
         logger.error(`Subtask ${subtask.id} failed execution with ${model.provider}. Error: ${errorToThrow.message}`); // Log specific error before throwing
         throw errorToThrow;
      }

      logger.info(`------- SUBTASK EXECUTION COMPLETE -------`);
      return resultText;

    } catch (error) {
       // Handle specific ModelNotFoundError from OpenRouter cache check
       if (error instanceof ModelNotFoundError) {
         logger.warn(`Model ${model.id} not found in ${model.provider} cache during execution.`);
         // Optionally: Implement retry logic here by calling codeModelSelector again
         // For now, just return the error message
         logger.info(`------- SUBTASK EXECUTION FAILED (MODEL NOT FOUND) -------`);
         return `Error: Failed to execute subtask "${subtask.description}" - Model ${model.id} not found for provider ${model.provider}.`;
       }
      // General error handling
      if (error instanceof Error) {
        logger.error(`Error executing subtask ${subtask.id} with model ${model.id} (Provider: ${model.provider}): ${error.message}`, error); // Log stack trace too
        logger.info(`------- SUBTASK EXECUTION FAILED (ERROR) -------`);
        // Return a more informative error message
        return `Error: Failed to execute subtask "${subtask.description}" with model "${model.id}" (Provider: ${model.provider}): ${error.message}`;
      }
      logger.error(`Unknown error executing subtask ${subtask.id} with model ${model.id} (Provider: ${model.provider})`, error);
      logger.info(`------- SUBTASK EXECUTION FAILED (UNKNOWN ERROR) -------`);
      return `Error: Failed to execute subtask "${subtask.description}" with model "${model.id}" (Provider: ${model.provider}): Unknown error occurred.`;
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
    
    // Track model usage for better logging
    const modelUsage = new Map<string, { count: number, subtasks: string[] }>();
    
    // Get the job tracker for registering subtasks as jobs
    let jobTracker = null;
    try {
      jobTracker = await getJobTracker();
      // REMOVED: Check for isInitialized() - rely on internal checks in JobTracker methods
      // if (!jobTracker.isInitialized()) {
      //   logger.warn('JobTracker exists but is not initialized');
      //   // Don't throw, just continue without tracking
      //   jobTracker = null; 
      // }
    } catch (error) {
      // Log the error but continue without job tracking
      logger.warn('Failed to initialize JobTracker, continuing without job tracking:', error);
      jobTracker = null;
    }
    
    logger.info(`======= STARTING EXECUTION OF ALL SUBTASKS =======`);
    logger.info(`Original task: ${decomposedTask.originalTask}`);
    logger.info(`Total subtasks: ${executionOrder.length}`);
    logger.info(`Execution order: ${executionOrder.map(s => s.id).join(' -> ')}`);
    
    // Log model assignments
    logger.info(`===== MODEL ASSIGNMENTS =====`);
    for (const subtask of executionOrder) {
      const model = modelAssignments.get(subtask.id);
      if (model) {
        logger.info(`Subtask ${subtask.id} (${subtask.description.substring(0, 50)}${subtask.description.length > 50 ? '...' : ''}) -> ${model.id} (${model.provider})`);
        
        // Track model usage
        if (!modelUsage.has(model.id)) {
          modelUsage.set(model.id, { count: 0, subtasks: [] });
        }
        const usage = modelUsage.get(model.id)!;
        usage.count++;
        usage.subtasks.push(subtask.id);
      } else {
        logger.warn(`No model assigned for subtask ${subtask.id}`);
      }
    }
    
    // Process subtasks in order
    let completedCount = 0;
    for (const subtask of executionOrder) {
      const model = modelAssignments.get(subtask.id);
      if (!model) {
        logger.warn(`Skipping subtask ${subtask.id}: No model assigned`);
        results.set(subtask.id, `Error: No model assigned for subtask "${subtask.description}"`);
        continue;
      }
      
      // Register this subtask as a job with the job tracker (if available)
      // Check if jobTracker is not null before using it
      if (jobTracker) {
        try {
          await jobTracker.createJob(
            subtask.id, 
            `Subtask: ${subtask.description.substring(0, 100)}${subtask.description.length > 100 ? '...' : ''}`,
            model.id
          );
        } catch (error) {
          logger.warn(`Failed to create job for subtask ${subtask.id}:`, error);
        }
      } else {
        // Log if tracker is unavailable for job creation
        logger.debug(`JobTracker not available, skipping job creation for subtask ${subtask.id}`);
      }
      
      // Track progress
      completedCount++;
      logger.info(`Executing subtask ${completedCount}/${executionOrder.length}: ${subtask.id}`);
      
      // Update job status to In Progress (if job tracker is available)
      // Check if jobTracker is not null before using it
      if (jobTracker) {
        try {
          await jobTracker.updateJobProgress(subtask.id, 10); // Start at 10%
        } catch (error) {
          logger.warn(`Failed to update job progress for subtask ${subtask.id}:`, error);
        }
      } else {
         logger.debug(`JobTracker not available, skipping progress update (10%) for subtask ${subtask.id}`);
      }
      
      // Gather context from dependencies
      let dependencyContext = '';
      for (const depId of subtask.dependencies) {
        const depResult = results.get(depId);
        if (depResult) {
          const depSubtask = decomposedTask.subtasks.find(s => s.id === depId);
          if (depSubtask) {
            logger.info(`Including dependency ${depId} for subtask ${subtask.id}`);
            dependencyContext += `--- From dependency: ${depSubtask.description} ---\n\n`;
            dependencyContext += depResult + '\n\n';
          }
        } else {
          logger.warn(`Missing dependency result for ${depId} (required by subtask ${subtask.id})`);
        }
      }
      
      // Update job progress (if job tracker is available)
      // Check if jobTracker is not null before using it
      if (jobTracker) {
        try {
          await jobTracker.updateJobProgress(subtask.id, 30); // Update to 30%
        } catch (error) {
          logger.warn(`Failed to update job progress for subtask ${subtask.id}:`, error);
        }
      } else {
         logger.debug(`JobTracker not available, skipping progress update (30%) for subtask ${subtask.id}`);
      }
      
      try {
        // Execute the subtask
        const result = await this.executeSubtask(subtask, model, dependencyContext, decomposedTask.originalTask); // Pass originalTask
        results.set(subtask.id, result);
        
        // Write the result to the subtask log file
        this.logSubtaskResult(subtask, model, result);
        
        // Mark job as completed (if job tracker is available)
        // Check if jobTracker is not null before using it
        if (jobTracker) {
          try {
            await jobTracker.completeJob(subtask.id, [result]);
          } catch (error) {
            logger.warn(`Failed to complete job for subtask ${subtask.id}:`, error);
          }
        } else {
           logger.debug(`JobTracker not available, skipping job completion for subtask ${subtask.id}`);
        }
      } catch (error) {
        // If execution fails, mark the job as failed (if job tracker is available)
        const errorMessage = error instanceof Error ? error.message : String(error);
        // Check if jobTracker is not null before using it
        if (jobTracker) {
          try {
            await jobTracker.failJob(subtask.id, errorMessage);
          } catch (trackerError) {
            logger.warn(`Failed to mark job as failed for subtask ${subtask.id}:`, trackerError);
          }
        } else {
           logger.debug(`JobTracker not available, skipping job failure marking for subtask ${subtask.id}`);
        }
        
        // Still set the result, but with the error message
        results.set(subtask.id, `Error executing subtask: ${errorMessage}`);
      }
      
      // Log progress
      const progressPercent = Math.round((completedCount / executionOrder.length) * 100);
      logger.info(`Progress: ${progressPercent}% (${completedCount}/${executionOrder.length} subtasks completed)`);
    }
    
    // Log summary of execution
    logger.info(`======= SUBTASK EXECUTION SUMMARY =======`);
    logger.info(`Total subtasks executed: ${completedCount}/${executionOrder.length}`);
    
    // Log model usage
    logger.info(`===== MODEL USAGE SUMMARY =====`);
    for (const [modelId, usage] of modelUsage.entries()) {
      logger.info(`Model ${modelId}: Used for ${usage.count} subtask(s): ${usage.subtasks.join(', ')}`);
    }
    
    return results;
  },
  
  /**
   * Helper function to integrate a small group of related subtasks.
   * 
   * @param subtasksToIntegrate List of subtasks to integrate.
   * @param subtaskResults Map containing results for these subtasks.
   * @param originalTask The original high-level task description.
   * @returns The integrated code snippet.
   */
  async integrateSubtasks(
    subtasksToIntegrate: CodeSubtask[],
    subtaskResults: Map<string, string>,
    originalTask: string
  ): Promise<string> {
    if (subtasksToIntegrate.length === 0) return '';
    if (subtasksToIntegrate.length === 1) return subtaskResults.get(subtasksToIntegrate[0].id) || '';

    logger.info(`Integrating ${subtasksToIntegrate.length} subtasks: ${subtasksToIntegrate.map(s => s.id).join(', ')}`);

    let integrationContext = `Original Task: ${originalTask}\n\nSubtasks to Integrate:\n`;
    for (const subtask of subtasksToIntegrate) {
      const result = subtaskResults.get(subtask.id);
      if (result) {
        integrationContext += `\n--- Subtask: ${subtask.description} (ID: ${subtask.id}) ---\n`;
        integrationContext += '```\n' + result + '\n```\n';
      }
    }

    const integrationPrompt = `You are an expert software developer tasked with integrating code components.
Given the original task and the following code snippets generated for specific subtasks, please integrate them into a single, coherent code block.
Ensure that functions call each other correctly, data flows appropriately, and the combined code addresses the integration requirements implied by the subtask descriptions and original task.

${integrationContext}

Please provide only the integrated code, without explanations or wrappers, unless the integration itself requires comments.`;

    // Model selection logic (similar to synthesizeFinalResult, maybe slightly smaller models are okay here)
    const modelsToTry = await this.selectModelsForIntegration(integrationContext.length);
    
    let integratedCode: string | null = null;
    let integrationModel: Model | null = null;

    for (const model of modelsToTry) {
      try {
        logger.debug(`Attempting integration step with model: ${model.id}`);
        let result;
        switch (model.provider) {
          case 'lm-studio':
            const lmId = model.id.startsWith('lm-studio:') ? model.id.substring(10) : model.id;
            result = await lmStudioModule.callLMStudioApi(lmId, integrationPrompt, 120000); // 2 min timeout
            break;
          case 'ollama':
            const olId = model.id.startsWith('ollama:') ? model.id.substring(7) : model.id;
            result = await ollamaModule.callOllamaApi(olId, integrationPrompt, 120000);
            break;
          default:
            result = await openRouterModule.callOpenRouterApi(model.id, integrationPrompt, 120000);
            break;
        }

        if (result.success && result.text) {
          // Basic validation: check if it's not empty and contains some code-like structure
          if (result.text.trim().length > 50 && result.text.includes('def ') || result.text.includes('class ') || result.text.includes('import ')) {
            integratedCode = result.text;
            integrationModel = model;
            logger.info(`Integration step successful with model ${model.id}`);
            break; // Success
          } else {
            logger.warn(`Model ${model.id} returned minimal or non-code content for integration.`);
          }
        } else {
          logger.warn(`Integration step failed with model ${model.id}: ${result.error || 'Unknown error'}`);
        }
      } catch (error) {
        logger.warn(`Error during integration step with model ${model.id}:`, error);
      }
    }

    if (!integratedCode) {
      logger.error(`Integration step failed for subtasks: ${subtasksToIntegrate.map(s => s.id).join(', ')}. Returning combined inputs.`);
      // Fallback: return the combined inputs if integration fails
      return subtasksToIntegrate.map(s => subtaskResults.get(s.id) || '').join('\n\n# --- End of Subtask ---\n\n');
    }

    return integratedCode;
  },

  /**
   * Helper to select models suitable for an integration step.
   * @param contextLength Estimated length of the context for the integration prompt.
   * @returns Array of models to try.
   */
  async selectModelsForIntegration(contextLength: number): Promise<Model[]> {
      const availableModels = await costMonitor.getAvailableModels();
      const freeModels = await costMonitor.getFreeModels();
      const allModels = [...freeModels, ...availableModels]; // Prioritize free models

      // Filter models that can handle the context length and are generally good at coding/instruct
      const suitableModels = allModels
        .filter(model => 
          (model.contextWindow || 4096) >= contextLength &&
          (model.id.toLowerCase().includes('code') || 
           model.id.toLowerCase().includes('instruct') || 
           model.id.toLowerCase().includes('opus') || // High capability models
           model.id.toLowerCase().includes('sonnet') ||
           model.id.toLowerCase().includes('gpt-4'))
        )
        .sort((a, b) => (b.contextWindow || 0) - (a.contextWindow || 0)); // Sort by context window

      // Limit the number of models to try for integration steps
      const modelsToTry = suitableModels.slice(0, 5); 

      if (modelsToTry.length === 0) {
          // Fallback if no suitable models found
          modelsToTry.push({
              id: 'gpt-3.5-turbo', name: 'GPT-3.5 Turbo', provider: 'openai',
              capabilities: { chat: true, completion: true }, costPerToken: { prompt: 0.000001, completion: 0.000002 }
          });
      }
      return modelsToTry;
  },

  /**
   * Synthesize final results after executing all subtasks using progressive integration.
   * 
   * @param decomposedTask The decomposed task.
   * @param subtaskResults The results from each subtask.
   * @param modelAssignments Map of subtask IDs to the models that executed them.
   * @returns Synthesized final result.
   */
  async synthesizeFinalResult(
    decomposedTask: DecomposedCodeTask,
    subtaskResults: Map<string, string>,
    modelAssignments?: Map<string, Model> 
  ): Promise<string> {
    logger.info(`======= STARTING PROGRESSIVE SYNTHESIS =======`);
    logger.info(`Original task: ${decomposedTask.originalTask}`);
    logger.info(`Number of subtask results: ${subtaskResults.size}`);

    const executionOrder = dependencyMapper.sortByExecutionOrder(decomposedTask);
    const integratedResults = new Map<string, string>(subtaskResults); // Start with raw results
    let finalIntegratedCode = '';
    let finalIntegrationModelId = 'N/A';

    if (executionOrder.length === 0) {
      logger.warn('No subtasks found in execution order for synthesis.');
      return '# Error: No subtasks were executed.';
    }
    
    if (executionOrder.length === 1) {
        // If only one subtask, return its result directly
        const singleSubtaskId = executionOrder[0].id;
        finalIntegratedCode = integratedResults.get(singleSubtaskId) || '';
        finalIntegrationModelId = modelAssignments?.get(singleSubtaskId)?.id || 'N/A';
        logger.info('Only one subtask, returning its result directly.');
    } else {
        // Process subtasks iteratively based on dependencies
        const processedSubtasks = new Set<string>();

        for (const currentSubtask of executionOrder) {
            if (processedSubtasks.has(currentSubtask.id)) {
                continue; // Already processed as part of an earlier integration
            }

            const dependencies = currentSubtask.dependencies || [];
            const relevantSubtaskIds = [currentSubtask.id, ...dependencies];
            
            // Filter to get only the subtasks relevant for this integration step
            const subtasksToIntegrate = decomposedTask.subtasks.filter(s => relevantSubtaskIds.includes(s.id));
            
            // Ensure we have results for all dependencies needed for this step
            const canIntegrate = dependencies.every(depId => integratedResults.has(depId));

            if (dependencies.length > 0 && canIntegrate) {
                logger.info(`Integrating subtask ${currentSubtask.id} with its dependencies: ${dependencies.join(', ')}`);
                
                // Create a temporary map with only the necessary results for this integration step
                const currentStepResults = new Map<string, string>();
                for (const id of relevantSubtaskIds) {
                    const result = integratedResults.get(id);
                    if (result) {
                        currentStepResults.set(id, result);
                    } else {
                        logger.warn(`Missing result for subtask ${id} during integration step for ${currentSubtask.id}`);
                        // Handle missing dependency result - maybe skip integration or use placeholder?
                        // For now, we'll proceed but the integration might be incomplete.
                    }
                }

                // Call the integration helper
                const integratedCode = await this.integrateSubtasks(
                    subtasksToIntegrate,
                    currentStepResults, // Pass only the relevant results
                    decomposedTask.originalTask
                );

                // Store the integrated result, replacing the individual components used
                integratedResults.set(currentSubtask.id, integratedCode); 
                // Mark dependencies as processed within this integration context
                dependencies.forEach(depId => processedSubtasks.add(depId)); 
                
                // The result for the current subtask now represents the integrated whole
                finalIntegratedCode = integratedCode; 
                // TODO: Track the model used for *this specific* integration step if needed for detailed attribution
                // For now, we'll capture the last model used in the final step
                // finalIntegrationModelId = integrationModel?.id || 'N/A'; 

            } else if (dependencies.length === 0) {
                 // Leaf node or task with no dependencies yet, its result is its current state
                 finalIntegratedCode = integratedResults.get(currentSubtask.id) || '';
                 logger.debug(`Subtask ${currentSubtask.id} is a leaf node or has no processed dependencies yet.`);
            } else {
                logger.warn(`Cannot integrate subtask ${currentSubtask.id} yet, missing results for dependencies: ${dependencies.filter(d => !integratedResults.has(d)).join(', ')}`);
                // Keep its individual result for now, might be integrated later if another task depends on it
                finalIntegratedCode = integratedResults.get(currentSubtask.id) || '';
            }
            processedSubtasks.add(currentSubtask.id);
        }
        
        // After the loop, the result associated with the last task(s) in the order *should* be the most complete
        // If there are multiple final tasks (parallel branches), we might need a final merge step.
        // For simplicity now, we assume the result of the last task in the order is the final one.
        const lastSubtaskId = executionOrder[executionOrder.length - 1].id;
        finalIntegratedCode = integratedResults.get(lastSubtaskId) || finalIntegratedCode; // Use the result of the last task
        // TODO: Need a better way to determine the *actual* final integration model
        finalIntegrationModelId = modelAssignments?.get(lastSubtaskId)?.id || 'FallbackModel'; 
    }

    // --- Final Output Formatting --- 
    try {
      // Basic check if the final code seems valid
      if (!finalIntegratedCode || finalIntegratedCode.trim().length < 100) {
          logger.warn('Progressive integration resulted in minimal or empty code. Returning combined raw results.');
          // Fallback to combined raw results if integration failed badly
          let combinedRawResults = `# Results for coding task: ${decomposedTask.originalTask}\n\n## Note: Progressive integration failed to produce a complete result. Raw subtask outputs below:\n\n`;
          for (const subtask of executionOrder) {
              const result = subtaskResults.get(subtask.id);
              if (result) {
                  const model = modelAssignments?.get(subtask.id);
                  const modelInfo = model ? ` (Generated by: ${model.id})` : '';
                  combinedRawResults += `## ${subtask.description}${modelInfo}\n\n`;
                  combinedRawResults += '```\n' + result + '\n```\n\n';
              }
          }
          return combinedRawResults;
      }

      // Format the final successful result
      const finalResultOutput = `# Results for coding task: ${decomposedTask.originalTask}\n\n## ${decomposedTask.originalTask}\n\n${finalIntegratedCode}\n\n---\n\n*Final integration step performed by model similar to: ${finalIntegrationModelId}*`;

      // Add model attribution section
      if (modelAssignments) {
          let attributionSection = '\n\n## Model Attribution\n\nThis solution was generated using multiple AI models:\n\n';
          attributionSection += '| Subtask | Model Used |\n| --- | --- |\n';
          for (const subtask of executionOrder) {
              const model = modelAssignments.get(subtask.id);
              if (model) {
                  attributionSection += `| ${subtask.description.substring(0, 50)}${subtask.description.length > 50 ? '...' : ''} | ${model.id} |\n`;
              }
          }
          // Add the final integration model info
          attributionSection += `| Final Integration | ${finalIntegrationModelId} |\n`;
          return finalResultOutput + attributionSection;
      }

      return finalResultOutput;

    } catch (error) {
      logger.error('Error during final synthesis formatting:', error);
      // Fallback if formatting fails
      return `# Error during final synthesis formatting\n\n${finalIntegratedCode || 'No code generated.'}`;
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
  },

  /**
   * Resolve any circular dependencies in subtasks
   * @param subtasks The subtasks to check for circular dependencies
   * @returns Subtasks with resolved dependencies
   */
  async resolveDependencyCycles(subtasks: CodeSubtask[]): Promise<CodeSubtask[]> {
    // Create a copy of subtasks to avoid modifying the original
    const resolvedSubtasks = [...subtasks];
    
    // Build a dependency graph
    const dependencyGraph = new Map<string, Set<string>>();
    
    // Initialize the graph with all subtask IDs
    for (const subtask of resolvedSubtasks) {
      dependencyGraph.set(subtask.id, new Set(subtask.dependencies));
    }
    
    // Check for circular dependencies
    const visited = new Set<string>();
    const recursionStack = new Set<string>();
    
    // Function to check for cycles starting from a node
    const hasCycle = (nodeId: string, path: string[] = []): boolean => {
      if (!dependencyGraph.has(nodeId)) {
        return false; // Node doesn't exist in graph
      }
      
      if (recursionStack.has(nodeId)) {
        logger.warn(`Detected circular dependency: ${path.join(' -> ')} -> ${nodeId}`);
        return true;
      }
      
      if (visited.has(nodeId)) {
        return false; // Already checked
      }
      
      visited.add(nodeId);
      recursionStack.add(nodeId);
      
      const dependencies = dependencyGraph.get(nodeId) || new Set<string>();
      
      for (const depId of dependencies) {
        if (hasCycle(depId, [...path, nodeId])) {
          return true;
        }
      }
      
      recursionStack.delete(nodeId);
      return false;
    };
    
    // Check each node for cycles
    for (const subtask of resolvedSubtasks) {
      recursionStack.clear(); // Reset for each root node
      if (hasCycle(subtask.id)) {
        // Found a cycle, need to resolve it
        logger.info(`Resolving circular dependency for subtask: ${subtask.id}`);
      }
    }
    
    // Resolve any cycles
    for (const subtask of resolvedSubtasks) {
      const dependencies = new Set<string>();
      
      // Only keep dependencies that won't create cycles
      for (const depId of subtask.dependencies) {
        // Test if adding this dependency would create a cycle
        dependencyGraph.get(subtask.id)?.delete(depId);
        recursionStack.clear();
        visited.clear();
        
        if (!hasCycle(subtask.id)) {
          // It's safe to add this dependency
          dependencies.add(depId);
          dependencyGraph.get(subtask.id)?.add(depId);
        } else {
          logger.warn(`Removed circular dependency: ${subtask.id} -> ${depId}`);
          // Keep the dependency graph consistent
          dependencyGraph.get(subtask.id)?.delete(depId);
        }
      }
      
      // Update the subtask with the filtered dependencies
      subtask.dependencies = Array.from(dependencies);
    }
    
    logger.info(`Resolved circular dependencies among ${resolvedSubtasks.length} subtasks`);
    return resolvedSubtasks;
  },
};
