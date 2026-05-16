/**
 * Section 6: benchmark_model tool implementation.
 *
 * Runs categorized benchmark tasks for a specific model via the ProviderRegistry,
 * then updates ModelRegistry.updateBenchmarkSummary() and persists results to
 * benchmarkDb so they survive restarts and flow into the capability-scoring
 * pipeline introduced in Section 5.
 */
import { getProviderRegistry } from '../../core/provider/index.js';
import { getModelRegistry } from '../../core/model/index.js';
import type { BenchmarkSummary } from '../../core/model/types.js';
import { evaluateQuality } from '../evaluation/quality.js';
import { initBenchmarkDb, saveBenchmarkResult } from '../storage/benchmarkDb.js';
import { getDynamicTimeout } from './runner.js';
import { logger } from '../../../utils/logger.js';

// ---------------------------------------------------------------------------
// Task category definitions
// ---------------------------------------------------------------------------

export type TaskCategory = 'code' | 'chat' | 'tool-use' | 'long-context';

interface CategoryTask {
  task: string;
  contextLength: number;
  expectedOutputLength: number;
  complexity: number;
}

/**
 * Built-in benchmark prompts per category.  Short enough to be tolerable
 * even on hardware without a GPU; representative enough to surface meaningful
 * quality differences between models.
 */
const CATEGORY_TASKS: Record<TaskCategory, CategoryTask[]> = {
  code: [
    {
      task: 'Write a TypeScript function that sorts an array of objects by a nested property using a dot-separated key path string. Include type annotations.',
      contextLength: 200,
      expectedOutputLength: 250,
      complexity: 0.5,
    },
    {
      task: 'Implement a breadth-first search in Python that returns the shortest path between two nodes in an unweighted undirected graph represented as an adjacency list.',
      contextLength: 150,
      expectedOutputLength: 200,
      complexity: 0.6,
    },
  ],
  chat: [
    {
      task: 'Explain the difference between a mutex and a semaphore in 2–3 sentences.',
      contextLength: 50,
      expectedOutputLength: 100,
      complexity: 0.3,
    },
    {
      task: 'What are the main tradeoffs between REST and GraphQL APIs? Give two pros and two cons for each.',
      contextLength: 60,
      expectedOutputLength: 180,
      complexity: 0.3,
    },
  ],
  'tool-use': [
    {
      task: 'Parse the following JSON and extract the "id" field. Return only the integer value.\nInput: {"id": 42, "name": "Alice", "active": true}',
      contextLength: 100,
      expectedOutputLength: 10,
      complexity: 0.2,
    },
  ],
  'long-context': [
    {
      task: 'Summarise the key design principles of a well-architected microservices system. Focus on scalability, observability, and failure isolation. Be concise — target 150 words.',
      contextLength: 500,
      expectedOutputLength: 400,
      complexity: 0.6,
    },
  ],
};

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface BenchmarkModelParams {
  modelId: string;
  /** Defaults to ['code', 'chat'] when omitted. */
  taskCategories?: TaskCategory[];
}

export interface CategoryResult {
  successRate: number;
  qualityScore: number;
  avgResponseTimeMs: number;
  tasksRan: number;
}

export interface BenchmarkModelResult {
  modelId: string;
  providerId: string;
  taskCategories: TaskCategory[];
  categoryResults: Partial<Record<TaskCategory, CategoryResult>>;
  summary: BenchmarkSummary;
}

/**
 * Run categorised benchmarks for a specific model.
 *
 * Steps:
 *  1. Resolve the model's provider from ModelRegistry / ProviderRegistry.
 *  2. For each requested task category, run the built-in prompt set via
 *     `provider.executeTask()` — no hardcoded provider switch.
 *  3. Aggregate results into a `BenchmarkSummary`.
 *  4. Call `ModelRegistry.updateBenchmarkSummary()` so capability scores
 *     are updated in-process immediately.
 *  5. Persist each run to `benchmarkDb` so historical data survives restarts.
 */
