import { extractKeyTerms } from './metrics.js';

/**
 * Evaluate the quality of a response
 */
export function evaluateQuality(task: string, response: string): number {
  // If the response is empty or only whitespace, return 0
  if (!response || response.trim().length === 0) {
    return 0;
  }

  // 1. Relevance - analyze if the response addresses the task
  const relevanceScore = calculateRelevanceScore(task, response);
  
  // 2. Completeness - analyze if the response is comprehensive
  const completenessScore = calculateCompletenessScore(task, response);
  
  // 3. Structure - analyze the formatting and structure of the response
  const structureScore = calculateStructureScore(task, response);
  
  // 4. Accuracy - analyze specific elements for accuracy
  const accuracyScore = calculateAccuracyScore(task, response);
  
  // 5. Content quality - analyze the quality of the content
  const contentQualityScore = calculateContentQualityScore(task, response);
  
  // Weight the scores according to their importance
  // Weights should add up to 1.0
  const weightedScore = 
    relevanceScore * 0.3 +
    completenessScore * 0.25 +
    structureScore * 0.15 +
    accuracyScore * 0.2 +
    contentQualityScore * 0.1;
  
  // Return normalized score between 0 and 1
  return Math.min(Math.max(weightedScore, 0), 1);
}

/**
 * Calculate how relevant the response is to the task
 */
export function calculateRelevanceScore(task: string, response: string): number {
  // Convert to lowercase for case-insensitive matching
  const taskLower = task.toLowerCase();
  const responseLower = response.toLowerCase();

  // Extract key terms from the task
  const keyTerms = extractKeyTerms(taskLower);
  
  // Count how many key terms appear in the response
  let matchedTerms = 0;
  for (const term of keyTerms) {
    if (responseLower.includes(term)) {
      matchedTerms++;
    }
  }
  
  // Calculate relevance as the ratio of matched terms to total terms
  const termMatchRatio = keyTerms.length > 0 ? matchedTerms / keyTerms.length : 0;
  
  // Check if the response directly addresses the task
  let directAddressingScore = 0;
  
  // Check for question-answer patterns
  if (taskLower.includes('?')) {
    if (responseLower.includes('yes') || 
        responseLower.includes('no') || 
        responseLower.includes('the answer is') ||
        responseLower.includes('to answer your question')) {
      directAddressingScore = 0.8;
    }
  }
  
  // Check for command-execution patterns
  if (taskLower.includes('explain') || 
      taskLower.includes('describe') || 
      taskLower.includes('list') ||
      taskLower.includes('provide')) {
    
    if (responseLower.includes('here is') || 
        responseLower.includes('below is') || 
        responseLower.includes('following is')) {
      directAddressingScore = 0.9;
    }
  }
  
  return Math.max(termMatchRatio * 0.7 + directAddressingScore * 0.3, 0.1);
}

/**
 * Calculate how comprehensive the response is
 */
export function calculateCompletenessScore(task: string, response: string): number {
  // Calculate completeness based on response length relative to task complexity
  const taskLower = task.toLowerCase();
  const responseLower = response.toLowerCase();
  
  // Estimate task complexity by length and question type markers
  let taskComplexity = Math.min(task.length / 300, 1); // Normalize based on length
  
  // Check for multiple questions or aspects to address
  const questionCount = (taskLower.match(/\?/g) || []).length;
  if (questionCount > 1) {
    taskComplexity += 0.2 * Math.min(questionCount, 5);
  }
  
  // Check for comprehensive request markers
  if (taskLower.includes('detailed') || 
      taskLower.includes('thorough') || 
      taskLower.includes('comprehensive') ||
      taskLower.includes('explain') ||
      taskLower.includes('elaborate')) {
    taskComplexity += 0.3;
  }
  
  // Check for specific list requests
  if (taskLower.includes('list') || 
      taskLower.includes('enumerate') || 
      taskLower.includes('steps')) {
    taskComplexity += 0.2;
  }
  
  // Calculate the expected response length based on task complexity
  const expectedMinLength = 100 + (taskComplexity * 500);
  
  // Compare actual response length to expected length
  const lengthScore = Math.min(response.length / expectedMinLength, 1.5);
  
  // Check for addressing multiple aspects
  const paragraphCount = (response.match(/\n\s*\n/g) || []).length + 1;
  const sectionScore = Math.min(paragraphCount / Math.max(questionCount, 1), 1.5);
  
  // Calculate completeness score
  const rawScore = (lengthScore * 0.6) + (sectionScore * 0.4);
  
  // Cap at 1.0 but allow minimum score based on length
  return Math.min(Math.max(rawScore, response.length / 1000), 1);
}

/**
 * Calculate how well-structured the response is
 */
