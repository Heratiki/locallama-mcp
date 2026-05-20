import { logger } from '../../../utils/logger.js';
import { costMonitor } from '../../cost-monitor/index.js';
import { modelsDbService } from './modelsDb.js';
import { openRouterModule } from '../../openrouter/index.js';
import { Model } from '../../../types/index.js';
import { COMPLEXITY_THRESHOLDS } from '../types/index.js';
// import { modelProfiles } from '../utils/modelProfiles.js';
import { isOpenRouterConfigured } from '../../api-integration/tool-definition/index.js';
import { isProviderLocal } from '../../core/provider/index.js';
import { getModelRegistry } from '../../core/model/index.js';

function getTaskCategoryScore(modelId: string, taskCategory?: string): number | undefined {
  if (!taskCategory) return undefined;

  const scores = getModelRegistry().getModel(modelId)?.benchmarkSummary?.scores;
  if (!scores) return undefined;

  switch (taskCategory) {
    case 'code':
      return scores.code;
    case 'reasoning':
      return scores.reasoning;
    case 'speed':
      return scores.speed;
    default:
      return undefined;
  }
}

/**
 * Compute a size-based heuristic score for a local model.
 *
 * For complex tasks, larger models score higher; for simple tasks, smaller
 * models score higher (faster, fewer resources). Scores are calibrated so
 * that a large unbenchmarked model (e.g. 70B) outscores a small model (e.g.
 * 2B) with a single sparse benchmark run when confidence-blended (issue #50).
 */
function computeLocalModelHeuristicScore(modelId: string, complexity: number): number {
  // Normalise the model id for size-pattern matching.
  // Gemma 3n uses "e2b" / "e4b" (Efficient N-Billion) — treat them as
  // equivalent to plain "2b" / "4b" for scoring purposes.
  const normalizedId = modelId.toLowerCase()
    .replace(/:e(\d+)b\b/, ':$1b')
    .replace(/\be(\d+)b\b/, '$1b');

  if (complexity >= COMPLEXITY_THRESHOLDS.MEDIUM) {
    // Complex tasks: larger models are strongly preferred
    if (/\b(70b|72b|65b)\b/.test(normalizedId)) return 0.75;
    if (/\b(40b|41b|47b)\b/.test(normalizedId)) return 0.65;
    if (/\b(20b|22b|27b|32b)\b/.test(normalizedId)) return 0.55;
    if (/\b(13b|14b)\b/.test(normalizedId)) return 0.45;
    if (/\b(7b|8b|9b|10b|11b|12b)\b/.test(normalizedId)) return 0.40;
    if (/\b(4b|5b|6b)\b/.test(normalizedId)) return 0.25;
    if (/\b(1b|1\.5b|2b|3b)\b/.test(normalizedId)) return 0.15;
    return 0.30; // unknown size — moderate
  } else {
    // Simple tasks: smaller models are preferred (fast and resource-efficient)
    if (/\b(1b|1\.5b|2b)\b/.test(normalizedId)) return 0.75;
    if (/\b(3b|4b)\b/.test(normalizedId)) return 0.65;
    if (/\b(5b|6b|7b)\b/.test(normalizedId)) return 0.50;
    if (/\b(8b|9b|10b|11b|12b)\b/.test(normalizedId)) return 0.35;
    if (/\b(13b|14b)\b/.test(normalizedId)) return 0.25;
    if (/\b(20b|22b|27b|32b|40b|65b|70b|72b)\b/.test(normalizedId)) return 0.15;
    return 0.30; // unknown size — moderate
  }
}

/**
 * Model Selector Service
 * Handles finding the best models based on task parameters
 */
