// File path for storing model performance data
import { Model } from '../../../types/index.js';

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

// Complexity thresholds based on benchmark results
export const COMPLEXITY_THRESHOLDS = {
  SIMPLE: 0.3,  // Tasks below this are simple
  MEDIUM: 0.6,  // Tasks below this are medium complexity
  COMPLEX: 0.8  // Tasks below this are moderately complex, above are very complex
};

// Token thresholds based on benchmark results
export const TOKEN_THRESHOLDS = {
  SMALL: 500,   // Small context
  MEDIUM: 2000, // Medium context
  LARGE: 8000   // Large context
};