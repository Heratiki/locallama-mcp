/**
 * Types for the Cost Estimation module
 */

export interface ICostEstimator {
  /**
   * Estimate the cost for a task based on token count
   */
  estimateCost: (params: CostEstimationParams) => Promise<CostEstimationResult>;
  
  /**
   * Get list of free models that have no associated costs
   */
  getFreeModels: (forceUpdate?: boolean) => Promise<FreeModel[]>;
  
  /**
   * Get cost information for a specific model
   */
  getModelCosts: (modelId: string) => Promise<ModelCostInfo | null>;
}

export interface CostEstimationParams {
  /**
   * The length of the context in tokens
   */
  contextLength: number;
  
  /**
   * The expected length of the output in tokens
   */
  outputLength?: number;
  
  /**
   * The model to use for estimation (optional)
   */
  model?: string;
}

export interface CostEstimationResult {
  /**
   * Cost estimation for local models
   */
  local: ModelCostEstimate;
  
  /**
   * Cost estimation for paid API models
   */
  paid: ModelCostEstimate;
  
  /**
   * Cost estimation for free API models
   */
  free: ModelCostEstimate;
  
  /**
   * The most cost-effective option
   */
  recommendation: 'local' | 'paid' | 'free';
  
  /**
   * The threshold for cost confirmation
   */
  costThreshold: number;
  
  /**
   * Whether the cost exceeds the threshold
   */
  exceedsThreshold: boolean;
}

export interface ModelCostEstimate {
  /**
   * The estimated cost breakdown
   */
  cost: {
    /**
     * Cost for input tokens
     */
    input: number;
    
    /**
     * Cost for output tokens
     */
    output: number;
    
    /**
     * Total cost
     */
    total: number;
  };
  
  /**
   * The model used for the estimate
   */
  model: string;
  
  /**
   * The provider of the model
   */
  provider: string;
}

export interface FreeModel {
  /**
   * Model ID
   */
  id: string;
  
  /**
   * Model display name
   */
  name: string;
  
  /**
   * The provider of the model
   */
  provider: string;
  
  /**
   * Maximum context length in tokens
   */
  maxContextLength: number;
  
  /**
   * Whether the model has usage restrictions
   */
  hasRestrictions: boolean;
  
  /**
   * Usage restrictions description
   */
  restrictions?: string;
}

export interface ModelCostInfo {
  /**
   * Cost per 1K input tokens
   */
  inputCostPer1K: number;
  
  /**
   * Cost per 1K output tokens
   */
  outputCostPer1K: number;
  
  /**
   * Maximum context length
   */
  maxContextLength: number;
  
  /**
   * The provider of the model
   */
  provider: string;
}