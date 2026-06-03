import fs from 'fs/promises';
import path from 'path';
import { logger } from '../../../utils/logger.js';
import { config } from '../../../config/index.js';
import { getModelRegistry } from '../../core/model/index.js';
import { modelsDbService } from './modelsDb.js';
import { getJob } from '../../job-store/index.js';

export interface RateModelParams {
  modelId: string;
  jobId: string;
  role: 'generator' | 'validator';
  outcome: 'positive' | 'negative' | 'partial';
  validatorVerdict?: 'accurate' | 'too_strict' | 'too_lenient';
  comment?: string;
}

export async function rateModel(params: RateModelParams): Promise<{ success: boolean; message: string; newScores?: any }> {
  const { modelId, jobId, role, outcome, validatorVerdict, comment } = params;

  // 1. Input Validation
  if (role !== 'generator' && role !== 'validator') {
    return { success: false, message: `Invalid role "${role}". Must be "generator" or "validator".` };
  }

  if (outcome !== 'positive' && outcome !== 'negative' && outcome !== 'partial') {
    return { success: false, message: `Invalid outcome "${outcome}". Must be "positive", "negative", or "partial".` };
  }

  if (validatorVerdict && role !== 'validator') {
    return { success: false, message: 'validator_verdict is only allowed when role is "validator"' };
  }

  // 2. Model Lookup
  const registry = getModelRegistry();
  const modelMetadata = registry.getModel(modelId);
  if (!modelMetadata) {
    return { success: false, message: `Model "${modelId}" not found in registry.` };
  }

  // 3. Score Calculations using EMA (alpha = 0.10)
  const alpha = 0.10;
  const signal = outcome === 'positive' ? 1.0 : outcome === 'negative' ? 0.0 : 0.5;

  let newScores: any = {};

  if (role === 'generator') {
    const oldQualityScore = modelMetadata.benchmarkSummary?.qualityScore ?? 0.5;
    const newQualityScore = oldQualityScore * (1 - alpha) + signal * alpha;

    const oldCodeScore = modelMetadata.capabilities?.scores?.code ?? modelMetadata.benchmarkSummary?.scores?.code ?? 0.5;
    const newCodeScore = oldCodeScore * (1 - alpha) + signal * alpha;

    const oldChatScore = modelMetadata.capabilities?.scores?.chat ?? modelMetadata.benchmarkSummary?.scores?.chat ?? 0.5;
    const newChatScore = oldChatScore * (1 - alpha) + signal * alpha;

    newScores = {
      qualityScore: newQualityScore,
      code: newCodeScore,
      chat: newChatScore
    };

    logger.debug(`[ModelRating] Updating generator reputation for ${modelId}: oldQuality=${oldQualityScore.toFixed(4)}, newQuality=${newQualityScore.toFixed(4)}, oldCode=${oldCodeScore.toFixed(4)}, newCode=${newCodeScore.toFixed(4)}`);

    // Update ModelRegistry
    const currentSummary = modelMetadata.benchmarkSummary || {
      lastRunAt: Date.now(),
      taskCategories: [],
      scores: {},
      benchmarkCount: 0
    };
    const currentScores = currentSummary.scores || {};
    const updatedSummary = {
      ...currentSummary,
      lastRunAt: Date.now(),
      scores: {
        ...currentScores,
        code: newCodeScore,
        chat: newChatScore
      },
      qualityScore: newQualityScore,
      benchmarkCount: (currentSummary.benchmarkCount || 0) + 1
    };
    registry.updateBenchmarkSummary(modelId, updatedSummary);

    // Update modelsDbService
    try {
      const modelsDb = modelsDbService.getDatabase();
      const existingDbModel = modelsDb.models[modelId];
      if (existingDbModel) {
        const dbScores = existingDbModel.scores || {};
        await modelsDbService.updateModelData(modelId, {
          scores: {
            ...dbScores,
            code: newCodeScore,
            chat: newChatScore
          },
          qualityScore: newQualityScore,
          benchmarkCount: (existingDbModel.benchmarkCount || 0) + 1,
          lastBenchmarked: new Date().toISOString()
        });
      }
    } catch (err: any) {
      logger.error(`[ModelRating] Failed to update models DB for generator ${modelId}:`, err);
    }
  } else {
    // role === 'validator'
    const oldValidateScore = modelMetadata.capabilities?.scores?.validate ?? modelMetadata.benchmarkSummary?.scores?.validate ?? 0.5;
    const newValidateScore = oldValidateScore * (1 - alpha) + signal * alpha;

    newScores = {
      validate: newValidateScore
    };

    logger.debug(`[ModelRating] Updating validator reputation for ${modelId}: oldValidate=${oldValidateScore.toFixed(4)}, newValidate=${newValidateScore.toFixed(4)}`);

    // Update ModelRegistry
    const currentSummary = modelMetadata.benchmarkSummary || {
      lastRunAt: Date.now(),
      taskCategories: [],
      scores: {},
      benchmarkCount: 0
    };
    const currentScores = currentSummary.scores || {};
    const updatedSummary = {
      ...currentSummary,
      lastRunAt: Date.now(),
      scores: {
        ...currentScores,
        validate: newValidateScore
      },
      benchmarkCount: (currentSummary.benchmarkCount || 0) + 1
    };
    registry.updateBenchmarkSummary(modelId, updatedSummary);

    // Update modelsDbService
    try {
      const modelsDb = modelsDbService.getDatabase();
      const existingDbModel = modelsDb.models[modelId];
      if (existingDbModel) {
        const dbScores = existingDbModel.scores || {};
        await modelsDbService.updateModelData(modelId, {
          scores: {
            ...dbScores,
            validate: newValidateScore
          },
          benchmarkCount: (existingDbModel.benchmarkCount || 0) + 1,
          lastBenchmarked: new Date().toISOString()
        });
      }
    } catch (err: any) {
      logger.error(`[ModelRating] Failed to update models DB for validator ${modelId}:`, err);
    }
  }

  // 4. Fixture Candidate Queueing for Negative Outcome
  if (outcome === 'negative') {
    const job = await getJob(jobId);
    if (!job) {
      return { success: false, message: `Job "${jobId}" not found for negative outcome feedback.` };
    }

    let output = '';
    if (job.result) {
      try {
        const parsed = JSON.parse(job.result);
        if (Array.isArray(parsed)) {
          output = parsed.join('\n');
        } else {
          output = String(parsed);
        }
      } catch {
        output = job.result;
      }
    }

    const candidate = {
      task: job.task_text || '',
      output,
      label: 'bad' as const,
      model_id: modelId,
      job_id: jobId,
      role,
      comment,
      validator_verdict: validatorVerdict,
      timestamp: Date.now()
    };

    const dbDir = process.env.DB_DIR || config.cacheDir;
    const candidatesPath = path.join(dbDir, 'fixture-candidates.json');

    try {
      await fs.mkdir(dbDir, { recursive: true });

      let candidates: any[] = [];
      try {
        const existingData = await fs.readFile(candidatesPath, 'utf-8');
        candidates = JSON.parse(existingData);
        if (!Array.isArray(candidates)) {
          candidates = [];
        }
      } catch (err: any) {
        if (err.code !== 'ENOENT') {
          logger.warn(`Error reading fixture candidates file: ${err.message}`);
        }
      }

      candidates.push(candidate);
      await fs.writeFile(candidatesPath, JSON.stringify(candidates, null, 2), 'utf-8');
      logger.info(`[ModelRating] Enqueued fixture candidate for negative outcome of job ${jobId}`);
    } catch (err: any) {
      logger.error(`[ModelRating] Failed to save fixture candidate for job ${jobId}:`, err);
      return { success: false, message: `Failed to save fixture candidate: ${err.message}` };
    }
  }

  return {
    success: true,
    message: `Successfully rated model "${modelId}" in role "${role}" with outcome "${outcome}".`,
    newScores
  };
}
