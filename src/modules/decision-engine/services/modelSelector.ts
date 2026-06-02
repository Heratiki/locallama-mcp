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
import { config } from '../../../config/index.js';

interface TaskCategorySignal {
  score: number;
  seeded: boolean;
}

function getTaskCategorySignal(modelId: string, taskCategory?: string): TaskCategorySignal | undefined {
  if (!taskCategory) return undefined;

  const scores = getModelRegistry().getModel(modelId)?.benchmarkSummary?.scores;
  if (!scores) return undefined;

  switch (taskCategory) {
    case 'code':
      return scores.code === undefined ? undefined : { score: scores.code, seeded: false };
    case 'reasoning':
      return scores.reasoning === undefined ? undefined : { score: scores.reasoning, seeded: false };
    case 'speed':
      return scores.speed === undefined ? undefined : { score: scores.speed, seeded: false };
    case 'validate':
      if (scores.validate !== undefined) {
        return { score: scores.validate, seeded: false };
      }
      if (scores.code !== undefined) {
        return { score: scores.code * 0.8, seeded: true };
      }
      return undefined;
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

function getValidationQualityScore(model: Model): number {
  const registry = getModelRegistry();
  const meta = registry.getModel(model.id);
  const benchmarkSummary = meta?.benchmarkSummary;
  
  if (benchmarkSummary) {
    const taskCategorySignal = getTaskCategorySignal(model.id, 'validate');
    if (taskCategorySignal) {
      return taskCategorySignal.score;
    }
    return benchmarkSummary.qualityScore ?? 0.3;
  }
  
  const modelsDb = modelsDbService.getDatabase();
  const dbModel = modelsDb.models[model.id];
  if (dbModel) {
    const dbScores = (dbModel as any).scores || {};
    if (dbScores.validate !== undefined) {
      return dbScores.validate;
    }
    if (dbScores.code !== undefined) {
      return dbScores.code * 0.8;
    }
    return dbModel.qualityScore ?? 0.3;
  }
  
  return 0.3;
}

function getModelValidationScore(model: Model, complexity: number): number {
  const registry = getModelRegistry();
  const meta = registry.getModel(model.id);
  const benchmarkSummary = meta?.benchmarkSummary;

  if (benchmarkSummary) {
    const successRate = benchmarkSummary.successRate ?? 0;
    const taskCategorySignal = getTaskCategorySignal(model.id, 'validate');
    const taskCategoryScore = taskCategorySignal?.score;
    const qualitySignal = taskCategoryScore ?? (benchmarkSummary.qualityScore ?? 0);

    const avgResponseTime = benchmarkSummary.avgResponseTime ?? 0;
    const responseTimeFactor = Math.max(0, 1 - (avgResponseTime / 15000));

    const empiricalScore =
      successRate * 0.3 +
      qualitySignal * 0.4 +
      responseTimeFactor * 0.3;

    const benchmarkCount = taskCategorySignal?.seeded ? 1 : (benchmarkSummary.benchmarkCount ?? 1);
    const confidence = Math.min(1, benchmarkCount / config.reliableBenchmarkCount);
    
    let heuristicScore = 0.3;
    if (isProviderLocal(model.provider)) {
      heuristicScore = computeLocalModelHeuristicScore(model.id, complexity);
    } else {
      heuristicScore = benchmarkSummary.qualityScore ?? 0.3;
    }

    return empiricalScore * confidence + heuristicScore * (1 - confidence);
  } else {
    const modelsDb = modelsDbService.getDatabase();
    const dbModel = modelsDb.models[model.id];
    if (dbModel && dbModel.benchmarkCount > 0) {
      const successRate = dbModel.successRate ?? 0;
      const dbScores = (dbModel as any).scores || {};
      let qualitySignal = dbScores.validate;
      if (qualitySignal === undefined) {
        qualitySignal = dbScores.code !== undefined ? dbScores.code * 0.8 : (dbModel.qualityScore ?? 0.3);
      }
      
      const avgResponseTime = dbModel.avgResponseTime ?? 0;
      const responseTimeFactor = Math.max(0, 1 - (avgResponseTime / 15000));

      const empiricalScore =
        successRate * 0.3 +
        qualitySignal * 0.4 +
        responseTimeFactor * 0.3;

      const confidence = Math.min(1, dbModel.benchmarkCount / config.reliableBenchmarkCount);
      let heuristicScore = 0.3;
      if (isProviderLocal(model.provider)) {
        heuristicScore = computeLocalModelHeuristicScore(model.id, complexity);
      } else {
        heuristicScore = dbModel.qualityScore ?? 0.3;
      }

      return empiricalScore * confidence + heuristicScore * (1 - confidence);
    }
    
    let score = 0.3;
    if (isProviderLocal(model.provider)) {
      score = computeLocalModelHeuristicScore(model.id, complexity);
      if (model.id.toLowerCase().includes('instruct')) {
        score += 0.05;
      }
    } else {
      if (model.id.toLowerCase().includes('instruct')) {
        score += 0.1;
      }
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
    }
    return score;
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
          const taskCategorySignal = getTaskCategorySignal(model.id, taskCategory);
          const taskCategoryScore = taskCategorySignal?.score;
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
          const benchmarkCount = taskCategorySignal?.seeded ? 1 : (benchmarkSummary.benchmarkCount ?? 1);
          const confidence = Math.min(1, benchmarkCount / config.reliableBenchmarkCount);
          const heuristicScore = computeLocalModelHeuristicScore(model.id, complexity);

          score = empiricalScore * confidence + heuristicScore * (1 - confidence);

          logger.debug(
            `Local model ${model.id} has benchmark data: ` +
            `success=${successRate.toFixed(2)}, ` +
            `quality=${qualitySignal.toFixed(2)}${taskCategoryScore !== undefined ? ` (task:${taskCategory}${taskCategorySignal?.seeded ? ':seeded' : ''})` : ''}, ` +
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
          const responseTimeWeight = 0.2; // Increased weight for speed
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
  },

  /**
   * Get the best validator model based on confidence-blended scoring and threshold gating.
   */
  async getBestValidatorModel(
    complexity: number,
    totalTokens: number,
    excludeGeneratorId?: string,
  ): Promise<Model | null> {
    try {
      const allModels = await costMonitor.getAvailableModels();
      const filteredModels = allModels.filter(model =>
        model.contextWindow === undefined || model.contextWindow >= totalTokens
      );

      if (filteredModels.length === 0) {
        return null;
      }

      const freeModels = await costMonitor.getFreeModels();
      const freeModelIds = new Set(freeModels.map(m => m.id));

      const localOrFreeCandidates: Model[] = [];
      const paidCandidates: Model[] = [];

      for (const model of filteredModels) {
        if (isProviderLocal(model.provider) || freeModelIds.has(model.id)) {
          localOrFreeCandidates.push(model);
        } else {
          paidCandidates.push(model);
        }
      }

      const minScore = config.minValidatorScore;

      const evaluateTier = (candidates: Model[]): Model | null => {
        const qualifiedCandidates = candidates.filter(model => {
          const quality = getValidationQualityScore(model);
          return quality >= minScore;
        });

        const scored = qualifiedCandidates.map(model => ({
          model,
          score: getModelValidationScore(model, complexity)
        }));

        const qualified = scored;

        if (qualified.length === 0) {
          return null;
        }

        const nonGenerator = qualified.filter(c => c.model.id !== excludeGeneratorId);

        if (nonGenerator.length > 0) {
          nonGenerator.sort((a, b) => b.score - a.score);
          return nonGenerator[0].model;
        }

        const generator = qualified.filter(c => c.model.id === excludeGeneratorId);
        if (generator.length > 0) {
          generator.sort((a, b) => b.score - a.score);
          return generator[0].model;
        }

        return null;
      };

      const bestLocalOrFree = evaluateTier(localOrFreeCandidates);
      if (bestLocalOrFree) {
        logger.debug(`Selected best local/free validator: ${bestLocalOrFree.id}`);
        return bestLocalOrFree;
      }

      const bestPaid = evaluateTier(paidCandidates);
      if (bestPaid) {
        logger.debug(`Selected best paid validator: ${bestPaid.id}`);
        return bestPaid;
      }

      logger.debug(`No qualified validator found (minValidatorScore=${minScore})`);
      return null;
    } catch (error) {
      logger.error('Error getting best validator model:', error);
      return null;
    }
  }
};
