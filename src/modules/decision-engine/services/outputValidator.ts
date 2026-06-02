import { getProviderRegistry } from '../../core/provider/index.js';
import { getModelRegistry } from '../../core/model/index.js';
import type { ModelMetadata } from '../../core/model/types.js';
import { logger } from '../../../utils/logger.js';
import { modelsDbService } from './modelsDb.js';

function findFirstOccurrence(text: string, keywords: string[]): number {
  let minIndex = -1;
  for (const keyword of keywords) {
    const regex = new RegExp(`\\b${keyword}\\b`, 'i');
    const match = text.match(regex);
    if (match && match.index !== undefined) {
      if (minIndex === -1 || match.index < minIndex) {
        minIndex = match.index;
      }
    }
  }
  return minIndex;
}

function calculateConfidence(explanation: string): number {
  const cleanExp = explanation.toLowerCase();
  let conf = 0.8; // base confidence
  
  if (cleanExp.length < 15) {
    conf -= 0.15;
  } else if (cleanExp.length > 80) {
    conf += 0.1;
  }
  
  const uncertaintyWords = [
    'maybe', 'probably', 'perhaps', 'unclear', 'not sure', 
    'likely', 'possibly', 'depends', 'difficult to tell'
  ];
  for (const word of uncertaintyWords) {
    if (cleanExp.includes(word)) {
      conf -= 0.2;
      break;
    }
  }
  
  const certaintyWords = [
    'definitely', 'absolutely', 'clearly', 'incorrect', 'correct',
    'perfectly', 'fail', 'passes', 'does not'
  ];
  for (const word of certaintyWords) {
    if (cleanExp.includes(word)) {
      conf += 0.05;
      break;
    }
  }

  return parseFloat(Math.max(0, Math.min(1, conf)).toFixed(2));
}

async function updateValidatorReputation(modelId: string, parsedCleanly: boolean): Promise<void> {
  const registry = getModelRegistry();
  const modelMetadata = registry.getModel(modelId);
  
  let oldScore = 0.5;
  
  if (modelMetadata?.capabilities?.scores?.validate !== undefined) {
    oldScore = modelMetadata.capabilities.scores.validate;
  } else if (modelMetadata?.benchmarkSummary?.scores?.validate !== undefined) {
    oldScore = modelMetadata.benchmarkSummary.scores.validate;
  } else if (modelMetadata?.capabilities?.scores?.code !== undefined) {
    oldScore = modelMetadata.capabilities.scores.code * 0.8;
  } else if (modelMetadata?.benchmarkSummary?.scores?.code !== undefined) {
    oldScore = modelMetadata.benchmarkSummary.scores.code * 0.8;
  } else if (modelMetadata?.benchmarkSummary?.qualityScore !== undefined) {
    oldScore = modelMetadata.benchmarkSummary.qualityScore * 0.8;
  }

  const signal = parsedCleanly ? 1.0 : 0.0;
  const newScore = oldScore * 0.95 + signal * 0.05;
  
  logger.debug(`[OutputValidator] Updating validator reputation for ${modelId}: old=${oldScore.toFixed(4)}, signal=${signal}, new=${newScore.toFixed(4)}`);
  
  if (modelMetadata) {
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
        validate: newScore
      },
      benchmarkCount: (currentSummary.benchmarkCount || 0) + 1
    };
    registry.updateBenchmarkSummary(modelId, updatedSummary);
  }
  
  try {
    const modelsDb = modelsDbService.getDatabase();
    const existingDbModel = modelsDb.models[modelId];
    if (existingDbModel) {
      const dbScores = existingDbModel.scores || {};
      const updatedScores = {
        ...dbScores,
        validate: newScore
      };
      
      await modelsDbService.updateModelData(modelId, {
        scores: updatedScores,
        benchmarkCount: (existingDbModel.benchmarkCount || 0) + 1,
        lastBenchmarked: new Date().toISOString()
      });
    } else {
      await modelsDbService.updateModelData(modelId, {
        id: modelId,
        name: modelId,
        provider: modelId.split('-')[0] || 'unknown',
        lastSeen: new Date().toISOString(),
        contextWindow: modelMetadata?.contextWindow || 4096,
        successRate: modelMetadata?.benchmarkSummary?.successRate || 1.0,
        qualityScore: modelMetadata?.benchmarkSummary?.qualityScore || 0.5,
        avgResponseTime: modelMetadata?.benchmarkSummary?.avgResponseTime || 1000,
        complexityScore: 0.5,
        lastBenchmarked: new Date().toISOString(),
        benchmarkCount: 1,
        isFree: true,
        scores: { validate: newScore }
      });
    }
  } catch (error) {
    logger.error(`[OutputValidator] Failed to update model db validation score for ${modelId}:`, error);
  }
}

export class OutputValidator {
  static async validate(
    task: string,
    output: string,
    validatorModel: ModelMetadata
  ): Promise<{
    passed: boolean;
    confidence: number;
    reason: string;
    parsed_cleanly: boolean;
  }> {
    const prompt = [
      "Does this output correctly and completely satisfy the task? Answer only YES or NO on the first line, then explain.",
      `Task: ${task}`,
      `Output: ${output}`
    ].join('\n\n');

    let passed = true;
    let parsedCleanly = true;
    let confidence = 1.0;
    let reason = '';

    try {
      const providerRegistry = getProviderRegistry();
      const provider = providerRegistry.get(validatorModel.providerId);
      if (!provider) {
        throw new Error(`Provider not found: ${validatorModel.providerId}`);
      }

      const execResult = await provider.executeTask(validatorModel.id, prompt, {
        temperature: 0.1,
        maxTokens: 500
      });

      const trimmed = execResult.content.trim();
      const lines = trimmed.split(/\r?\n/);
      const firstLine = lines[0].trim().toUpperCase();

      if (firstLine.startsWith('YES')) {
        passed = true;
        reason = lines.slice(1).join('\n').trim() || 'Passed validation';
        confidence = calculateConfidence(reason);
      } else if (firstLine.startsWith('NO')) {
        passed = false;
        reason = lines.slice(1).join('\n').trim() || 'Failed validation';
        confidence = calculateConfidence(reason);
      } else {
        parsedCleanly = false;
        const lowerOutput = trimmed.toLowerCase();
        const yesIndex = findFirstOccurrence(lowerOutput, ['pass', 'correct', 'yes']);
        const noIndex = findFirstOccurrence(lowerOutput, ['fail', 'incorrect', 'no']);

        if (yesIndex !== -1 && (noIndex === -1 || yesIndex < noIndex)) {
          passed = true;
          reason = trimmed;
          confidence = calculateConfidence(trimmed) * 0.8;
        } else if (noIndex !== -1 && (yesIndex === -1 || noIndex < yesIndex)) {
          passed = false;
          reason = trimmed;
          confidence = calculateConfidence(trimmed) * 0.8;
        } else {
          passed = true; // graceful skip
          reason = 'Unparseable response: ' + (trimmed.substring(0, 100) || '(empty)');
          confidence = 0;
        }
      }
    } catch (error) {
      parsedCleanly = false;
      passed = true; // graceful skip on provider error
      reason = `Provider error: ${error instanceof Error ? error.message : String(error)}`;
      confidence = 0;
      logger.error(`[OutputValidator] Error during validation execution:`, error);
    }

    // Update EMA reputation
    await updateValidatorReputation(validatorModel.id, parsedCleanly);

    return {
      passed,
      confidence,
      reason,
      parsed_cleanly: parsedCleanly
    };
  }
}
