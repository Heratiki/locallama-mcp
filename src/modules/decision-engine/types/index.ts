// File path for storing model performance data
// import { Model } from '../../../types/index.js';

// Interface for model performance tracking
export interface ModelPerformanceData {
  id: string;
  name: string;
  provider: string; // 'openrouter', 'local', 'lm-studio', 'ollama', etc.
  lastSeen: string;
  contextWindow: number;
  successRate: number;
  qualityScore: number;
  avgResponseTime: number;
  complexityScore: number;
  lastBenchmarked: string;
  benchmarkCount: number;
  isFree: boolean; // Whether this is a free model
  resourceHistory?: Array<{ timestamp: number; tokenUsage: number; responseTime: number; success: boolean; cpuUsage?: number; memoryUsage?: number; }>;

}

// Interface for model performance analysis results
export interface ModelPerformanceAnalysis {
  averageSuccessRate: number;
  averageQualityScore: number;
  averageResponseTime: number;
  averageTokenEfficiency: number;
  averageResourceUsage: number;
  bestPerformingModels: string[];
}

// Interface for models database
export interface ModelsDatabase {
  models: Record<string, ModelPerformanceData>;
  lastUpdated: string;
}

// Interface for code evaluation options
export interface CodeEvaluationOptions {
  useModel?: boolean;          // Whether to use a model for evaluation
  modelId?: string;            // Specific model ID to use
  detailedAnalysis?: boolean;  // Whether to return detailed analysis
  timeoutMs?: number;          // Timeout in milliseconds
}

// Interface for code evaluation result from model
export interface ModelCodeEvaluationResult {
  qualityScore: number;
  explanation: string;
  suggestions?: string[];
  isValid: boolean;
  implementationIssues?: string[];
  alternativeSolutions?: string[];
}

// Complexity thresholds based on benchmark results.
// When LOCALLAMA_PROFILE=lightweight these are raised so the router keeps more
// tasks local and only escalates to paid APIs for genuinely very complex work.
const _isLightweight = process.env.LOCALLAMA_PROFILE === 'lightweight';

export const COMPLEXITY_THRESHOLDS = {
  SIMPLE: _isLightweight ? 0.4 : 0.3,  // Tasks below this are simple
  MEDIUM: _isLightweight ? 0.7 : 0.6,  // Tasks below this are medium complexity
  COMPLEX: _isLightweight ? 0.9 : 0.8, // Tasks below this are moderately complex, above are very complex
};

// Token thresholds based on benchmark results.
// In lightweight mode, LARGE is capped at 4 096 tokens to match the practical
// context window of small quantized models (e.g. qwen2.5-coder-1.5b at q4_K_M).
// Tasks exceeding this limit should be decomposed via codeTaskCoordinator or
// routed to a paid API — the local small model cannot fit them in context.
export const TOKEN_THRESHOLDS = {
  SMALL: 500,                         // Small context
  MEDIUM: 2000,                       // Medium context
  LARGE: _isLightweight ? 4096 : 8000, // Large context
};