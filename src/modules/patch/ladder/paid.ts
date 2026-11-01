import type { LadderEntry } from '../types.js';

export interface PaidState {
  paid_spent_usd: number;
  paid_reserved_usd: number;
}

export interface PaidUsage {
  promptTokens?: number;
  completionTokens?: number;
}

export type Reservation =
  | { ok: true; amount: number }
  | { ok: false; reason: 'paid_cap' };

/** Rough token estimate (4 chars per token); used for reservations and budgets. */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/**
 * PRD 5.11 paid accounting. `persist` writes paid_spent_usd / paid_reserved_usd
 * (to patch_state) and runs before the call starts.
 */
export class PaidLedger {
  constructor(
    private readonly state: PaidState,
    private readonly capUsd: number,
    private readonly maxOutputTokens: number,
    private readonly persist: (s: PaidState) => void = () => undefined,
  ) {}

  get spent(): number { return this.state.paid_spent_usd; }
  get reserved(): number { return this.state.paid_reserved_usd; }

  /** Reserve before a paid call. An unknown price never counts as zero. */
  reserve(entry: LadderEntry, promptTokens: number): Reservation {
    if (entry.cost_class !== 'paid' ||
        !Number.isFinite(entry.prompt_price) || !Number.isFinite(entry.completion_price)) {
      return { ok: false, reason: 'paid_cap' };
    }
    const amount = promptTokens * entry.prompt_price + this.maxOutputTokens * entry.completion_price;
    if (!Number.isFinite(amount) || this.state.paid_spent_usd + amount > this.capUsd) {
      return { ok: false, reason: 'paid_cap' };
    }
    this.state.paid_reserved_usd = amount;
    this.persist({ ...this.state });
    return { ok: true, amount };
  }

  /**
   * After the call: add actual cost from usage, else the reservation. Actual is
   * clamped to the reservation so spent never exceeds the cap. Returns the cost added.
   */
  settle(entry: LadderEntry, reservation: number, usage?: PaidUsage): number {
    let cost = reservation;
    if (entry.cost_class === 'paid' && usage &&
        Number.isFinite(usage.promptTokens) && Number.isFinite(usage.completionTokens)) {
      const actual = (usage.promptTokens as number) * entry.prompt_price +
        (usage.completionTokens as number) * entry.completion_price;
      if (Number.isFinite(actual) && actual >= 0) cost = Math.min(actual, reservation);
    }
    this.state.paid_spent_usd += cost;
    this.state.paid_reserved_usd = 0;
    this.persist({ ...this.state });
    return cost;
  }

  /** Clear a reservation when the call never ran; nothing is charged. */
  release(): void {
    this.state.paid_reserved_usd = 0;
    this.persist({ ...this.state });
  }
}
