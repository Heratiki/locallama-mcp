/**
 * Benchmark result for a single task
 */
export interface BenchmarkResult {
  /** Task identifier */
  taskId: string;
  
  /** Task description */
  task: string;
  
  /** Context length in tokens */
  contextLength: number;
  
  /** Output length in tokens */
  outputLength: number;
  
  /** Task complexity (0-1) */
  complexity: number;
  
  /** Local LLM performance */
  local: {
    /** Model used */
    model: string;
    
    /** Time taken in milliseconds */
    timeTaken: number;
    
    /** Success rate (0-1) */
    successRate: number;
    
    /** Quality score (0-1) */
    qualityScore: number;
    
    /** Token usage */
    tokenUsage: {
      /** Number of prompt tokens */
      prompt: number;
      /** Number of completion tokens */
      completion: number;
      /** Total number of tokens */
      total: number;
    };
    
    /** Model output text */
    output?: string;
  };
  
  /** Paid API performance */
  paid: {
    /** Model used */
    model: string;
    
    /** Time taken in milliseconds */
    timeTaken: number;
    
    /** Success rate (0-1) */
    successRate: number;
    
    /** Quality score (0-1) */
    qualityScore: number;
    
    /** Token usage */
    tokenUsage: {
      /** Number of prompt tokens */
      prompt: number;
      /** Number of completion tokens */
      completion: number;
      /** Total number of tokens */
      total: number;
    };
    
    /** Cost in USD */
    cost: number;
    
    /** Model output text */
    output?: string;
  };
  
  /** Timestamp of the benchmark */
  timestamp: string;
}

/**
 * Benchmark summary with aggregated statistics
 */
export interface BenchmarkSummary {
  /** Number of tasks benchmarked */
  taskCount: number;
  
  /** Average context length */
  avgContextLength: number;
  
  /** Average output length */
  avgOutputLength: number;
  
  /** Average complexity */
  avgComplexity: number;
  
  /** Local LLM performance */
  local: {
    /** Average time taken in milliseconds */
    avgTimeTaken: number;
    
    /** Average success rate (0-1) */
    avgSuccessRate: number;
    
    /** Average quality score (0-1) */
    avgQualityScore: number;
    
    /** Total token usage */
    totalTokenUsage: {
      /** Number of prompt tokens */
      prompt: number;
      /** Number of completion tokens */
      completion: number;
      /** Total number of tokens */
      total: number;
    };
  };
  
  /** Paid API performance */
  paid: {
    /** Average time taken in milliseconds */
    avgTimeTaken: number;
    
    /** Average success rate (0-1) */
    avgSuccessRate: number;
    
    /** Average quality score (0-1) */
    avgQualityScore: number;
    
    /** Total token usage */
    totalTokenUsage: {
      /** Number of prompt tokens */
      prompt: number;
      /** Number of completion tokens */
      completion: number;
      /** Total number of tokens */
      total: number;
    };
    
    /** Total cost in USD */
    totalCost: number;
  };
  
  /** Performance comparison */
  comparison: {
    /** Time difference ratio (local/paid) */
    timeRatio: number;
    
    /** Success rate difference (local - paid) */
    successRateDiff: number;
    
    /** Quality score difference (local - paid) */
    qualityScoreDiff: number;
    
    /** Cost savings using local LLM */
    costSavings: number;
  };
  
  /** Timestamp of the summary */
  timestamp: string;
}

/**
 * Benchmark task parameters
 */
export interface BenchmarkTaskParams {
  /** Task identifier */
  taskId: string;
  
  /** Task description */
  task: string;
  
  /** Context length in tokens */
  contextLength: number;
  
  /** Expected output length in tokens */
  expectedOutputLength: number;
  
  /** Task complexity (0-1) */
  complexity: number;
  
  /** Local model to use */
  localModel?: string;
  
  /** Paid model to use */
  paidModel?: string;
  
  /** Skip paid model benchmarking */
  skipPaidModel?: boolean;
}

/**
 * Benchmark configuration
 */
export interface BenchmarkConfig {
  /** Number of runs per task */
  runsPerTask: number;
  
  /** Whether to run tasks in parallel */
  parallel: boolean;
  
  /** Maximum number of parallel tasks */
  maxParallelTasks: number;
  
  /** Timeout for each task in milliseconds */
  taskTimeout: number;
  
  /** Whether to save results to disk */
  saveResults: boolean;
  
  /** Path to save results */
  resultsPath: string;
}