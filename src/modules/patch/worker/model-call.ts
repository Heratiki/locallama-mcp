import type { ProviderRegistry } from '../../core/provider/registry.js';
import { abortError, raceAbort, type LLMProvider, type TaskExecutionResult } from '../../core/provider/types.js';
import { assertPromptWithinContextWindow, resolveModelContextWindow, ContextWindowError } from '../../utils/contextWindow.js';
import { countTokens } from '../../utils/tokenCount.js';
import { PaidLedger, promptTokensOf } from '../ladder/index.js';
import type { LadderEntry, PatchState } from '../types.js';
import { InferenceTimeout, WorkerStop, type CallUsage, type WorkerSettings } from './contracts.js';

export interface ModelCallOptions {
  registry: Pick<ProviderRegistry, 'get' | 'executeWithConcurrencyLimit'>;
  state: PatchState;
  settings: WorkerSettings;
  capUsd: number;
  signal: AbortSignal;
  now: () => number;
  persistSpend: (value: { paid_spent_usd: number; paid_reserved_usd: number }) => Promise<void>;
}

/** All generation and judge calls share this path, cancellation and ledger. */
export class PatchModelCalls {
  readonly usage: CallUsage[] = [];
  private readonly ledger: PaidLedger;
  private previousCall: Promise<unknown> = Promise.resolve();

  constructor(private readonly options: ModelCallOptions) {
    this.ledger = new PaidLedger(options.state, options.capUsd, options.settings.patchMaxOutputTokens);
  }

  async recoverReservation(): Promise<void> {
    const { state } = this.options;
    if (state.paid_reserved_usd === 0) return;
    // The provider may already have billed an interrupted call. Never release
    // that money and spend it again after a restart.
    state.paid_spent_usd += state.paid_reserved_usd;
    state.paid_reserved_usd = 0;
    await this.persist();
  }

  private persist(): Promise<void> {
    const { state, persistSpend } = this.options;
    return persistSpend({ paid_spent_usd: state.paid_spent_usd, paid_reserved_usd: state.paid_reserved_usd });
  }

  checkStop(): void {
    if (this.options.signal.aborted) {
      throw this.options.signal.reason instanceof WorkerStop ? this.options.signal.reason : new WorkerStop('cancelled');
    }
    if (this.options.now() >= this.options.state.deadline_at) throw new WorkerStop('budget_time');
  }

  async contextWindow(entry: LadderEntry): Promise<number> {
    const provider = this.provider(entry);
    const model = (await raceAbort(provider.listModels(), this.options.signal)).find(m => m.id === entry.model_id);
    return resolveModelContextWindow({ id: entry.model_id, provider: entry.provider_id, contextWindow: model?.contextWindow })
      .contextWindow ?? this.options.settings.patchContextTokens;
  }

  provider(entry: LadderEntry): LLMProvider {
    const provider = this.options.registry.get(entry.provider_id);
    if (!provider) throw new Error(`Patch provider unavailable: ${entry.provider_id}`);
    return provider;
  }

  async execute(
    entry: LadderEntry, system: string, prompt: string,
    beforeCall: () => Promise<void> = async () => {},
  ): Promise<TaskExecutionResult> {
    this.checkStop();
    const { settings, registry, signal, state, now } = this.options;
    // A timed-out provider may ignore abort. Wait for it before any next model
    // (including a different remote provider); task cancel/deadline still wins.
    await raceAbort(this.previousCall, signal);
    this.checkStop();
    const provider = this.provider(entry);
    const window = await this.contextWindow(entry);
    this.checkStop();
    assertPromptWithinContextWindow({ id: entry.model_id, provider: entry.provider_id, contextWindow: window }, `${system}\n${prompt}`);
    const promptTokens = promptTokensOf(system, prompt);
    if (promptTokens + settings.patchMaxOutputTokens > window) {
      throw new ContextWindowError(entry.model_id, promptTokens + settings.patchMaxOutputTokens, window);
    }
    let reservation = 0;
    if (entry.cost_class === 'paid') {
      const reserved = this.ledger.reserve(entry, promptTokens);
      if (!reserved.ok) throw new WorkerStop('paid_cap');
      reservation = reserved.amount;
      await this.persist();
    }
    let invoked = false;
    let result: TaskExecutionResult | undefined;
    const controller = new AbortController();
    let inferenceExpired = false;
    let deadlineExpired = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const onAbort = () => controller.abort();
    signal.addEventListener('abort', onAbort, { once: true });
    if (signal.aborted) onAbort();
    try {
      this.checkStop();
      await beforeCall();
      this.checkStop();
      const remaining = state.deadline_at - now();
      timer = setTimeout(() => {
        deadlineExpired = remaining <= settings.patchInferenceTimeoutMs;
        inferenceExpired = !deadlineExpired;
        controller.abort();
      }, Math.min(remaining, settings.patchInferenceTimeoutMs, 2_147_483_647));
      const scheduled = registry.executeWithConcurrencyLimit(provider, async () => {
        // Registry queues currently have no signal option. A cancelled/timed-out
        // queue entry must never invoke the provider after its slot opens.
        if (controller.signal.aborted) throw abortError();
        this.checkStop();
        invoked = true;
        return provider.executeTask(entry.model_id, prompt, {
          systemPrompt: system, maxTokens: settings.patchMaxOutputTokens,
          timeoutMs: settings.patchInferenceTimeoutMs, signal: controller.signal,
        });
      }, { modelId: entry.model_id, workload: 'task' });
      this.previousCall = scheduled.then(() => undefined, () => undefined);
      // Keep the underlying registry slot held until an unabortable call exits.
      // raceAbort discards its eventual output without releasing that slot early.
      result = await raceAbort(scheduled, controller.signal);
      this.checkStop();
      return result;
    } catch (error) {
      this.checkStop();
      if (deadlineExpired) throw new WorkerStop('budget_time');
      if (inferenceExpired || (error instanceof Error && /timed?\s*out|timeout/i.test(error.message))) throw new InferenceTimeout();
      throw error;
    } finally {
      clearTimeout(timer);
      signal.removeEventListener('abort', onAbort);
      let cost = 0;
      if (entry.cost_class === 'paid') {
        if (invoked) cost = this.ledger.settle(entry, reservation, result);
        else this.ledger.release();
        await this.persist();
      }
      if (invoked) {
        const valid = (n: number | undefined): n is number => n !== undefined && Number.isFinite(n) && n >= 0;
        this.usage.push({
          model_id: entry.model_id, provider_id: entry.provider_id, cost_class: entry.cost_class,
          prompt_tokens: valid(result?.promptTokens) ? result.promptTokens : promptTokens,
          completion_tokens: valid(result?.completionTokens) ? result.completionTokens : countTokens(result?.content ?? ''),
          cost_usd: cost,
        });
      }
    }
  }
}