export async function benchmarkModel(
  params: BenchmarkModelParams,
): Promise<BenchmarkModelResult> {
  const { modelId, taskCategories = ['code', 'chat'] } = params;

  const registry = getProviderRegistry();
  const modelRegistry = getModelRegistry();

  // -------------------------------------------------------------------------
  // 1. Resolve provider
  // -------------------------------------------------------------------------
  let providerId: string;
  const meta = modelRegistry.getModel(modelId);
  if (meta) {
    providerId = meta.providerId;
  } else {
    // Model not in registry yet — scan providers for one that claims to support it
    let found: string | undefined;
    for (const provider of registry.list()) {
      const supported = await Promise.resolve(provider.supportsModel(modelId));
      if (supported) {
        found = provider.id;
        break;
      }
    }
    if (!found) {
      throw new Error(
        `benchmark_model: model '${modelId}' was not found in any registered provider`,
      );
    }
    providerId = found;
  }

  const provider = registry.get(providerId);
  if (!provider) {
    throw new Error(
      `benchmark_model: provider '${providerId}' is not in the registry`,
    );
  }

  logger.info(
    `benchmark_model: starting for model '${modelId}' via provider '${providerId}', categories: [${taskCategories.join(', ')}]`,
  );

  await initBenchmarkDb();

  // -------------------------------------------------------------------------
  // 2. Run tasks per category
  // -------------------------------------------------------------------------
  const categoryResults: Partial<Record<TaskCategory, CategoryResult>> = {};

  for (const category of taskCategories) {
    const tasks = CATEGORY_TASKS[category];
    if (!tasks || tasks.length === 0) {
      logger.warn(`benchmark_model: no tasks defined for category '${category}', skipping`);
      continue;
    }

    let totalSuccess = 0;
    let totalQuality = 0;
    let totalTime = 0;
    let tasksRan = 0;

    for (let taskIdx = 0; taskIdx < tasks.length; taskIdx++) {
      const benchTask = tasks[taskIdx];
      const contextWindow = meta?.contextWindow ?? 4096;
      const timeoutMs = getDynamicTimeout(modelId, contextWindow, benchTask.complexity);
      const startMs = Date.now();

      try {
        const execResult = await provider.executeTask(modelId, benchTask.task, { timeoutMs });
        const elapsed = Date.now() - startMs;
        const quality = evaluateQuality(benchTask.task, execResult.content);

        totalSuccess++;
        totalQuality += quality;
        totalTime += elapsed;
        tasksRan++;

        // Persist each run to benchmarkDb (Section 6 acceptance criterion)
        await saveBenchmarkResult({
          taskId: `bm_${modelId.replace(/[^a-z0-9]/gi, '_')}_${category}_${taskIdx}`,
          task: benchTask.task,
          contextLength: benchTask.contextLength,
          outputLength:
            execResult.completionTokens ?? benchTask.expectedOutputLength,
          complexity: benchTask.complexity,
          local: {
            model: modelId,
            timeTaken: elapsed,
            successRate: 1,
            qualityScore: quality,
            tokenUsage: {
              prompt: execResult.promptTokens ?? benchTask.contextLength,
              completion:
                execResult.completionTokens ?? benchTask.expectedOutputLength,
              total:
                (execResult.promptTokens ?? benchTask.contextLength) +
                (execResult.completionTokens ?? benchTask.expectedOutputLength),
            },
            output: execResult.content,
          },
          paid: {
            model: 'none',
            timeTaken: 0,
            successRate: 0,
            qualityScore: 0,
            tokenUsage: { prompt: 0, completion: 0, total: 0 },
            cost: 0,
            output: '',
          },
          timestamp: new Date().toISOString(),
        });
      } catch (err) {
        const elapsed = Date.now() - startMs;
        logger.warn(
          `benchmark_model: ${category}[${taskIdx}] failed for '${modelId}': ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
        totalTime += elapsed;
        tasksRan++;
      }
    }

    const successRate = tasksRan > 0 ? totalSuccess / tasksRan : 0;
    const avgQuality =
      totalSuccess > 0 ? totalQuality / totalSuccess : 0;
    const avgResponseTimeMs = tasksRan > 0 ? totalTime / tasksRan : 0;

    categoryResults[category] = { successRate, qualityScore: avgQuality, avgResponseTimeMs, tasksRan };

    logger.info(
      `benchmark_model: category '${category}' done — success=${successRate.toFixed(2)}, quality=${avgQuality.toFixed(2)}, avgMs=${avgResponseTimeMs.toFixed(0)}`,
    );
  }

  // -------------------------------------------------------------------------
  // 3. Aggregate across categories
  // -------------------------------------------------------------------------
  const catValues = Object.values(categoryResults) as CategoryResult[];
  const n = catValues.length;

  const overallSuccessRate = n > 0 ? catValues.reduce((s, c) => s + c.successRate, 0) / n : 0;
  const overallQuality = n > 0 ? catValues.reduce((s, c) => s + c.qualityScore, 0) / n : 0;
  const overallAvgMs = n > 0 ? catValues.reduce((s, c) => s + c.avgResponseTimeMs, 0) / n : 0;

  // Normalise speed: 0 = very slow (≥60 s avg), 1 = very fast (≤1 s avg)
  const speedScore =
    overallAvgMs > 0
      ? Math.max(0, Math.min(1, 1 - overallAvgMs / 60_000))
      : undefined;

  const registrySummary: BenchmarkSummary = {
    lastRunAt: Date.now(),
    taskCategories,
    scores: {
      code: categoryResults['code']?.qualityScore,
      reasoning: categoryResults['chat']?.qualityScore,
      speed: speedScore,
    },
    successRate: overallSuccessRate,
    qualityScore: overallQuality,
    avgResponseTime: overallAvgMs,
  };

  // -------------------------------------------------------------------------
  // 4. Update ModelRegistry so capability scores are live immediately
  // -------------------------------------------------------------------------
  modelRegistry.updateBenchmarkSummary(modelId, registrySummary);

  logger.info(
    `benchmark_model: completed for '${modelId}' (${providerId}) — overallSuccess=${overallSuccessRate.toFixed(2)}, overallQuality=${overallQuality.toFixed(2)}`,
  );

  return {
    modelId,
    providerId,
    taskCategories,
    categoryResults,
    summary: registrySummary,
  };
}
