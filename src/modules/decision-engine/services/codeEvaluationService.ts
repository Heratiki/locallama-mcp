import { logger } from '../../../utils/logger.js';
import { openRouterModule } from '../../openrouter/index.js';
import { costMonitor } from '../../cost-monitor/index.js';
import { CodeEvaluationOptions, ModelCodeEvaluationResult } from '../types/index.js';

/**
 * Code Evaluation Service
 * Handles evaluating code quality
 */
export const codeEvaluationService = {
  /**
   * Evaluate code quality based on various factors such as structure, correctness, and efficiency
   * This provides a more detailed evaluation than the simple codeCheck function
   * @param task The task description
   * @param response The model's response
   * @param taskType Optional type of task for more specific evaluation
   * @param options Optional evaluation options including model-based evaluation
   * @returns Quality score between 0 and 1, or extended result with model evaluation
   */
  async evaluateCodeQuality(
    task: string, 
    response: string, 
    taskType: 'factorial' | 'binary-search' | 'general' = 'general',
    options?: CodeEvaluationOptions
  ): Promise<number | { score: number; modelEvaluation?: ModelCodeEvaluationResult }> {
    logger.debug(`Evaluating code quality for task type: ${taskType}`);
    
    // First, perform our standard heuristic evaluation
    let score = 0;
    const responseLower = response.toLowerCase();
    
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
    
    // Task-specific checks
    if (taskType === 'factorial') {
      // Check for factorial implementation patterns
      const hasRecursion = (
        (response.includes('function factorial') || response.includes('def factorial')) &&
        response.includes('return') &&
        (response.includes('factorial(') || response.includes('factorial ('))
      );
      
      const hasIteration = (
        (response.includes('function factorial') || response.includes('def factorial')) &&
        (response.includes('for ') || response.includes('while ')) &&
        response.includes('return')
      );
      
      const hasMultiplication = 
        response.includes('*=') || 
        response.includes(' * ') ||
        response.includes('product') ||
        response.includes('result');
      
      const hasBaseCase = 
        response.includes('if') && 
        (response.includes('=== 0') || 
         response.includes('== 0') ||
         response.includes('=== 1') || 
         response.includes('== 1') ||
         response.includes('<= 1'));
      
      // Calculate factorial-specific score
      if (hasRecursion || hasIteration) {
        score += 0.4;
        if (hasMultiplication) score += 0.3;
        if (hasBaseCase) score += 0.3;
      }
    } else if (taskType === 'binary-search') {
      // Check for binary search implementation patterns
      const hasBinarySearch = 
        (response.includes('function binarySearch') || 
         response.includes('def binary_search') ||
         response.includes('def binarySearch'));
      
      const hasMidPoint = 
        response.includes('mid') || 
        response.includes('middle') ||
        response.includes('(left + right)') ||
        response.includes('(low + high)') ||
        response.includes('(start + end)');
      
      const hasComparisons = 
        (response.includes('if') && response.includes('else')) &&
        (response.includes('<') || response.includes('>') || 
         response.includes('==') || response.includes('==='));
      
      const hasArraySplitting = 
        response.includes('mid - 1') || 
        response.includes('mid + 1') ||
        response.includes('middle - 1') || 
        response.includes('middle + 1');
      
      const hasTimeComplexity = 
        responseLower.includes('o(log') ||
        responseLower.includes('logarithmic') ||
        responseLower.includes('time complexity');
      
      // Calculate binary search-specific score
      if (hasBinarySearch) {
        score += 0.2;
        if (hasMidPoint) score += 0.2;
        if (hasComparisons) score += 0.2;
        if (hasArraySplitting) score += 0.2;
        if (hasTimeComplexity) score += 0.2;
      }
    } else {
      // General code quality
      if (hasCode) score += 0.3;
      if (hasCodeBlocks) score += 0.2;
      if (hasProgrammingConstructs) score += 0.2;
      
      // Check for explanation
      const hasExplanation =
        response.includes('explanation') ||
        response.includes('explain') ||
        response.includes('works by') ||
        response.includes('algorithm') ||
        response.includes('complexity');
        
      if (hasExplanation) score += 0.15;
      
      // Check for code comments
      const hasComments =
        response.includes('//') ||
        response.includes('/*') ||
        response.includes('*/') ||
        response.includes('#') ||
        response.includes('"""') ||
        response.includes("'''");
        
      if (hasComments) score += 0.15;
    }
    
    // Penalize very short responses
    if (response.length < 100) {
      score *= (response.length / 100);
    }
    
    // Cap score between 0 and 1
    const heuristicScore = Math.min(1, Math.max(0, score));
    
    // If model-based evaluation is not requested, return the heuristic score
    if (!options?.useModel) {
      return heuristicScore;
    }
    
    // Otherwise, perform model-based evaluation
    try {
      const modelEvaluation = await this.evaluateCodeWithModel(
        task, 
        response, 
        taskType,
        options
      );
      
      // Combine heuristic score with model evaluation
      // We weight the model's opinion more heavily since it's likely more accurate
      const combinedScore = modelEvaluation.qualityScore * 0.7 + heuristicScore * 0.3;
      
      return { 
        score: combinedScore, 
        modelEvaluation 
      };
    } catch (error) {
      logger.error('Error during model-based code evaluation:', error);
      
      // Fall back to heuristic score if model evaluation fails
      return { 
        score: heuristicScore,
        modelEvaluation: {
          qualityScore: heuristicScore,
          explanation: 'Model-based evaluation failed, falling back to heuristic evaluation.',
          isValid: heuristicScore > 0.5
        }
      };
    }
  },
  
  /**
   * Use a model to evaluate code quality
   * This provides a more sophisticated evaluation than our heuristic approach
   * @param task The original task description
   * @param response The code to evaluate
   * @param taskType The type of task for specialized evaluation
   * @param options Options for model-based evaluation
   * @returns Detailed evaluation result from the model
   */
  async evaluateCodeWithModel(
    task: string,
    response: string,
    taskType: string,
    options?: CodeEvaluationOptions
  ): Promise<ModelCodeEvaluationResult> {
    // Default options
    const timeout = options?.timeoutMs || 30000; // 30 seconds default
    
    // Choose a model for evaluation
    // If a specific model is requested, use that, otherwise pick a suitable one
    let modelId = options?.modelId;
    if (!modelId) {
      // Try to get a free model first
      try {
        const freeModels = await costMonitor.getFreeModels();
        if (freeModels.length > 0) {
          // Find a suitable free model - prefer ones specialized for code
          const codeModels = freeModels.filter(m => 
            m.id.toLowerCase().includes('code') || 
            m.id.toLowerCase().includes('starcoder') ||
            m.id.toLowerCase().includes('coder') ||
            m.id.toLowerCase().includes('deepseek')
          );
          
          if (codeModels.length > 0) {
            modelId = codeModels[0].id;
          } else {
            // If no code-specialized models, use any free model
            modelId = freeModels[0].id;
          }
        }
      } catch (error) {
        logger.debug('Error getting free models, falling back to default:', error);
      }
      
      // If we still don't have a model ID, use default paid models
      if (!modelId) {
        modelId = 'gpt-3.5-turbo'; // Default to GPT-3.5 for cost efficiency
      }
    }
    
    // Construct the prompt for code evaluation
    const detailedAnalysis = options?.detailedAnalysis ?? false;
    const evaluationPrompt = this.constructCodeEvaluationPrompt(task, response, taskType, detailedAnalysis);
    
    // Call the model using OpenRouter
    const result = await openRouterModule.callOpenRouterApi(
      modelId,
      evaluationPrompt,
      timeout
    );
    
    if (!result.success || !result.text) {
      throw new Error(`Model evaluation failed: ${result.error}`);
    }
    
    // Parse the model's response
    try {
      // First, check if the response contains a JSON object
      const jsonMatch = result.text.match(/```json\n([\s\S]*?)\n```/) || 
                        result.text.match(/\{[\s\S]*"qualityScore"[\s\S]*\}/);
      
      if (jsonMatch) {
        // Parse JSON from the response
        const jsonStr = jsonMatch[1] || jsonMatch[0];
        const evaluation = JSON.parse(jsonStr);
        
        // Ensure the evaluation has the expected structure
        return {
          qualityScore: parseFloat(evaluation.qualityScore) || 0.5,
          explanation: evaluation.explanation || 'No explanation provided',
          isValid: evaluation.isValid ?? (parseFloat(evaluation.qualityScore) > 0.6),
          suggestions: evaluation.suggestions || [],
          implementationIssues: evaluation.implementationIssues || [],
          alternativeSolutions: evaluation.alternativeSolutions || []
        };
      } else {
        // If no JSON found, extract information from the free text response
        const qualityMatch = result.text.match(/quality\s*(?:score|rating)?:\s*(\d+(?:\.\d+)?)/i) || 
                            result.text.match(/score:\s*(\d+(?:\.\d+)?)/i) ||
                            result.text.match(/rating:\s*(\d+(?:\.\d+)?)/i);
        
        const qualityScore = qualityMatch ? parseFloat(qualityMatch[1]) / 10 : 0.5;
        
        const validMatch = result.text.toLowerCase().includes('valid') || 
                          result.text.toLowerCase().includes('correct') ||
                          result.text.toLowerCase().includes('works');
        
        return {
          qualityScore: Math.min(Math.max(qualityScore, 0), 1),
          explanation: result.text,
          isValid: validMatch,
          suggestions: []
        };
      }
    } catch (error) {
      logger.error('Error parsing model evaluation response:', error);
      
      // Fall back to a simple quality assessment based on keywords
      const text = result.text.toLowerCase();
      let score = 0.5; // Default neutral score
      
      // Increase score based on positive keywords
      if (text.includes('excellent') || text.includes('outstanding')) score += 0.3;
      else if (text.includes('good') || text.includes('solid')) score += 0.2;
      else if (text.includes('acceptable') || text.includes('adequate')) score += 0.1;
      
      // Decrease score based on negative keywords
      if (text.includes('error') || text.includes('wrong')) score -= 0.2;
      else if (text.includes('issue') || text.includes('problem')) score -= 0.1;
      else if (text.includes('improve') || text.includes('could be better')) score -= 0.05;
      
      return {
        qualityScore: Math.min(Math.max(score, 0), 1),
        explanation: result.text,
        isValid: score > 0.6,
        suggestions: []
      };
    }
  },
  
  /**
   * Construct a prompt for code evaluation
   * The prompt instructs the model on how to evaluate the code quality
   */
  constructCodeEvaluationPrompt(
    task: string, 
    response: string, 
    taskType: string,
    detailedAnalysis: boolean
  ): string {
    // Build a task-specific prompt
    let taskSpecificGuidance = '';
    if (taskType === 'factorial') {
      taskSpecificGuidance = `
For a factorial function implementation:
- Check if it handles base cases (0 and 1) correctly
- Verify if it uses recursion or iteration appropriately
- Look for potential overflow issues with large inputs
- Check for proper parameter validation
`;
    } else if (taskType === 'binary-search') {
      taskSpecificGuidance = `
For a binary search implementation:
- Verify the algorithm correctly handles the middle element calculation
- Check if it properly narrows the search range with left/right pointers
- Ensure it correctly handles edge cases (empty array, element not found)
- Verify the time complexity is logarithmic (O(log n))
`;
    }
    
    // Base prompt for code evaluation
    const basePrompt = `You are a code quality evaluator. Analyze the following code that was written in response to the task provided.
TASK DESCRIPTION:
${task}
CODE TO EVALUATE:
${response}
${taskSpecificGuidance}
Evaluate the code on the following criteria:
1. Correctness: Does the code correctly solve the given task?
2. Efficiency: Is the algorithm and implementation efficient?
3. Readability: Is the code well-structured and easy to understand?
4. Best practices: Does the code follow coding best practices?
5. Error handling: Does the code handle edge cases and errors appropriately?`;
    // For basic evaluation, just request a score and brief explanation
    if (!detailedAnalysis) {
      return `${basePrompt}
Provide your evaluation in the following JSON format:
\`\`\`json
{
  "qualityScore": 0.0,  // A value between 0.0 and 1.0, with 1.0 being perfect
  "explanation": "",    // Brief explanation of the score
  "isValid": true       // Whether the code correctly solves the task
}
\`\`\`
Keep your explanation concise. Focus on whether the code works as expected and any major issues.`;
    }
    
    // For detailed analysis, request more comprehensive feedback
    return `${basePrompt}
Provide a detailed evaluation in the following JSON format:
\`\`\`json
{
  "qualityScore": 0.0,  // A value between 0.0 and 1.0, with 1.0 being perfect
  "explanation": "",    // Detailed explanation of your evaluation
  "isValid": true,      // Whether the code correctly solves the task
  "implementationIssues": [
    // List specific issues or bugs in the implementation, if any
  ],
  "suggestions": [
    // List specific suggestions for improvement
  ],
  "alternativeSolutions": [
    // Optional: If there are better approaches, briefly describe them
  ]
}
\`\`\`
Be thorough in your analysis. If the solution is correct but could be improved, explain how.
If there are bugs or edge cases not handled, identify them specifically.`;
  },
  
  /**
   * Check if a code evaluation needs model review based on the heuristic score
   * This helps decide whether to recommend getting a second opinion from a model
   */
  needsModelReview(heuristicScore: number, codeLength: number): boolean {
    // If the score is in the "uncertain" middle range, suggest model review
    if (heuristicScore > 0.3 && heuristicScore < 0.7) {
      return true;
    }
    
    // For longer code snippets, our heuristics might be less reliable
    if (codeLength > 500 && heuristicScore < 0.8) {
      return true;
    }
    
    // For very complex looking code, suggest model review
    const isComplexLooking = codeLength > 300 && 
                           (codeLength / 300 > heuristicScore);
    
    return isComplexLooking;
  },
  
  /**
   * Get validation options for questionable code
   * This provides the user with options to validate code using a model
   */
  async getCodeValidationOptions(task: string, code: string): Promise<{
    recommendModelCheck: boolean;
    availableModels: { id: string; name: string; isFree: boolean }[];
    explanation: string;
  }> {
    // Get initial heuristic score
    const heuristicScore = await this.evaluateCodeQuality(task, code) as number;
    
    // Check if model review is recommended
    const recommendModelCheck = this.needsModelReview(heuristicScore, code.length);
    
    // Get available models for code validation
    const availableModels: { id: string; name: string; isFree: boolean }[] = [];
    
    // Try to get free models first
    try {
      const freeModels = await costMonitor.getFreeModels();
      const codeCapableFreeModels = freeModels.filter(m => 
        m.id.toLowerCase().includes('code') || 
        m.id.toLowerCase().includes('coder') ||
        m.id.toLowerCase().includes('starcoder') ||
        m.id.toLowerCase().includes('deepseek')
      );
      
      // Add up to 3 code-capable free models
      if (codeCapableFreeModels.length > 0) {
        codeCapableFreeModels.slice(0, 3).forEach(model => {
          availableModels.push({
            id: model.id,
            name: model.name,
            isFree: true
          });
        });
      } 
      // If no code-specific free models, add some general free models
      else if (freeModels.length > 0) {
        freeModels.slice(0, 2).forEach(model => {
          availableModels.push({
            id: model.id,
            name: model.name,
            isFree: true
          });
        });
      }
    } catch (error) {
      logger.debug('Error getting free models for code validation:', error);
    }
    
    // Always add some standard paid models
    availableModels.push({
      id: 'gpt-3.5-turbo',
      name: 'GPT-3.5 Turbo',
      isFree: false
    });
    
    availableModels.push({
      id: 'gpt-4o',
      name: 'GPT-4o',
      isFree: false
    });
    
    // Generate explanation based on heuristic score
    let explanation = '';
    if (heuristicScore < 0.4) {
      explanation = `The code appears to have significant issues (score: ${(heuristicScore * 10).toFixed(1)}/10). A model review could help identify specific problems.`;
    } else if (heuristicScore < 0.7) {
      explanation = `The code quality is uncertain (score: ${(heuristicScore * 10).toFixed(1)}/10). A model review could provide more confidence about its correctness.`;
    } else {
      explanation = `The code seems generally good (score: ${(heuristicScore * 10).toFixed(1)}/10), but a model review could catch subtle issues or suggest optimizations.`;
    }
    
    return {
      recommendModelCheck,
      availableModels,
      explanation
    };
  }
};