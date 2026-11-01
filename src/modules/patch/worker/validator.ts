import { OutputValidator } from '../../decision-engine/services/outputValidator.js';
import { hasBudgetNow } from '../ladder/index.js';
import type { LadderEntry } from '../types.js';
import { WorkerStop, type PatchValidation } from './contracts.js';
import type { PatchModelCalls } from './model-call.js';

/** Reuse the existing judge's verdict parsing, injecting the patch model path. */
export async function validatePatch(
  calls: PatchModelCalls, entry: LadderEntry, goal: string, diff: string,
): Promise<PatchValidation> {
  const base = { model_id: entry.model_id, provider_id: entry.provider_id };
  calls.checkStop();
  let provider;
  try { provider = calls.provider(entry); }
  catch (error) {
    return { ...base, passed: null, skipped: true, reason: (error as Error).message };
  }
  if (entry.cost_class === 'free' && !hasBudgetNow(provider)) {
    return { ...base, passed: null, skipped: true, reason: 'Validator has no rate budget' };
  }
  let stopped: WorkerStop | undefined;
  const result = await OutputValidator.validate(goal, diff, {
    executeTask: async (_model, prompt) => {
      try { return await calls.execute(entry, '', prompt); }
      catch (error) {
        // OutputValidator converts provider errors to skipped; task budget and
        // cancel must still terminate the worker.
        if (error instanceof WorkerStop) stopped = error;
        throw error;
      }
    },
  }, entry.model_id);
  if (stopped) throw stopped;
  calls.checkStop();
  return { ...base, passed: result.passed, skipped: result.skipped || result.passed === null, reason: result.reason };
}
