import { logger } from '../../../utils/logger.js';
import { openRouterModule } from '../../openrouter/index.js';
import { costMonitor } from '../../cost-monitor/index.js';
import { 
  CodeTaskAnalysisOptions, 
  CodeComplexityResult, 
  DecomposedCodeTask, 
  CodeSubtask,
  IntegrationFactors,
  DomainFactors
} from '../types/codeTask.js';
import { v4 as uuidv4 } from 'uuid';
import { config } from '../../../config/index.js';
import { COMPLEXITY_THRESHOLDS } from '../types/index.js';
import { Model } from '../../../types/index.js';
import { lmStudioModule } from '../../lm-studio/index.js';

// Define a type for the raw subtask data parsed from the model response
type RawSubtask = {
  id?: string | number;
  description?: string;
  complexity?: number;
  estimatedTokens?: number;
  dependencies?: string[];
  codeType?: string;
  [key: string]: unknown; // Changed from any to unknown
};

// Helper function to check if an object has a subtasks array
function isSubtasksWrapper(obj: unknown): obj is { subtasks: RawSubtask[] } {
  return typeof obj === 'object' && obj !== null && 
         'subtasks' in obj && Array.isArray((obj as Record<string, unknown>).subtasks);
}

// Prompt for decomposing a task into subtasks
const DECOMPOSE_TASK_PROMPT = `
You are an expert software architect. Your task is to decompose a given coding task into smaller, manageable subtasks.
For each subtask, provide:
1. A unique UUID (use version 4 UUID format).
2. A clear, concise description of the subtask.
3. An estimated complexity score (0.0 to 1.0, where 1.0 is most complex).
4. The type of code artifact this subtask produces (e.g., function, class, component, module, test, documentation, configuration, other).
5. A list of dependencies, specified ONLY by the UUIDs of other subtasks it depends on. If a subtask has no dependencies, provide an empty list [].

**IMPORTANT**: When listing dependencies, you MUST use the exact UUID generated for the prerequisite subtask. Do NOT use the subtask description or any other name.

Task to decompose: {task}

Output the result as a JSON array of subtask objects. Example format:
[
  {
    "id": "uuid-generated-for-subtask-1",
    "description": "Subtask 1 description",
    "complexity": 0.5,
    "codeType": "function",
    "dependencies": [] 
  },
  {
    "id": "uuid-generated-for-subtask-2",
    "description": "Subtask 2 description",
    "complexity": 0.7,
    "codeType": "class",
    "dependencies": ["uuid-generated-for-subtask-1"] 
  }
]
`;

// Update COMPLEXITY_ANALYSIS_PROMPT to include more detailed integration analysis
const COMPLEXITY_ANALYSIS_PROMPT = `You are an expert in software development complexity analysis. 
Analyze the complexity of the following coding task:

Task: {task}

For this analysis:
1. Assess algorithmic complexity (simple loops vs complex algorithms)
2. Evaluate integration complexity considering:
   - Number of systems/components that need to interact
   - Data format transformations required
   - Communication protocols involved
   - State management complexity
   - Error handling across boundaries
3. Consider domain knowledge requirements
4. Evaluate technical requirements

For integration complexity specifically, consider:
- External system dependencies
- API integration points
- Data transformation requirements
- State synchronization needs
- Error handling complexity
- Transaction management
- Security requirements

Provide a detailed analysis with complexity scores (0-1 scale) for each factor, an overall complexity score, and a brief explanation.`;

/**
 * Service for analyzing and decomposing code tasks
 */
