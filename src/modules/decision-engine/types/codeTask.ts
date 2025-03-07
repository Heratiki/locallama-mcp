/**
 * Types for code task analysis and decomposition
 */

/**
 * Represents a subtask created from decomposing a complex code task
 */
export interface CodeSubtask {
  /** Unique identifier for the subtask */
  id: string;
  
  /** The description of the subtask */
  description: string;
  
  /** Estimated complexity of the subtask (0-1) */
  complexity: number;
  
  /** Estimated token count required for the subtask */
  estimatedTokens: number;
  
  /** Actual token count of the subtask */
  tokenCount?: number;
  
  /** Dependencies on other subtasks (by ID) */
  dependencies: string[];
  
  /** Code structure type (class, function, method, etc.) */
  codeType: 'class' | 'function' | 'method' | 'interface' | 'type' | 'module' | 'test' | 'other';
  
  /** Recommended model size category for this subtask */
  recommendedModelSize: 'small' | 'medium' | 'large' | 'remote';
}

/**
 * Represents a decomposed code task with subtasks
 */
export interface DecomposedCodeTask {
  /** Original task description */
  originalTask: string;
  
  /** List of subtasks */
  subtasks: CodeSubtask[];
  
  /** Overall estimated tokens required */
  totalEstimatedTokens: number;
  
  /** Any additional context or metadata */
  context?: Record<string, any>;
  
  /** Dependencies between components as adjacency list */
  dependencyMap: Record<string, string[]>;
}

/**
 * Options for code task analysis
 */
export interface CodeTaskAnalysisOptions {
  /** Maximum number of subtasks to create */
  maxSubtasks?: number;
  
  /** Preferred granularity of subtasks */
  granularity?: 'fine' | 'medium' | 'coarse';
  
  /** Whether to include test generation subtasks */
  includeTests?: boolean;
  
  /** Custom token budget per subtask */
  tokenBudgetPerSubtask?: number;
}

/**
 * Result of code task complexity analysis 
 */
export interface CodeComplexityResult {
  /** Overall complexity score (0-1) */
  overallComplexity: number;
  
  /** Factors contributing to complexity */
  factors: {
    /** Code algorithmic complexity */
    algorithmic: number;
    
    /** Integration complexity */
    integration: number;
    
    /** Domain knowledge requirements */
    domainKnowledge: number;
    
    /** Technical requirements */
    technical: number;
  };
  
  /** Any additional metrics */
  metrics?: Record<string, number>;
  
  /** Explanation of complexity analysis */
  explanation: string;
}

/**
 * Token usage for code tasks with caching
 */
export interface CodeTokenUsage {
  /** Total tokens in the prompt */
  promptTokens: number;
  
  /** Tokens in the completion */
  completionTokens: number;
  
  /** Cached tokens that were reused */
  cachedTokens: number;
  
  /** New tokens that weren't in the cache */
  newPromptTokens: number;
  
  /** Total tokens used */
  totalTokens: number;
}