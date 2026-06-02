import { getProviderRegistry } from '../../core/provider/index.js';
import { getModelRegistry } from '../../core/model/index.js';
import { logger } from '../../../utils/logger.js';
import { modelsDbService } from './modelsDb.js';

function parseProseVerdict(trimmed: string): { passed: boolean | null; parsedCleanly: boolean } {
  const lowerOutput = trimmed.toLowerCase();
  
  // Negation pattern, e.g. "not correct", "never pass", "fails to be correct", "doesn't pass"
  const negationRegex = /\b(not|never|no|n't|incorrect|fails?|without)\b\s+(?:[a-z]+\s+)?\b(pass|passes|passing|correct|yes)\b/i;
  
  // Word boundary checks for positive and negative keywords with inflections
  const hasYes = /\b(pass|passes|passing|correct|yes)\b/i.test(lowerOutput);
  const hasNo = /\b(fail|fails|failed|incorrect|no)\b/i.test(lowerOutput);
  const hasNegatedYes = negationRegex.test(lowerOutput);

  if (hasYes && !hasNegatedYes && !hasNo) {
    return { passed: true, parsedCleanly: false };
  } else if (hasNo || hasNegatedYes) {
    return { passed: false, parsedCleanly: false };
  }
  
  return { passed: null, parsedCleanly: false };
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

export class OutputValidator {
  /**
   * Validates generated output against a task.
   * Completely decoupled from registry/DB side-effects for testability.
   */
  static async validate(
    task: string,
    output: string,
    provider: { executeTask: (modelId: string, prompt: string, options?: any) => Promise<{ content: string }> },
    modelId: string
  ): Promise<{
    passed: boolean | null;
    confidence: number;
    reason: string;
    parsed_cleanly: boolean;
    skipped: boolean;
  }> {
    const prompt = [
      "Does this output correctly and completely satisfy the task? Answer only YES or NO on the first line, then explain.",
      `Task: ${task}`,
      `Output: ${output}`
    ].join('\n\n');

    let passed: boolean | null = null;
    let parsedCleanly = true;
    let confidence = 1.0;
    let reason = '';
    let skipped = false;

    try {
      const execResult = await provider.executeTask(modelId, prompt, {
        temperature: 0.1,
        maxTokens: 500
      });

      const trimmed = execResult.content.trim();
      
      if (!trimmed) {
        return {
          passed: null,
          confidence: 0,
          reason: 'Empty response from validator model',
          parsed_cleanly: false,
          skipped: true
        };
      }

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
        // Keyword fallback matching
        const fallback = parseProseVerdict(trimmed);
        passed = fallback.passed;
        parsedCleanly = fallback.parsedCleanly;
        
        if (passed !== null) {
          reason = trimmed;
          confidence = 0.5; // pinned confidence for keyword fallback
        } else {
          skipped = true;
          reason = 'Unparseable response: ' + (trimmed.substring(0, 100) || '(empty)');
          confidence = 0;
        }
      }
    } catch (error) {
      parsedCleanly = false;
      passed = null;
      skipped = true;
      reason = `Provider error: ${error instanceof Error ? error.message : String(error)}`;
      confidence = 0;
      logger.error(`[OutputValidator] Error during validation execution:`, error);
    }

    return {
      passed,
      confidence,
      reason,
      parsed_cleanly: parsedCleanly,
      skipped
    };
  }

  /**
   * Updates validator model reputation via EMA.
   * Promoted as an explicit side-effect method to avoid hidden side effects inside validate().
   */
  static async updateReputation(modelId: string, parsedCleanly: boolean): Promise<void> {
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
}
