import { logger } from '../../../utils/logger.js';
import { openRouterModule } from '../../openrouter/index.js';
import { costMonitor } from '../../cost-monitor/index.js';
import { CodeEvaluationOptions, ModelCodeEvaluationResult } from '../types/index.js';

interface ModelEvaluation {
  qualityScore: number;
  explanation: string;
  isValid: boolean;
  suggestions?: string[];
  implementationIssues?: string[];
  alternativeSolutions?: string[];
}
function isModelEvaluation(obj: unknown): obj is ModelEvaluation {
  return (
    typeof obj === 'object' &&
    obj !== null &&
    'qualityScore' in obj && typeof (obj as ModelEvaluation).qualityScore === 'number' &&
    'explanation' in obj && typeof (obj as ModelEvaluation).explanation === 'string' &&
    'isValid' in obj && typeof (obj as ModelEvaluation).isValid === 'boolean'
  );
}


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
      /\\w+\\s*\\([^)]*\\)/.test(response); // Function calls
    
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
      const jsonMatch = result.text.match(/```json\\n([\\s\\S]*?)\\n```/) || 
                        result.text.match(/\\{[\\s\\S]*"qualityScore"[\\s\\S]*\\}/);
      
      if (jsonMatch) {
        // Parse JSON from the response
        const jsonStr = jsonMatch[1] || jsonMatch[0];
        let modelEvaluation: ModelEvaluation;
        try {
          const parsedEvaluation: unknown = JSON.parse(jsonStr);
          
          if (
            typeof parsedEvaluation === 'object' &&
            parsedEvaluation !== null &&
            typeof (parsedEvaluation as ModelEvaluation).qualityScore === 'number' &&
            typeof (parsedEvaluation as ModelEvaluation).explanation === 'string' &&
            typeof (parsedEvaluation as ModelEvaluation).isValid === 'boolean'
          ) {
            modelEvaluation = parsedEvaluation as ModelEvaluation;
          } else {
            throw new Error('Invalid model evaluation format');
          }
        } catch (error) {
          logger.error('Error parsing model evaluation response:', error);
          return {
            qualityScore: 0.5,
            explanation: 'Invalid model evaluation format',
            isValid: false,
            suggestions: [],
            implementationIssues: [],
            alternativeSolutions: []
          };
        }
322 |         return {
323 |           qualityScore: modelEvaluation.qualityScore,
324 |           explanation: modelEvaluation.explanation,
325 |           isValid: modelEvaluation.isValid,
326 |           suggestions: Array.isArray(modelEvaluation.suggestions) ? modelEvaluation.suggestions : [],
327 |           implementationIssues: Array.isArray(modelEvaluation.implementationIssues) ? modelEvaluation.implementationIssues : [],
328 |           alternativeSolutions: Array.isArray(modelEvaluation.alternativeSolutions) ? modelEvaluation.alternativeSolutions : []
329 |         };
330 |       } else {
331 |         // If no JSON found, extract information from the free text response
332 |         const qualityMatch = result.text.match(/quality\\s*(?:score|rating)?:\\s*(\\d+(?:\\.\\d+)?)/i) || 
333 |                             result.text.match(/score:\\s*(\\d+(?:\\.\\d+)?)/i) ||
334 |                             result.text.match(/rating:\\s*(\\d+(?:\\.\\d+)?)/i);
335 |         
336 |         const qualityScore = qualityMatch ? parseFloat(qualityMatch[1]) / 10 : 0.5;
337 |         
338 |         const validMatch = result.text.toLowerCase().includes('valid') || 
339 |                           result.text.toLowerCase().includes('correct') ||
340 |                           result.text.toLowerCase().includes('works');
341 |         
342 |         return {
343 |           qualityScore: Math.min(Math.max(qualityScore, 0), 1),
344 |           explanation: result.text,
345 |           isValid: validMatch,
346 |           suggestions: []
347 |         };
348 |       }
349 |     } catch (error) {
350 |       logger.error('Error parsing model evaluation response:', error);
351 |       
352 |       // Fall back to a simple quality assessment based on keywords
353 |       const text = result.text.toLowerCase();
354 |       let score = 0.5; // Default neutral score
355 |       
356 |       // Increase score based on positive keywords
357 |       if (text.includes('excellent') || text.includes('outstanding')) score += 0.3;
358 |       else if (text.includes('good') || text.includes('solid')) score += 0.2;
359 |       else if (text.includes('acceptable') || text.includes('adequate')) score += 0.1;
360 |       
361 |       // Decrease score based on negative keywords
362 |       if (text.includes('error') || text.includes('wrong')) score -= 0.2;
363 |       else if (text.includes('issue') || text.includes('problem')) score -= 0.1;
364 |       else if (text.includes('improve') || text.includes('could be better')) score -= 0.05;
365 |       
366 |       return {
367 |         qualityScore: Math.min(Math.max(score, 0), 1),
368 |         explanation: result.text,
369 |         isValid: score > 0.6,
370 |         suggestions: []
371 |       };
372 |     }
373 |   },
374 |   
375 |   /**
376 |    * Construct a prompt for code evaluation
377 |    * The prompt instructs the model on how to evaluate the code quality
378 |    */
379 |   constructCodeEvaluationPrompt(
380 |     task: string, 
381 |     response: string, 
382 |     taskType: string,
383 |     detailedAnalysis: boolean
384 |   ): string {
385 |     // Build a task-specific prompt
386 |     let taskSpecificGuidance = '';
387 |     if (taskType === 'factorial') {
388 |       taskSpecificGuidance = `
389 | For a factorial function implementation:
390 | - Check if it handles base cases (0 and 1) correctly
391 | - Verify if it uses recursion or iteration appropriately
392 | - Look for potential overflow issues with large inputs
393 | - Check for proper parameter validation
394 | `;
395 |     } else if (taskType === 'binary-search') {
396 |       taskSpecificGuidance = `
397 | For a binary search implementation:
398 | - Verify the algorithm correctly handles the middle element calculation
399 | - Check if it properly narrows the search range with left/right pointers
400 | - Ensure it correctly handles edge cases (empty array, element not found)
401 | - Verify the time complexity is logarithmic (O(log n))
402 | `;
403 |     }
404 |     
405 |     // Base prompt for code evaluation
406 |     const basePrompt = `You are a code quality evaluator. Analyze the following code that was written in response to the task provided.
407 | TASK DESCRIPTION:
408 | ${task}
409 | CODE TO EVALUATE:
410 | ${response}
411 | ${taskSpecificGuidance}
412 | Evaluate the code on the following criteria:
413 | 1. Correctness: Does the code correctly solve the given task?
414 | 2. Efficiency: Is the algorithm and implementation efficient?
415 | 3. Readability: Is the code well-structured and easy to understand?
416 | 4. Best practices: Does the code follow coding best practices?
417 | 5. Error handling: Does the code handle edge cases and errors appropriately?`;
418 |     // For basic evaluation, just request a score and brief explanation
419 |     if (!detailedAnalysis) {
420 |       return `${basePrompt}
421 | Provide your evaluation in the following JSON format:
422 | \`\`\`json
423 | {
424 |   "qualityScore": 0.0,  // A value between 0.0 and 1.0, with 1.0 being perfect
425 |   "explanation": "",    // Brief explanation of the score
426 |   "isValid": true       // Whether the code correctly solves the task
427 | }
428 | \`\`\`
429 | Keep your explanation concise. Focus on whether the code works as expected and any major issues.`;
430 |     }
431 |     
432 |     // For detailed analysis, request more comprehensive feedback
433 |     return `${basePrompt}
434 | Provide a detailed evaluation in the following JSON format:
435 | \`\`\`json
436 | {
437 |   "qualityScore": 0.0,  // A value between 0.0 and 1.0, with 1.0 being perfect
438 |   "explanation": "",    // Detailed explanation of your evaluation
439 |   "isValid": true,      // Whether the code correctly solves the task
440 |   "implementationIssues": [
441 |     // List specific issues or bugs in the implementation, if any
442 |   ],
443 |   "suggestions": [
444 |     // List specific suggestions for improvement
445 |   ],
446 |   "alternativeSolutions": [
447 |     // Optional: If there are better approaches, briefly describe them
448 |   ]
449 | }
450 | \`\`\`
451 | Be thorough in your analysis. If the solution is correct but could be improved, explain how.
452 | If there are bugs or edge cases not handled, identify them specifically.`;
453 |   },
454 |   
455 |   /**
456 |    * Check if a code evaluation needs model review based on the heuristic score
457 |    * This helps decide whether to recommend getting a second opinion from a model
458 |    */
459 |   needsModelReview(heuristicScore: number, codeLength: number): boolean {
460 |     // If the score is in the "uncertain" middle range, suggest model review
461 |     if (heuristicScore > 0.3 && heuristicScore < 0.7) {
462 |       return true;
463 |     }
464 |     
465 |     // For longer code snippets, our heuristics might be less reliable
466 |     if (codeLength > 500 && heuristicScore < 0.8) {
467 |       return true;
468 |     }
469 |     
470 |     // For very complex looking code, suggest model review
471 |     const isComplexLooking = codeLength > 300 && 
472 |                            (codeLength / 300 > heuristicScore);
473 |     
474 |     return isComplexLooking;
475 |   },
476 |   
477 |   /**
478 |    * Get validation options for questionable code
479 |    * This provides the user with options to validate code using a model
480 |    */
481 |   async getCodeValidationOptions(task: string, code: string): Promise<{
482 |     recommendModelCheck: boolean;
483 |     availableModels: { id: string; name: string; isFree: boolean }[];
484 |     explanation: string;
485 |   }> {
486 |     // Get initial heuristic score
487 |     const heuristicScore = await this.evaluateCodeQuality(task, code) as number;
488 |     
489 |     // Check if model review is recommended
490 |     const recommendModelCheck = this.needsModelReview(heuristicScore, code.length);
491 |     
492 |     // Get available models for code validation
493 |     const availableModels: { id: string; name: string; isFree: boolean }[] = [];
494 |     
495 |     // Try to get free models first
496 |     try {
497 |       const freeModels = await costMonitor.getFreeModels();
498 |       const codeCapableFreeModels = freeModels.filter(m => 
499 |         m.id.toLowerCase().includes('code') || 
500 |         m.id.toLowerCase().includes('coder') ||

[File truncated: showing 500 of 558 total lines. Use start_line and end_line if you need to read more.].