export const modelSelector = {
  /**
   * Check if free models are available from OpenRouter
   */
  async hasFreeModels(): Promise<boolean> {
    // Only check if OpenRouter API key is configured
    if (!isOpenRouterConfigured()) {
      return false;
    }
    
    try {
      // Initialize OpenRouter module if needed
      if (Object.keys(openRouterModule.modelTracking.models).length === 0) {
        await openRouterModule.initialize();
      }
      
      // Get free models
      const freeModels = await costMonitor.getFreeModels();
      return freeModels.length > 0;
    } catch (error) {
      logger.error('Error checking for free models:', error);
      return false;
    }
  },

  /**
   * Get the best local model for a task.
   *
   * Reads benchmark data exclusively from the ModelRegistry (the single
   * authoritative telemetry source per issue #50). ModelRegistry is updated
   * by both benchmarkModel() (in-process, immediately) and
   * modelsDb.seedModelRegistry() (on startup from persisted JSON), so it
   * always reflects the most current data.
   *
   * Sparse benchmark data (< 3 runs) is blended with a size-based heuristic
   * using a confidence factor to prevent a small model with a single lucky
   * benchmark run from permanently out-scoring a large, highly-capable model.
   */
  async getBestLocalModel(
    complexity: number,
    totalTokens: number,
    excludeId?: string,
    taskCategory?: string,
  ): Promise<Model | null> {
    try {
      // Get local models
      const localModels = await costMonitor.getAvailableModels();
      const filteredLocalModels = localModels.filter(model =>
        isProviderLocal(model.provider) &&
        (model.contextWindow === undefined || model.contextWindow >= totalTokens) &&
        model.id !== excludeId
      );

      if (filteredLocalModels.length === 0) {
        return null;
      }

      // Number of benchmark runs required before empirical data is treated as
      // fully reliable. Below this, scores are blended with the size heuristic.
      const RELIABLE_BENCHMARK_COUNT = 3;

      let bestModel: Model | null = null;
      let bestScore = 0;

      for (const model of filteredLocalModels) {
        let score = 0;

        // Read benchmark data from ModelRegistry — the single authoritative source.
        const benchmarkSummary = getModelRegistry().getModel(model.id)?.benchmarkSummary;

        if (benchmarkSummary) {
          const successRate = benchmarkSummary.successRate ?? 0;

          // Prefer task-category benchmark score when available (e.g. code score
          // for a code task); fall back to the overall quality score.
          const taskCategoryScore = getTaskCategoryScore(model.id, taskCategory);
          const qualitySignal = taskCategoryScore ?? (benchmarkSummary.qualityScore ?? 0);

          const avgResponseTime = benchmarkSummary.avgResponseTime ?? 0;
          const responseTimeFactor = Math.max(0, 1 - (avgResponseTime / 15000));

          // Empirical score (max ≈ 1.0)
          const empiricalScore =
            successRate * 0.3 +
            qualitySignal * 0.4 +
            responseTimeFactor * 0.3;

          // Confidence reflects how much we trust sparse benchmark data.
          // A single run on a small model can produce numbers that outclass a
          // large model, but may not be representative. Blend with the
          // size-based heuristic until we have enough runs.
          const benchmarkCount = benchmarkSummary.benchmarkCount ?? 1;
          const confidence = Math.min(1, benchmarkCount / RELIABLE_BENCHMARK_COUNT);
          const heuristicScore = computeLocalModelHeuristicScore(model.id, complexity);

          score = empiricalScore * confidence + heuristicScore * (1 - confidence);

          logger.debug(
            `Local model ${model.id} has benchmark data: ` +
            `success=${successRate.toFixed(2)}, ` +
            `quality=${qualitySignal.toFixed(2)}${taskCategoryScore !== undefined ? ` (task:${taskCategory})` : ''}, ` +
            `time=${avgResponseTime.toFixed(0)}ms, runs=${benchmarkCount}, ` +
            `confidence=${confidence.toFixed(2)}, score=${score.toFixed(2)}`,
          );
        } else {
          // No benchmark data — rely entirely on size-based heuristics.
          score = computeLocalModelHeuristicScore(model.id, complexity);

          // Small bonus for instruct-tuned models (better instruction following).
          if (model.id.toLowerCase().includes('instruct')) {
            score += 0.05;
          }

          logger.debug(
            `Local model ${model.id} has no benchmark data, using heuristics: score=${score.toFixed(2)}`,
          );
        }

        if (score > bestScore) {
          bestScore = score;
          bestModel = model;
        }
      }

      // Fall back to first available model if scoring produced no winner
      if (!bestModel && filteredLocalModels.length > 0) {
        bestModel = filteredLocalModels[0];
      }

      logger.debug(
        `Selected best local model for complexity ${complexity.toFixed(2)} and ${totalTokens} tokens: ${bestModel?.id}`,
      );
      return bestModel;
    } catch (error) {
      logger.error('Error getting best local model:', error);
      return null;
    }
  },

  /**
   * Get the best free model for a task
   */
  async getBestFreeModel(
    complexity: number,
    totalTokens: number
  ): Promise<Model | null> {
    // Only check if OpenRouter API key is configured
    if (!isOpenRouterConfigured()) {
      return null;
    }
    
    try {
      // Get free models
      const freeModels = await costMonitor.getFreeModels();
      if (freeModels.length === 0) {
        return null;
      }
      
      // Filter models that can handle the context length
      const suitableModels = freeModels.filter(model => {
        return model.contextWindow && model.contextWindow >= totalTokens;
      });
      
      if (suitableModels.length === 0) {
        return null;
      }
      
      // Get the models database
      const modelsDb = modelsDbService.getDatabase();
      
      // Find the best model based on our database and complexity
      let bestModel: Model | null = null;
      let bestScore = 0;
      
      for (const model of suitableModels) {
        // Calculate a base score for this model
        let score = 0;
        
        // Check if we have performance data for this model
        const modelData = modelsDb.models[model.id] as unknown as {
          benchmarkCount: number;
          successRate: number;
          qualityScore: number;
          avgResponseTime: number;
          complexityScore: number;
        };
        
        if (modelData && modelData.benchmarkCount > 0) {
          // Calculate score based on performance data
          // Weight factors based on importance
          const successRateWeight = 0.4;  // Increased weight for success rate
          const qualityScoreWeight = 0.4;
          const responseTimeWeight = 0.3; // Increased weight for speed
          const complexityMatchWeight = 0.1;
          
          // Success rate factor (0-1)
          score += modelData.successRate * successRateWeight;
          
          // Quality score factor (0-1)
          score += modelData.qualityScore * qualityScoreWeight;
          
          // Response time factor (0-1, inversely proportional)
          // Normalize response time: faster is better
          // Assume 15000ms (15s) is the upper bound for response time
          const responseTimeFactor = Math.max(0, 1 - (modelData.avgResponseTime / 15000));
          score += responseTimeFactor * responseTimeWeight;
          
          // Complexity match factor (0-1)
          // How well does the model's complexity score match the requested complexity?
          const complexityMatchFactor = 1 - Math.abs(modelData.complexityScore - complexity);
          score += complexityMatchFactor * complexityMatchWeight;
          
          // Boost score for models with high benchmark counts (more reliable data)
          if (modelData.benchmarkCount >= 3) {
            score += 0.1;
          }
          
          logger.debug(`Model ${model.id} has performance data: success=${modelData.successRate.toFixed(2)}, quality=${modelData.qualityScore.toFixed(2)}, time=${modelData.avgResponseTime}ms, benchmarks=${modelData.benchmarkCount}, score=${score.toFixed(2)}`);
        } else {
          // No performance data, use heuristics
          
          // Since we haven't benchmarked free models yet, give them a higher base score
          // This ensures they get selected more often for benchmarking
          score += 0.3;
          
          // Prefer models with "instruct" in the name for instruction-following tasks
          if (model.id.toLowerCase().includes('instruct')) {
            score += 0.1;
          }
          
          // Prefer models with larger context windows for complex tasks
          if (complexity >= COMPLEXITY_THRESHOLDS.MEDIUM) {
            score += (model.contextWindow || 0) / 100000; // Normalize context window
          }
          
          // Prefer models from known providers
          if (model.id.toLowerCase().includes('mistral') ||
              model.id.toLowerCase().includes('llama') ||
              model.id.toLowerCase().includes('gemini') ||
              model.id.toLowerCase().includes('phi-3') ||
              model.id.toLowerCase().includes('google') ||
              model.id.toLowerCase().includes('meta') ||
              model.id.toLowerCase().includes('microsoft') ||
              model.id.toLowerCase().includes('deepseek')) {
            score += 0.2;
          }
          
          logger.debug(`Model ${model.id} has no performance data, using heuristics: score=${score.toFixed(2)}`);
        }
        
        // Update best model if this one has a higher score
        if (score > bestScore) {
          bestScore = score;
          bestModel = model;
        }
      }
      // If we couldn't find a best model based on scores, fall back to context window and other heuristics
      if (!bestModel && suitableModels.length > 0) {
        if (complexity >= COMPLEXITY_THRESHOLDS.MEDIUM) {
          // For medium to complex tasks, prefer models with larger context windows
          // and from well-known providers
          const preferredProviders = ['google', 'meta-llama', 'mistralai', 'deepseek', 'microsoft'];
          
          // First try to find a model from a preferred provider
          const preferredModels = suitableModels.filter(model =>
            preferredProviders.some(provider => model.id.toLowerCase().includes(provider))
          );
          
          if (preferredModels.length > 0) {
            // Sort by context window size (larger is better for complex tasks)
            bestModel = preferredModels.reduce((best, current) => {
              return (!best || (current.contextWindow || 0) > (best.contextWindow || 0)) ? current : best;
            }, null as Model | null);
          } else {
            // Fall back to any model with the largest context window
            bestModel = suitableModels.reduce((best, current) => {
              return (!best || (current.contextWindow || 0) > (best.contextWindow || 0)) ? current : best;
            }, null as Model | null);
          }
        } else {
          // For simple tasks, prefer models with "instruct" in the name
          const instructModels = suitableModels.filter(model =>
            model.id.toLowerCase().includes('instruct')
          );
          
          if (instructModels.length > 0) {
            bestModel = instructModels[0];
          } else {
            // Fall back to any model
            bestModel = suitableModels[0];
          }
        }
      }
      
      logger.debug(`Selected best free model for complexity ${complexity.toFixed(2)} and ${totalTokens} tokens: ${bestModel?.id}`);
      return bestModel;
    } catch (error) {
      logger.error('Error getting best free model:', error);
      return null;
    }
  }
};