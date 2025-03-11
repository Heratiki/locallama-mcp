/**
 * API Usage statistics
 */
export interface ApiUsage {
  /** The API identifier */
  api: string;
  
  /** Token usage statistics */
  tokenUsage: {
    /** Number of prompt tokens used */
    prompt: number;
    /** Number of completion tokens used */
    completion: number;
    /** Total number of tokens used */
    total: number;
  };
  
  /** Cost statistics */
  cost: {
    /** Cost of prompt tokens */
    prompt: number;
    /** Cost of completion tokens */
    completion: number;
    /** Total cost */
    total: number;
  };
  
  /** Timestamp of the usage data */
  timestamp: string;
}

/**
 * Model performance profile based on benchmark results
 */
export interface ModelPerformanceProfile {
  /** Quality score for simple tasks (0-1) */
  simpleTaskQuality: number;
  
  /** Quality score for medium complexity tasks (0-1) */
  mediumTaskQuality: number;
  
  /** Quality score for complex tasks (0-1) */
  complexTaskQuality: number;
  
  /** Average response time in milliseconds */
  avgResponseTime: number;
  
  /** Success rate (0-1) */
  successRate: number;
  
  /** Maximum context window size in tokens */
  contextWindow: number;
  
  /** Recommended complexity range [min, max] */
  recommendedComplexityRange: [number, number];
}

/**
 * Model information
 */
export interface Model {
  /** Unique identifier for the model */
  id: string;
  
  /** Human-readable name of the model */
  name: string;
  
  /** Provider of the model (e.g., 'openai', 'anthropic', 'local') */
  provider: string;
  
  /** Model capabilities */
  capabilities: {
    /** Whether the model supports chat */
    chat: boolean;
    /** Whether the model supports completion */
    completion: boolean;
  };
  
  /** Cost per token */
  costPerToken: {
    /** Cost per prompt token */
    prompt: number;
    /** Cost per completion token */
    completion: number;
  };
  
  /** Maximum context window size in tokens */
  contextWindow?: number;
}

/**
 * Cost estimate for a task
 */
export interface CostEstimate {
  /** Local LLM cost estimate */
  local: {
    /** Cost breakdown */
    cost: {
      /** Cost of prompt tokens */
      prompt: number;
      /** Cost of completion tokens */
      completion: number;
      /** Total cost */
      total: number;
      /** Currency of the cost */
      currency: string;
    };
    
    /** Token count */
    tokenCount: {
      /** Number of prompt tokens */
      prompt: number;
      /** Number of completion tokens */
      completion: number;
      /** Total number of tokens */
      total: number;
    };
  };
  
  /** Paid API cost estimate */
  paid: {
    /** Cost breakdown */
    cost: {
      /** Cost of prompt tokens */
      prompt: number;
      /** Cost of completion tokens */
      completion: number;
      /** Total cost */
      total: number;
      /** Currency of the cost */
      currency: string;
    };
    
    /** Token count */
    tokenCount: {
      /** Number of prompt tokens */
      prompt: number;
      /** Number of completion tokens */
      completion: number;
      /** Total number of tokens */
      total: number;
    };
  };
  
  /** Recommended provider based on cost and other factors */
  recommendation: 'local' | 'paid';
}

/**
 * Task routing decision
 */
export interface RoutingDecision {
  /** Whether to use a local LLM or a paid API */
  provider: 'local' | 'paid';
  
  /** The model to use */
  model: string;
  
  /** Factors that influenced the decision */
  factors: {
    /** Cost comparison */
    cost: {
      /** Local cost */
      local: number;
      /** Paid API cost */
      paid: number;
      /** Whether cost was a factor in the decision */
      wasFactor: boolean;
      /** Weight assigned to this factor */
      weight?: number;
    };
    
    /** Task complexity */
    complexity: {
      /** Complexity score (0-1) */
      score: number;
      /** Whether complexity was a factor in the decision */
      wasFactor: boolean;
      /** Weight assigned to this factor */
      weight?: number;
    };
    
    /** Token usage */
    tokenUsage: {
      /** Context length */
      contextLength: number;
      /** Expected output length */
      outputLength: number;
      /** Total tokens (context + output) */
      totalTokens?: number;
      /** Whether token usage was a factor in the decision */
      wasFactor: boolean;
      /** Weight assigned to this factor */
      weight?: number;
    };
    
    /** User priority */
    priority: {
      /** User's priority (speed, cost, quality) */
      value: 'speed' | 'cost' | 'quality';
      /** Whether priority was a factor in the decision */
      wasFactor: boolean;
      /** Weight assigned to this factor */
      weight?: number;
    };
    
    /** Context window limitations */
    contextWindow?: {
      /** Whether context window was a factor in the decision */
      wasFactor: boolean;
      /** Weight assigned to this factor */
      weight?: number;
    };
    
    /** Benchmark performance */
    benchmarkPerformance?: {
      /** Whether benchmark performance was a factor in the decision */
      wasFactor: boolean;
      /** Weight assigned to this factor */
      weight?: number;
    };
  };
  
  /** Confidence in the decision (0-1) */
  confidence: number;
  
  /** Explanation of the decision */
  explanation: string;
  
  /** Scores for each provider */
  scores?: {
    /** Score for local provider (0-1) */
    local: number;
    /** Score for paid provider (0-1) */
    paid: number;
  };
  
  /** Whether this was a preemptive decision (made without API calls) */
  preemptive?: boolean;
}

/**
 * Task routing parameters
 */
export interface TaskRoutingParams {
  /** The task to route */
  task: string;
  
  /** Context length in tokens */
  contextLength: number;
  
  /** Expected output length in tokens */
  expectedOutputLength: number;
  
  /** Task complexity (0-1) */
  complexity: number;
  
  /** User priority */
  priority: 'speed' | 'cost' | 'quality';
}

export interface ModelPerformanceData {
  avgResponseTime: number;
  qualityScore: number;
  tokenEfficiency?: number;
  systemResourceUsage?: number;
  memoryFootprint?: number;
  resourceHistory?: Array<{
    timestamp: number;
    cpuUsage: number;
    memoryUsage: number;
    responseTime: number;
  }>;
}

// Export benchmark types
export * from './benchmark.js';