export function calculateStructureScore(task: string, response: string): number {
  let structureScore = 0.5; // Default middle score
  
  // Check for paragraphs
  const paragraphs = response.split(/\n\s*\n/);
  if (paragraphs.length > 1) {
    structureScore += 0.1;
  }
  
  // Check for headings or sections
  const hasHeadings = /^#+\s.+|^[A-Z][A-Za-z\s]+:$/m.test(response);
  if (hasHeadings) {
    structureScore += 0.1;
  }
  
  // Check for bullet points or numbered lists
  const hasBullets = /^[\s-*•]|\d+\.\s/m.test(response);
  if (hasBullets) {
    structureScore += 0.1;
  }
  
  // Check for code blocks when needed
  const taskNeedsCode = /code|function|program|script|implement/i.test(task);
  const hasCodeBlocks = /```[\s\S]+?```|`[^`]+`/.test(response);
  
  if (taskNeedsCode && hasCodeBlocks) {
    structureScore += 0.2;
  } else if (taskNeedsCode && !hasCodeBlocks) {
    structureScore -= 0.3; // Penalize for missing code when requested
  }
  
  // Check for proper citation or reference if needed
  const needsCitation = /reference|cite|source|according to|research/i.test(task);
  const hasCitation = /according to|cited by|referenced in|\[\d+\]|[(\d+)]/i.test(response);
  
  if (needsCitation && hasCitation) {
    structureScore += 0.1;
  }
  
  // Normalize score between 0 and 1
  return Math.min(Math.max(structureScore, 0), 1);
}

/**
 * Calculate accuracy of specific elements in the response
 */
export function calculateAccuracyScore(task: string, response: string): number {
  // This is a complex metric that ideally would use embedding models
  // Here we'll implement a heuristic version
  
  let accuracyScore = 0.7; // Start with a reasonable default
  
  // Check for factual statements and hedging language
  const factualStatementsCount = (response.match(/is|are|was|were|will be|has been|have been/g) || []).length;
  const hedgingLanguageCount = (response.match(/might|maybe|perhaps|possibly|could|seems|appears|likely|unlikely|probably/g) || []).length;
  
  // If there are many factual statements with little hedging, it's either very accurate or overconfident
  if (factualStatementsCount > 10 && hedgingLanguageCount < 2) {
    // Could be overconfident, slightly reduce score
    accuracyScore -= 0.1;
  }
  
  // Check for self-contradictions
  if (response.includes("however") || response.includes("on the other hand") || response.includes("but ")) {
    // The presence of contrast markers is good for nuanced answers
    accuracyScore += 0.05;
  }
  
  // Check for error admissions or limitations
  if (response.toLowerCase().includes("i'm not sure") || 
      response.toLowerCase().includes("i don't know") || 
      response.toLowerCase().includes("it's important to note") || 
      response.toLowerCase().includes("limitation")) {
    // Honesty about limitations is good
    accuracyScore += 0.1;
  }
  
  // Check for specific technical accuracy indicators in code
  if (/```[\s\S]+?```/.test(response)) {
    const codeBlocks = response.match(/```[\s\S]+?```/g) || [];
    let codeScore = 0;
    
    for (const codeBlock of codeBlocks) {
      const code = codeBlock.replace(/```[\w]*\n/, '').replace(/```$/, '');
      
      // Check for basic syntax errors
      const unbalancedBraces = (code.match(/{/g) || []).length !== (code.match(/}/g) || []).length;
      const unbalancedParentheses = (code.match(/\(/g) || []).length !== (code.match(/\)/g) || []).length;
      const unbalancedBrackets = (code.match(/\[/g) || []).length !== (code.match(/\]/g) || []).length;
      
      if (unbalancedBraces || unbalancedParentheses || unbalancedBrackets) {
        codeScore -= 0.1;
      } else {
        codeScore += 0.1;
      }
      
      // Check for common patterns in good code
      if (code.includes("return ") || code.includes("function ")) {
        codeScore += 0.05;
      }
      
      // Check for error handling
      if (code.includes("try ") && code.includes("catch ")) {
        codeScore += 0.05;
      }
    }
    
    // Adjust accuracy score based on code quality
    accuracyScore += Math.min(Math.max(codeScore, -0.2), 0.2);
  }
  
  // Normalize score between 0 and 1
  return Math.min(Math.max(accuracyScore, 0), 1);
}

/**
 * Calculate the general quality of the content
 */
export function calculateContentQualityScore(task: string, response: string): number {
  let qualityScore = 0.6; // Start with a middle-range default
  
  // Check for overly generic or template-like responses
  const genericPhrases = [
    "i'd be happy to help",
    "i hope this helps",
    "let me know if you have any questions",
    "as an ai language model",
    "as requested"
  ];
  
  let genericCount = 0;
  for (const phrase of genericPhrases) {
    if (response.toLowerCase().includes(phrase)) {
      genericCount++;
    }
  }
  
  // Penalize for too many generic phrases
  qualityScore -= genericCount * 0.05;
  
  // Check for response variety
  const sentences = response.split(/[.!?]+\s+/);
  const uniqueSentenceStarts = new Set();
  
  for (const sentence of sentences) {
    if (sentence.length > 5) {
      const firstThreeWords = sentence.trim().split(/\s+/).slice(0, 3).join(' ').toLowerCase();
      uniqueSentenceStarts.add(firstThreeWords);
    }
  }
  
  // Reward for variety in sentence structure
  const sentenceVarietyRatio = sentences.length > 0 ? uniqueSentenceStarts.size / sentences.length : 0;
  qualityScore += sentenceVarietyRatio * 0.2;
  
  // Check for technical jargon when appropriate
  const technicalTask = /technical|code|program|algorithm|function|system|framework|architecture/i.test(task);
  const containsTechnicalTerms = /function|algorithm|method|framework|architecture|system|module|component|parameter/i.test(response);
  
  if (technicalTask && containsTechnicalTerms) {
    qualityScore += 0.1;
  } else if (technicalTask && !containsTechnicalTerms) {
    qualityScore -= 0.1;
  }
  
  // Check for informational density (ratio of non-stop words to total words)
  const words = response.split(/\s+/);
  const stopWords = ['a', 'an', 'the', 'and', 'but', 'or', 'for', 'nor', 'on', 'at', 'to', 'from', 'by'];
  let nonStopWordCount = 0;
  
  for (const word of words) {
    if (!stopWords.includes(word.toLowerCase())) {
      nonStopWordCount++;
    }
  }
  
  const informationalDensity = words.length > 0 ? nonStopWordCount / words.length : 0;
  qualityScore += (informationalDensity - 0.7) * 0.2; // Adjust based on difference from expected density
  
  // Normalize score between 0 and 1
  return Math.min(Math.max(qualityScore, 0), 1);
}