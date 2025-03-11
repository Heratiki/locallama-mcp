import { BenchmarkResult, BenchmarkSummary } from '../../../types/index.js';

/**
 * Generate a summary from benchmark results
 */
export function generateSummary(results: BenchmarkResult[]): BenchmarkSummary {
  if (results.length === 0) {
    throw new Error('No benchmark results to summarize');
  }
  
  // Initialize summary
  const summary: BenchmarkSummary = {
    taskCount: results.length,
    avgContextLength: 0,
    avgOutputLength: 0,
    avgComplexity: 0,
    local: {
      avgTimeTaken: 0,
      avgSuccessRate: 0,
      avgQualityScore: 0,
      totalTokenUsage: {
        prompt: 0,
        completion: 0,
        total: 0,
      },
    },
    paid: {
      avgTimeTaken: 0,
      avgSuccessRate: 0,
      avgQualityScore: 0,
      totalTokenUsage: {
        prompt: 0,
        completion: 0,
        total: 0,
      },
      totalCost: 0,
    },
    comparison: {
      timeRatio: 0,
      successRateDiff: 0,
      qualityScoreDiff: 0,
      costSavings: 0,
    },
    timestamp: new Date().toISOString(),
  };
  
  // Calculate averages and totals
  let totalContextLength = 0;
  let totalOutputLength = 0;
  let totalComplexity = 0;
  
  let totalLocalTimeTaken = 0;
  let totalLocalSuccessRate = 0;
  let totalLocalQualityScore = 0;
  
  let totalPaidTimeTaken = 0;
  let totalPaidSuccessRate = 0;
  let totalPaidQualityScore = 0;
  
  for (const result of results) {
    totalContextLength += result.contextLength;
    totalOutputLength += result.outputLength;
    totalComplexity += result.complexity;
    
    totalLocalTimeTaken += result.local.timeTaken;
    totalLocalSuccessRate += result.local.successRate;
    totalLocalQualityScore += result.local.qualityScore;
    
    summary.local.totalTokenUsage.prompt += result.local.tokenUsage.prompt;
    summary.local.totalTokenUsage.completion += result.local.tokenUsage.completion;
    summary.local.totalTokenUsage.total += result.local.tokenUsage.total;
    
    totalPaidTimeTaken += result.paid.timeTaken;
    totalPaidSuccessRate += result.paid.successRate;
    totalPaidQualityScore += result.paid.qualityScore;
    
    summary.paid.totalTokenUsage.prompt += result.paid.tokenUsage.prompt;
    summary.paid.totalTokenUsage.completion += result.paid.tokenUsage.completion;
    summary.paid.totalTokenUsage.total += result.paid.tokenUsage.total;
    
    summary.paid.totalCost += result.paid.cost;
  }
  
  // Calculate averages
  summary.avgContextLength = totalContextLength / results.length;
  summary.avgOutputLength = totalOutputLength / results.length;
  summary.avgComplexity = totalComplexity / results.length;
  
  summary.local.avgTimeTaken = totalLocalTimeTaken / results.length;
  summary.local.avgSuccessRate = totalLocalSuccessRate / results.length;
  summary.local.avgQualityScore = totalLocalQualityScore / results.length;
  
  summary.paid.avgTimeTaken = totalPaidTimeTaken / results.length;
  summary.paid.avgSuccessRate = totalPaidSuccessRate / results.length;
  summary.paid.avgQualityScore = totalPaidQualityScore / results.length;
  
  // Calculate comparisons
  summary.comparison.timeRatio = summary.local.avgTimeTaken / summary.paid.avgTimeTaken;
  summary.comparison.successRateDiff = summary.local.avgSuccessRate - summary.paid.avgSuccessRate;
  summary.comparison.qualityScoreDiff = summary.local.avgQualityScore - summary.paid.avgQualityScore;
  summary.comparison.costSavings = summary.paid.totalCost;
  
  return summary;
}