export const codeTaskAnalyzer = {
  /**
   * Decompose a complex code task into smaller, more manageable subtasks
   * 
   * @param task The code task to decompose
   * @param options Options for task decomposition
   * @returns A decomposed code task with subtasks
   */
  async decompose(
    task: string,
    options: CodeTaskAnalysisOptions = {}
  ): Promise<DecomposedCodeTask> {
    logger.debug('Decomposing code task:', task);
        
    try {
      // First, analyze the complexity to determine if decomposition is necessary
      const complexityResult = await this.analyzeComplexity(task);
      
      // For very simple tasks, we might not need decomposition
      if (complexityResult.overallComplexity < COMPLEXITY_THRESHOLDS.SIMPLE && 
          !options.maxSubtasks) {
        return {
          originalTask: task,
          subtasks: [{
            id: uuidv4(),
            description: task,
            complexity: complexityResult.overallComplexity,
            estimatedTokens: 1000, // Conservative estimate for simple tasks
            dependencies: [],
            codeType: 'other',
            recommendedModelSize: 'small'
          }],
          totalEstimatedTokens: 1000,
          dependencyMap: {},
          context: {
            complexityAnalysis: complexityResult
          }
        };
      }
      
      // Format the prompt with the task
      const prompt = DECOMPOSE_TASK_PROMPT.replace('{task}', task);
      
      // Try using OpenRouter first
      let response = null;
      let errorDetails = null;

      try {
        // For more complex tasks, use a model to decompose the task
        // Prefer free models for decomposition if they're capable enough
        let modelId = config.defaultLocalModel;
        let freeModels: Model[] = [];
        
        try {
          freeModels = await costMonitor.getFreeModels();
          if (freeModels.length > 0) {
            const suitableModels = freeModels.filter(model => 
              model.id.toLowerCase().includes('instruct') || 
              model.id.toLowerCase().includes('coder')
            );
            
            if (suitableModels.length > 0) {
              modelId = suitableModels[0].id;
              logger.debug(`Using free model ${modelId} for task decomposition`);
            }
          }
        } catch (error) {
          logger.debug('Error getting free models, falling back to default:', error);
        }
        
        const decompositionResult = await openRouterModule.callOpenRouterApi(
          modelId,
          prompt,
          60000 // 60 seconds timeout
        );
        
        if (!decompositionResult.success || !decompositionResult.text) {
          // Capture detailed error information for later logging
          const errorType = decompositionResult.error || 'unknown';
          const errorInstance = decompositionResult.errorInstance;
          const errorMessage = errorInstance ? errorInstance.message : 'Unknown error';
          errorDetails = {
            type: errorType,
            message: errorMessage,
            instance: errorInstance
          };
          
          logger.warn(`OpenRouter API failed for task decomposition: ${errorType} - ${errorMessage}`);
          throw new Error(`OpenRouter API failed: ${errorType}`);
        }
        
        response = decompositionResult.text;
        
      } catch (openRouterError) {
        // If OpenRouter failed, try LM-Studio as a fallback
        logger.info('OpenRouter decomposition failed, trying LM-Studio as fallback');
        
        try {
          if (config.lmStudioEndpoint) {
            // Check if LM-Studio is available by attempting to get models
            let lmStudioAvailable = false;
            try {
              const models = await lmStudioModule.getAvailableModels();
              lmStudioAvailable = models.length > 0;
            } catch (error) {
              logger.debug('LM-Studio availability check failed:', error);
            }
            
            if (lmStudioAvailable) {
              // Find a suitable model from LM-Studio
              const lmModels = await lmStudioModule.getAvailableModels();
              
              if (lmModels.length > 0) {
                // Try to find a coding-specific or instruction-following model
                const preferredModels = lmModels.filter(model => 
                  model.id.toLowerCase().includes('code') || 
                  model.id.toLowerCase().includes('instruct') ||
                  model.id.toLowerCase().includes('chat')
                );
                
                const selectedModel = preferredModels.length > 0 ? preferredModels[0] : lmModels[0];
                logger.info(`Using LM-Studio model ${selectedModel.id} for task decomposition`);
                
                // Call LM-Studio API using the callLMStudioApi method on the module
                const result = await lmStudioModule.callLMStudioApi(
                  selectedModel.id,
                  prompt,
                  60000 // 60 seconds timeout
                );
                
                if (result.success && result.text) {
                  logger.info('Successfully used LM-Studio for task decomposition');
                  response = result.text;
                } else {
                  // Log specific LM-Studio error
                  logger.error('LM-Studio fallback failed:', result.error || 'Unknown error');
                  
                  // If we have detailed error info from OpenRouter, log it for diagnostics
                  if (errorDetails) {
                    logger.error('Original OpenRouter error details:', errorDetails);
                    if (errorDetails.instance && errorDetails.instance.stack) {
                      logger.debug('OpenRouter error stack:', errorDetails.instance.stack);
                    }
                  }
                  
                  // Both OpenRouter and LM-Studio failed, throw combined error
                  throw new Error('Both OpenRouter and LM-Studio fallback failed for task decomposition');
                }
              } else {
                logger.error('No LM-Studio models available for fallback');
                throw new Error('No LM-Studio models available for fallback');
              }
            } else {
              logger.error('LM-Studio is not available for fallback');
              throw new Error('LM-Studio is not available for fallback');
            }
          } else {
            logger.error('LM-Studio endpoint not configured for fallback');
            throw new Error('LM-Studio endpoint not configured');
          }
        } catch (lmStudioError) {
          // Comprehensive error logging when both methods fail
          logger.error('All task decomposition methods failed:');
          
          // Log OpenRouter error details
          if (errorDetails) {
            logger.error(`OpenRouter error: ${errorDetails.type} - ${errorDetails.message}`);
            if (errorDetails.instance && errorDetails.instance.stack) {
              logger.debug('OpenRouter error stack:', errorDetails.instance.stack);
            }
          } else {
            logger.error('OpenRouter error:', openRouterError);
          }
          
          // Log LM-Studio error
          logger.error('LM-Studio error:', lmStudioError);
          
          // Re-throw with combined error message
          throw new Error('Both OpenRouter and LM-Studio failed for task decomposition');
        }
      }
      
      if (!response) {
        throw new Error('No valid response from any decomposition method');
      }
      
      // Parse the result, expecting a JSON structure
      const subtasksRaw = this.parseSubtasksFromResponse(response);
      
      // Process and validate subtasks
      const subtasks: CodeSubtask[] = subtasksRaw.map((subtask: RawSubtask) => ({
        id: typeof subtask.id === 'string' ? subtask.id : (typeof subtask.id === 'number' ? String(subtask.id) : uuidv4()),
        description: subtask.description || 'No description provided',
        complexity: Math.min(Math.max(subtask.complexity || 0.5, 0), 1), // Ensure within 0-1
        estimatedTokens: subtask.estimatedTokens ||
          Math.round(500 + (subtask.complexity || 0.5) * 1500), // Estimate based on complexity if not provided
        dependencies: subtask.dependencies || [],
        codeType: ((): CodeSubtask['codeType'] => {
          const type = subtask.codeType || 'other';
          if (['function', 'other', 'class', 'method', 'interface', 'type', 'module', 'test'].includes(type)) {
            return type as CodeSubtask['codeType'];
          }
          return 'other';
        })(),
        recommendedModelSize: this.determineRecommendedModelSize(subtask.complexity || 0.5)
      }));
      
      if (subtasks.length === 0) {
        logger.warn('Decomposition returned 0 subtasks. Creating fallback decomposition.');
        return this.createFallbackDecomposition(task);
      }

      // Generate dependency map
      const dependencyMap: Record<string, string[]> = {};
      subtasks.forEach(subtask => {
        const subtaskId = typeof subtask.id === 'string' ? subtask.id : String(subtask.id);
        dependencyMap[subtaskId] = subtask.dependencies;
      });
      
      // Calculate total estimated tokens
      const totalEstimatedTokens = subtasks.reduce(
        (sum, subtask) => sum + subtask.estimatedTokens, 
        0
      );
      
      return {
        originalTask: task,
        subtasks,
        totalEstimatedTokens,
        dependencyMap,
        context: {
          complexityAnalysis: complexityResult
        }
      };
    } catch (error) {
      // Additional error details for diagnostics
      if (error instanceof Error) {
        logger.error(`Error during code task decomposition: ${error.message}`);
        if (error.stack) {
          logger.debug(`Stack trace: ${error.stack}`);
        }
      } else {
        logger.error('Error during code task decomposition:', error);
      }
      
      // Fallback to a simple decomposition
      return this.createFallbackDecomposition(task);
    }
  },
  
  /**
   * Analyze the complexity of a code task
   * 
   * @param task The code task to analyze
   * @returns A complexity analysis result
   */
  async analyzeComplexity(task: string | undefined): Promise<CodeComplexityResult> {
    // Enhanced validation for undefined, null, or empty string task
    if (!task || task.trim() === '') {
      logger.warn('Task is undefined, null, or empty, returning default complexity.');
      return {
        overallComplexity: 0.5,
        factors: {
          algorithmic: 0.5,
          integration: 0.5,
          domainKnowledge: 0.5,
          technical: 0.5
        },
        explanation: 'Task was undefined, null, or empty, using default medium complexity.'
      };
    }

    logger.debug('Analyzing complexity of code task:', task);

    try {
      // Get detailed integration and domain factors
      
      const integrationFactors = await evaluateIntegrationFactors(task);
      const domainFactors = await evaluateDomainKnowledge(task);
      const technicalFactors = await evaluateTechnicalRequirements(task);
      
      const avgIntegrationComplexity = (Object.values(integrationFactors) as number[])
        .reduce((sum, val) => sum + val, 0) / Object.keys(integrationFactors).length;
      
      const avgDomainComplexity = (Object.values(domainFactors) as number[])
        .reduce((sum, val) => sum + val, 0) / Object.keys(domainFactors).length;
        
      const avgTechnicalComplexity = Object.values(technicalFactors)
        .reduce((sum, val) => sum + val, 0) / Object.keys(technicalFactors).length;
        
      const prompt = COMPLEXITY_ANALYSIS_PROMPT.replace('{task}', task);
      
      // Try to use a free model for complexity analysis
      let modelId = config.defaultLocalModel;
      let freeModels: Model[] = [];
      
      try {
        freeModels = await costMonitor.getFreeModels();
        if (freeModels.length > 0) {
          modelId = freeModels[0].id;
          logger.debug(`Using free model ${modelId} for complexity analysis`);
        } else {
          logger.warn('No free models available, falling back to default model');
        }
      } catch (error) {
        logger.debug('Error getting free models, falling back to default:', error);
      }
      
      // Initialize llmAnalysis with a default value
      let llmAnalysis: CodeComplexityResult = {
        overallComplexity: 0.5,
        factors: {
          algorithmic: 0.5,
          integration: avgIntegrationComplexity,
          domainKnowledge: avgDomainComplexity,
          technical: avgTechnicalComplexity
        },
        explanation: 'Default complexity analysis before model API call.'
      };
      
      // Add retry mechanism for OpenRouter API calls
      let retryCount = 0;
      const maxRetries = 2;
      let lastError: Error | null = null;
      
      while (retryCount <= maxRetries) {
        try {
          logger.debug(`Attempt ${retryCount + 1}/${maxRetries + 1} to call model API for complexity analysis`);
          
          const result = await openRouterModule.callOpenRouterApi(
            modelId,
            prompt,
            30000 // 30 seconds timeout
          );

          if (!result.success || !result.text) {
            // Check for specific error types to determine if retry is appropriate
            if (result.error && ['rate_limit', 'server_error'].includes(result.error)) {
              // These errors are retryable
              lastError = result.errorInstance || new Error(`API error: ${result.error}`);
              retryCount++;
              
              if (retryCount <= maxRetries) {
                // Try a different model if available on subsequent attempts
                if (freeModels.length > retryCount) {
                  modelId = freeModels[retryCount].id;
                  logger.debug(`Retrying with different model ${modelId}`);
                }
                
                // Wait before retrying (exponential backoff)
                const backoffTime = Math.min(1000 * Math.pow(2, retryCount), 8000);
                logger.debug(`Waiting ${backoffTime}ms before retry`);
                await new Promise(resolve => setTimeout(resolve, backoffTime));
                continue;
              }
            }
            
            // Non-retryable error or max retries exceeded
            logger.warn(`Model API failed for complexity analysis: ${result.error || 'Unknown error'}`);
            throw new Error(result.error ? `API error: ${result.error}` : 'API returned unsuccessful result');
          }

          // Successful response, parse it
          llmAnalysis = this.parseComplexityFromResponse(result.text);
          break; // Exit the retry loop on success
          
        } catch (apiError) {
          lastError = apiError instanceof Error ? apiError : new Error(String(apiError));
          retryCount++;
          
          if (retryCount <= maxRetries) {
            // Try a different model if available on subsequent attempts
            if (freeModels.length > retryCount) {
              modelId = freeModels[retryCount].id;
              logger.debug(`Retrying with different model ${modelId}`);
            }
            
            // Wait before retrying (exponential backoff)
            const backoffTime = Math.min(1000 * Math.pow(2, retryCount), 8000);
            logger.debug(`Waiting ${backoffTime}ms before retry`);
            await new Promise(resolve => setTimeout(resolve, backoffTime));
          } else {
            // Max retries exceeded, use pattern-based fallback
            break;
          }
        }
      }
      
      // If all retries failed, use pattern-based fallback
      if (retryCount > maxRetries || !llmAnalysis) {
        // Use pattern-based fallback if API call fails
        const errorMessage = lastError instanceof Error ? lastError.message : String(lastError);
        logger.warn(`Using pattern-based fallback for complexity analysis: ${errorMessage}`);
        
        // Calculate an algorithmic complexity based on keywords in the task
        const algorithmicPatterns = [
          /\b(algorithm|data structure|optimization|performance)\b/i,
          /\b(search|sort|traverse|iterate)\b/i,
          /\b(recursion|recursive|dynamic programming)\b/i,
          /\b(complexity|big o|performance|optimize)\b/i
        ];
        
        const algorithmicMatches = algorithmicPatterns.reduce((count, pattern) => 
          count + (pattern.test(task) ? 1 : 0), 0);
        
        const algorithmicComplexity = Math.min(
          algorithmicMatches / algorithmicPatterns.length + 0.3, 
          0.9
        );
        
        // Create a fallback complexity analysis
        llmAnalysis = {
          overallComplexity: Math.min(
            (algorithmicComplexity + avgIntegrationComplexity + 
             avgDomainComplexity + avgTechnicalComplexity) / 4 + 0.1,
            0.9
          ),
          factors: {
            algorithmic: algorithmicComplexity,
            integration: avgIntegrationComplexity,
            domainKnowledge: avgDomainComplexity,
            technical: avgTechnicalComplexity
          },
          explanation: `Complexity assessed using pattern-based analysis: algorithmic=${algorithmicComplexity.toFixed(2)}, integration=${avgIntegrationComplexity.toFixed(2)}, domain=${avgDomainComplexity.toFixed(2)}, technical=${avgTechnicalComplexity.toFixed(2)}`
        };
      }
      
      // Calculate overall domain knowledge score
      const domainKnowledgeScore = Math.max(
        llmAnalysis.factors.domainKnowledge,
        avgDomainComplexity
      );
      
      // Calculate overall technical requirements score
      const technicalRequirementsScore = Math.max(
        llmAnalysis.factors.technical,
        avgTechnicalComplexity
      );

      // Combine LLM analysis with pattern-based analysis
      return {
        ...llmAnalysis,
        factors: {
          ...llmAnalysis.factors,
          integration: Math.max(llmAnalysis.factors.integration, avgIntegrationComplexity),
          domainKnowledge: domainKnowledgeScore,
          technical: technicalRequirementsScore
        },
        metrics: {
          ...llmAnalysis.metrics,
          integrationFactors,
          domainFactors,
          technicalFactors,
          ...llmAnalysis.metrics?.criticalPath ? { criticalPath: llmAnalysis.metrics.criticalPath } : {}
        }
      };
    } catch (error) {
      logger.error('Error during code complexity analysis:', error);
      return {
        overallComplexity: 0.5,
        factors: {
          algorithmic: 0.5,
          integration: 0.5,
          domainKnowledge: 0.5,
          technical: 0.5
        },
        explanation: `Failed to analyze complexity: ${error instanceof Error ? error.message : 'Unknown error'}`
      };
    }
  },
  
  /**
   * Parse subtasks from the model response
   *
   * @param response The model's response text
   * @returns An array of parsed subtasks
   */
  parseSubtasksFromResponse(response: string): RawSubtask[] {
    try {
      // First attempt: try to extract a structured JSON array using more flexible pattern matching
      let jsonMatch = response.match(/```(?:json)?\s*([\s\S]*?)```/) || // Standard code block format
                     response.match(/\[\s*\{\s*"id"\s*:[\s\S]*\}\s*\]/); // Direct JSON array
      
      // If not found, look for any array-like structure
      if (!jsonMatch) {
        jsonMatch = response.match(/\[\s*\{[\s\S]*\}\s*\]/);
      }
      
      // If found a potential JSON match, try to parse it
      if (jsonMatch) {
        const jsonStr = jsonMatch[1] || jsonMatch[0];
        const cleanedJsonStr = jsonStr.trim()
          // Handle potential trailing commas which are invalid in JSON
          .replace(/,\s*}/g, '}')
          .replace(/,\s*\]/g, ']')
          // Fix potential missing quotes around keys
          .replace(/(\s*)(\w+)(\s*):/g, '$1"$2"$3:');
          
        try {
          logger.debug('Attempting to parse JSON subtasks:', cleanedJsonStr.substring(0, 100) + '...');
          
          const parsed: unknown = JSON.parse(cleanedJsonStr);
          
          // More flexible validation of the parsed structure
          if (Array.isArray(parsed) && parsed.length > 0) {
            // Direct array of subtasks
            logger.debug(`Successfully parsed JSON array with ${parsed.length} subtasks`);
            
            // Apply processing to each subtask
            return parsed.map(this.processParsedSubtask);
          } else if (
            typeof parsed === 'object' && 
            parsed !== null && 
            'subtasks' in parsed && 
            Array.isArray((parsed as Record<string, unknown>).subtasks)
          ) {
            // Wrapped subtasks array
            const subtasks = (parsed as Record<string, unknown>).subtasks as unknown[];
            logger.debug(`Successfully parsed wrapped JSON with ${subtasks.length} subtasks`);
            
            return subtasks.map(this.processParsedSubtask);
          } else if (typeof parsed === 'object' && parsed !== null) {
            // Single subtask object
            logger.debug('Successfully parsed single subtask object');
            return [this.processParsedSubtask(parsed)];
          }
          
          logger.warn('JSON does not match expected subtasks format, falling back to heuristic parsing');
        } catch (jsonError: unknown) {
          const errorMessage = jsonError instanceof Error ? jsonError.message : String(jsonError);
          logger.warn(`Failed to parse JSON: ${errorMessage}, falling back to heuristic parsing`);
        }
      }
      
      // Second attempt: use enhanced heuristic parsing if JSON extraction fails
      logger.debug('Using heuristic parsing for subtasks');
      
      // Try to identify subtask sections using various markers
      const subtaskSections = this.extractSubtaskSections(response);
      
      if (subtaskSections.length > 0) {
        logger.debug(`Found ${subtaskSections.length} subtask sections using heuristics`);
        
        // Parse each subtask section
        return subtaskSections.map((section, index) => {
          const parsed = this.parseSubtaskSection(section, index);
          logger.debug(`Parsed subtask ${index + 1}: ${parsed.description?.substring(0, 30)}...`);
          return parsed;
        });
      }
      
      // Last resort: treat the entire response as a single subtask
      logger.warn('Could not parse multiple subtasks, treating entire response as a single subtask');
      return [{
        id: uuidv4(),
        description: 'Complete the entire task: ' + response.split('\n')[0].substring(0, 100),
        complexity: 0.7,
        estimatedTokens: 2000,
        dependencies: [],
        codeType: 'other'
      }];
    } catch (error) {
      logger.error('Error parsing subtasks from response:', error);
      // Return at least one subtask as a fallback
      return [{
        id: uuidv4(),
        description: 'Complete the original task',
        complexity: 0.7,
        estimatedTokens: 2000,
        dependencies: [],
        codeType: 'other'
      }];
    }
  },
  
  /**
   * Process a parsed subtask to ensure it has all required fields
   * 
   * @param subtask A raw subtask object from JSON parsing
   * @returns A processed subtask with all required fields
   */
  processParsedSubtask(subtask: unknown): RawSubtask {
    if (typeof subtask !== 'object' || subtask === null) {
      return {
        id: uuidv4(),
        description: 'Unknown subtask',
        complexity: 0.5,
        dependencies: [],
        codeType: 'other'
      };
    }
    
    const result = subtask as Record<string, unknown>;
    
    // Ensure the ID is in the right format
    if (!result.id || (typeof result.id !== 'string' && typeof result.id !== 'number')) {
      result.id = uuidv4();
    }
    
    // Ensure we have a description
    if (!result.description || typeof result.description !== 'string') {
      result.description = result.title && typeof result.title === 'string' 
        ? result.title 
        : 'Subtask ' + result.id;
    }
    
    // Validate complexity
    if (!result.complexity || typeof result.complexity !== 'number' || 
        result.complexity < 0 || result.complexity > 1) {
      result.complexity = 0.5;
    }
    
    // Ensure dependencies is an array
    if (!result.dependencies || !Array.isArray(result.dependencies)) {
      result.dependencies = [];
    }
    
    // Validate code type
    if (!result.codeType || typeof result.codeType !== 'string') {
      result.codeType = 'other';
    }
    
    return result as RawSubtask;
  },
  
  /**
   * Extract subtask sections from a text response using heuristics
   * 
   * @param response The model's response text
   * @returns Array of subtask section texts
   */
  extractSubtaskSections(response: string): string[] {
    // Try several pattern-matching approaches to identify subtasks
    
    // Look for numbered subtasks (1., 2., etc.)
    const numberedSections = response.split(/\n\s*\d+\.\s+/);
    if (numberedSections.length > 1) {
      return numberedSections.slice(1); // Skip the first element which is before first match
    }
    
    // Look for "Subtask 1:", "Task 1:", etc.
    const labeledSections = response.split(/\n\s*(?:Subtask|Task|Step)\s+\d+\s*(?::|\.)\s*/i);
    if (labeledSections.length > 1) {
      return labeledSections.slice(1);
    }
    
    // Look for sections separated by ## or ### headers
    const headeredSections = response.split(/\n\s*#{2,3}\s+[^\n]+\n/);
    if (headeredSections.length > 1) {
      // Check if these are actually subtask headers
      const headersText = response.match(/#{2,3}\s+[^\n]+/g) || [];
      if (headersText.some(h => /task|step|part/i.test(h))) {
        return headeredSections.slice(1);
      }
    }
    
    // Look for empty line separated sections that mention ID or dependencies
    const potentialSections = response.split(/\n\s*\n/);
    if (potentialSections.length > 1) {
      const filteredSections = potentialSections.filter(section => 
        /\b(?:id|dependencies?|complexity)\b/i.test(section)
      );
      if (filteredSections.length > 0) {
        return filteredSections;
      }
    }
    
    return [];
  },
  
  /**
   * Parse a subtask section using heuristics
   * 
   * @param section The text of a subtask section
   * @param index The index of this section in the array of sections
   * @returns A parsed subtask
   */
  parseSubtaskSection(section: string, index: number): RawSubtask {
    // Extract key properties using regex
    const idMatch = section.match(/(?:ID|Id|id):\s*([^,\n]+)/);
    const descMatch = section.match(/(?:Description|Title|Task):\s*([^\n]+)/i) || 
                      section.match(/^([^\n:]+)/);
    const complexityMatch = section.match(/Complexity:\s*(\d+(?:\.\d+)?)/i);
    const dependenciesMatch = section.match(/Dependencies:\s*([^\n]+)/i);
    const typeMatch = section.match(/(?:Type|CodeType):\s*([^\n,]+)/i);
    
    // Extract dependencies as an array
    let dependencies: string[] = [];
    if (dependenciesMatch) {
      // Handle different dependency formats
      if (/\[.*\]/.test(dependenciesMatch[1])) {
        // Try to parse as JSON array
        try {
          const depArray = JSON.parse(dependenciesMatch[1].replace(/'/g, '"'));
          if (Array.isArray(depArray)) {
            dependencies = depArray.map(d => String(d));
          }
        } catch {
          // If JSON parsing fails, split by commas
          dependencies = dependenciesMatch[1].replace(/[\[\]'"\s]/g, '').split(',');
        }
      } else {
        // Split by commas
        dependencies = dependenciesMatch[1].split(',').map(d => d.trim());
      }
      
      // Filter out empty dependencies
      dependencies = dependencies.filter(d => d.length > 0);
    }
    
    // Return the parsed subtask
    return {
      id: idMatch ? idMatch[1].trim() : uuidv4(),
      description: descMatch ? descMatch[1].trim() : `Subtask ${index + 1}`,
      complexity: complexityMatch ? Math.min(Math.max(parseFloat(complexityMatch[1]), 0), 1) : 0.5,
      estimatedTokens: 1000 + (index * 200), // Simple estimate based on order
      dependencies,
      codeType: typeMatch ? typeMatch[1].trim().toLowerCase() : 'other'
    };
  },
  
  /**
   * Parse complexity analysis from the model response
   * 
   * @param response The model's response text
   * @returns A complexity analysis result
   */
  parseComplexityFromResponse(response: string): CodeComplexityResult {
    try {
      // Safety check for empty or array responses
      if (!response || response.trim() === '' || 
          response.trim() === '[]' || response.trim() === '[{}]' ||
          response.trim() === '{}') {
        logger.warn(`Received empty or invalid complexity response: "${response}"`);
        return {
          overallComplexity: 0.5,
          factors: {
            algorithmic: 0.5,
            integration: 0.5,
            domainKnowledge: 0.5,
            technical: 0.5
          },
          explanation: 'Model returned empty or invalid complexity analysis.'
        };
      }

      // Try to extract JSON object first
      const jsonMatch = response.match(/```(?:json)?\s*([\s\S]*?)```/) || 
                        response.match(/\{[\s\S]*?\}/);
      
      if (jsonMatch) {
        const jsonStr = jsonMatch[1] || jsonMatch[0];
        
        // Add additional safety checks before parsing
        if (!jsonStr || jsonStr.trim() === '{}' || jsonStr.trim() === '[]' || jsonStr.trim() === '[{}]') {
          logger.warn(`Matched JSON is empty or invalid: "${jsonStr}"`);
          throw new Error('Empty or invalid JSON response');
        }
        
        let parsed: unknown;
        try {
          parsed = JSON.parse(jsonStr);
        } catch (jsonError) {
          logger.warn(`Failed to parse complexity JSON: ${jsonError instanceof Error ? jsonError.message : String(jsonError)}`);
          throw jsonError; // Re-throw to trigger fallback parsing
        }
        
        // Use type-safe validation with Record<string, unknown>
        if (
          typeof parsed === 'object' && parsed !== null
        ) {
          // Handle array responses (some models may wrap in an array)
          if (Array.isArray(parsed)) {
            if (parsed.length === 0) {
              throw new Error('Empty array in response');
            }
            
            // Try to use the first element if it's an object
            if (typeof parsed[0] === 'object' && parsed[0] !== null) {
              parsed = parsed[0];
            } else {
              throw new Error('Array does not contain valid complexity object');
            }
          }
          
          const candidate = parsed as Record<string, unknown>;
          
          // Validate required fields and their types
          if (
            typeof candidate.overallComplexity === 'number' &&
            typeof candidate.explanation === 'string' &&
            typeof candidate.factors === 'object' && candidate.factors !== null
          ) {
            // Validate factors structure
            const factors = candidate.factors as Record<string, unknown>;
            if (
              typeof factors.algorithmic === 'number' &&
              typeof factors.integration === 'number' &&
              typeof factors.domainKnowledge === 'number' &&
              typeof factors.technical === 'number'
            ) {
              // Only cast after thorough validation
              return parsed as CodeComplexityResult;
            }
          }
        }
        
        // If validation fails, continue to fallback parsing
      }
      
      // Fall back to heuristic parsing
      const overallMatch = response.match(/overall(?:\s+complexity)?(?:\s*score)?:\s*(\d+(?:\.\d+)?)/i);
      const algorithmicMatch = response.match(/algorithmic(?:\s+complexity)?(?:\s*score)?:\s*(\d+(?:\.\d+)?)/i);
      const integrationMatch = response.match(/integration(?:\s+complexity)?(?:\s*score)?:\s*(\d+(?:\.\d+)?)/i);
      const domainMatch = response.match(/domain(?:\s+knowledge)?(?:\s*score)?:\s*(\d+(?:\.\d+)?)/i);
      const technicalMatch = response.match(/technical(?:\s+requirements)?(?:\s*score)?:\s*(\d+(?:\.\d+)?)/i);
      
      return {
        overallComplexity: overallMatch ? parseFloat(overallMatch[1]) : 0.5,
        factors: {
          algorithmic: algorithmicMatch ? parseFloat(algorithmicMatch[1]) : 0.5,
          integration: integrationMatch ? parseFloat(integrationMatch[1]) : 0.5,
          domainKnowledge: domainMatch ? parseFloat(domainMatch[1]) : 0.5,
          technical: technicalMatch ? parseFloat(technicalMatch[1]) : 0.5
        },
        explanation: response.replace(/^.*?(Explanation|Analysis):/i, '').trim()
      };
    } catch (error) {
      logger.error('Error parsing complexity from response:', error);
      return {
        overallComplexity: 0.5,
        factors: {
          algorithmic: 0.5,
          integration: 0.5,
          domainKnowledge: 0.5,
          technical: 0.5
        },
        explanation: 'Failed to parse complexity analysis.'
      };
    }
  },
  
  /**
   * Determine the recommended model size for a subtask based on its complexity
   * 
   * @param complexity The complexity score (0-1)
   * @returns The recommended model size
   */
  determineRecommendedModelSize(complexity: number): 'small' | 'medium' | 'large' | 'remote' {
    if (complexity <= 0.3) return 'small';
    if (complexity <= 0.6) return 'medium';
    if (complexity <= 0.8) return 'large';
    return 'remote';
  },
  
  /**
   * Create a fallback decomposition if the normal decomposition fails
   * 
   * @param task The original task
   * @returns A basic decomposition
   */
  createFallbackDecomposition(task: string): DecomposedCodeTask {
    // Create a simple decomposition based on task length
    const words = task.split(/\s+/).length;
    
    if (words <= 20) {
      // Very simple task, no need to decompose
      return {
        originalTask: task,
        subtasks: [{
          id: uuidv4(),
          description: task,
          complexity: 0.3,
          estimatedTokens: 800,
          dependencies: [],
          codeType: 'other',
          recommendedModelSize: 'small'
        }],
        totalEstimatedTokens: 800,
        dependencyMap: {}
      };
    } else {
      // Break into planning and implementation subtasks
      const planningId = uuidv4();
      const implementationId = uuidv4();
      
      return {
        originalTask: task,
        subtasks: [
          {
            id: planningId,
            description: `Plan the approach for: ${task}`,
            complexity: 0.4,
            estimatedTokens: 1000,
            dependencies: [],
            codeType: 'other',
            recommendedModelSize: 'medium'
          },
          {
            id: implementationId,
            description: `Implement the solution for: ${task}`,
            complexity: 0.6,
            estimatedTokens: 1500,
            dependencies: [planningId],
            codeType: 'other',
            recommendedModelSize: 'large'
          }
        ],
        totalEstimatedTokens: 2500,
        dependencyMap: {
          [planningId]: [],
          [implementationId]: [planningId]
        }
      };
    }
  }
};

/**
 * Evaluate integration complexity factors in more detail
 * @param taskDescription The task description
 * @returns Detailed integration complexity factors
 */
// eslint-disable-next-line @typescript-eslint/require-await
async function evaluateIntegrationFactors(taskDescription: string): Promise<IntegrationFactors> {
  const patterns = {
    systemInteractions: [
      /api|integrate|connect|communicate|sync|external|service/i,
      /database|storage|cache|queue/i,
      /protocol|http|rest|graphql|grpc/i
    ],
    dataTransformations: [
      /transform|convert|parse|format|serialize|deserialize/i,
      /json|xml|csv|binary|protobuf/i,
      /mapping|schema|model|interface/i
    ],
    stateManagement: [
      /state|status|lifecycle|transaction/i,
      /concurrent|parallel|async|sync/i,
      /manage|control|maintain|track/i
    ],
    errorHandling: [
      /error|exception|fault|failure/i,
      /handle|catch|try|recover/i,
      /fallback|retry|timeout/i
    ],
    security: [
      /security|auth|identity|permission/i,
      /encrypt|decrypt|token|key/i,
      /validate|verify|protect/i
    ]
  } as const;

  const scores: IntegrationFactors = {
    systemInteractions: 0,
    dataTransformations: 0,
    stateManagement: 0,
    errorHandling: 0,
    security: 0
  };

  // Evaluate each factor based on pattern matching
  for (const [factor, patternList] of Object.entries(patterns)) {
    const matches = patternList.reduce((count: number, pattern) => {
      return count + (pattern.test(taskDescription) ? 1 : 0);
    }, 0);
    scores[factor as keyof IntegrationFactors] = Math.min(matches / patternList.length, 1);
  }

  return scores;
}

/**
 * Evaluate domain knowledge requirements for a task
 * @param taskDescription The task description to evaluate
 * @returns Domain knowledge evaluation scores
 */
// eslint-disable-next-line @typescript-eslint/require-await
async function evaluateDomainKnowledge(taskDescription: string): Promise<DomainFactors> {
  const patterns = {
    domainSpecificity: [
      /business( logic| rules?| process)/i,
      /domain[- ]specific|industry[- ]standard/i,
      /regulatory|compliance|legal/i,
      /(financial|medical|legal) (terms?|concepts?|rules?)/i
    ],
    technicalDepth: [
      /\b(architect|design pattern|framework)\b/i,
      /\b(optimization|performance|scaling)\b/i,
      /\b(algorithm|data structure)\b/i,
      /\b(security|authentication|authorization)\b/i
    ],
    learningCurve: [
      /\b(complex|complicated|advanced)\b/i,
      /\b(prerequisite|requires? knowledge)\b/i,
      /\b(specialized|expert|proficiency)\b/i,
      /\b(deep|thorough) understanding\b/i
    ],
    contextDependency: [
      /\b(context|environment|setup)\b/i,
      /\b(dependent|dependency|requires)\b/i,
      /\b(configuration|settings?|parameters?)\b/i,
      /\b(integration|interact|communicate)\b/i
    ],
    standardsCompliance: [
      /\b(standard|specification|protocol)\b/i,
      /\b(RFC|ISO|IEEE|API)\b/i,
      /\b(convention|guideline|best practice)\b/i,
      /\b(compatibility|compliant|adherence)\b/i
    ]
  } as const;

  const scores: DomainFactors = {
    domainSpecificity: 0,
    technicalDepth: 0,
    learningCurve: 0,
    contextDependency: 0,
    standardsCompliance: 0
  };

  // Evaluate each factor based on pattern matching and weight
  for (const [factor, patternList] of Object.entries(patterns)) {
    const matches = patternList.reduce((count: number, pattern) => {
      return count + (pattern.test(taskDescription) ? 1 : 0);
    }, 0);
    scores[factor as keyof DomainFactors] = Math.min(matches / patternList.length, 1);
  }

  return scores;
}

/**
 * Evaluate technical requirements complexity for a task
 * @param taskDescription The task description to evaluate
 * @returns Technical requirements evaluation scores
 */
// eslint-disable-next-line @typescript-eslint/require-await
async function evaluateTechnicalRequirements(taskDescription: string): Promise<Record<string, number>> {
  // Define patterns to recognize different technical requirement aspects
  const patterns = {
    infrastructureNeeds: [
      /\b(infrastructure|servers?|cloud|deployment|hosting)\b/i,
      /\b(containerization|docker|kubernetes|k8s|orchestration)\b/i,
      /\b(scaling|load balancing|high availability|failover)\b/i,
      /\b(network|bandwidth|latency|throughput)\b/i
    ],
    performanceRequirements: [
      /\b(performance|speed|fast|optimize|efficient)\b/i,
      /\b(realtime|low latency|high throughput)\b/i,
      /\b(response time|processing time|computation time)\b/i,
      /\b(benchmark|metrics|SLA|service level)\b/i
    ],
    securityCompliance: [
      /\b(security|authentication|authorization)\b/i,
      /\b(encryption|hashing|secure connection|ssl|tls)\b/i,
      /\b(compliance|GDPR|HIPAA|PCI|SOC|ISO)\b/i,
      /\b(audit|logging|monitoring|tracking)\b/i
    ],
    compatibilityConstraints: [
      /\b(compatibility|interoperable|cross-platform)\b/i,
      /\b(browser|device|mobile|responsive)\b/i,
      /\b(backward compatible|legacy|support|version)\b/i,
      /\b(integration|interfaces|APIs|protocols)\b/i
    ],
    scalabilityRequirements: [
      /\b(scalability|scale|growth|volume)\b/i,
      /\b(horizontal scaling|vertical scaling|auto-scaling)\b/i,
      /\b(concurrent|simultaneous|parallel|users)\b/i,
      /\b(load|traffic|spike|peak|capacity)\b/i
    ],
    testingRequirements: [
      /\b(testing|test suite|test cases|test coverage)\b/i,
      /\b(unit test|integration test|system test|e2e test)\b/i,
      /\b(QA|quality assurance|validation|verification)\b/i,
      /\b(CI\/CD|continuous integration|continuous delivery|continuous deployment)\b/i
    ]
  };

  const scores: Record<string, number> = {
    infrastructureNeeds: 0,
    performanceRequirements: 0,
    securityCompliance: 0,
    compatibilityConstraints: 0,
    scalabilityRequirements: 0,
    testingRequirements: 0
  };

  // Evaluate each technical factor based on pattern matching
  for (const [factor, patternList] of Object.entries(patterns)) {
    const matches = patternList.reduce((count: number, pattern) => {
      return count + (pattern.test(taskDescription) ? 1 : 0);
    }, 0);
    scores[factor] = Math.min(matches / patternList.length, 1);
  }

  // Add a weighted complexity score based on the number of technical requirements detected
  const requirementsDetected = Object.values(scores).filter(score => score > 0).length;
  scores.overallTechnicalComplexity = Math.min(requirementsDetected / Object.keys(scores).length * 1.5, 1);

  return scores;
}
