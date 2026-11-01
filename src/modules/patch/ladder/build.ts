import type { LLMProvider, ProviderModel } from '../../core/provider/types.js';
import type { LadderEntry } from '../types.js';

/** What the ladder needs from ProviderRegistry. */
export interface LadderProviders {
  list(): LLMProvider[];
}

/** What the ladder needs from ModelRegistry. */
export interface LadderModelScores {
  getModel(modelId: string): { capabilities?: { scores?: { code?: number } } } | undefined;
}

export interface BuildLadderOptions {
  providers: LadderProviders;
  models: LadderModelScores;
  allowPaid: boolean;
  /** OPENROUTER_FREE_ONLY */
  freeOnly: boolean;
  localModels: number;
  freeModels: number;
  paidModels: number;
}

interface Candidate {
  entry: LadderEntry;
  score: number;
  order: number;
}

function validPrice(n: unknown): n is number {
  return typeof n === 'number' && Number.isFinite(n) && n >= 0;
}

/** Known per-token price or null (unknown never counts as zero). */
function priceOf(provider: LLMProvider, model: ProviderModel): { prompt: number; completion: number } | null {
  let p: { prompt: number; completion: number } | undefined = model.costPerToken;
  if (!p) {
    try {
      p = provider.getCost(model.id);
    } catch {
      return null;
    }
  }
  if (!p || !validPrice(p.prompt) || !validPrice(p.completion)) return null;
  return { prompt: p.prompt, completion: p.completion };
}

async function listSafe(provider: LLMProvider): Promise<ProviderModel[]> {
  try {
    if (!(await provider.isAvailable())) return [];
    return await provider.listModels();
  } catch {
    return [];
  }
}

function rank(list: Candidate[], keep: number): LadderEntry[] {
  const seen = new Set<string>();
  const out: LadderEntry[] = [];
  const sorted = [...list].sort((a, b) => b.score - a.score || a.order - b.order);
  for (const c of sorted) {
    if (out.length >= keep) break;
    if (seen.has(c.entry.model_id)) continue;
    seen.add(c.entry.model_id);
    out.push(c.entry);
  }
  return out;
}

/**
 * Build the patch ladder: local, then free, then (opt-in) paid.
 * Ranked by the ModelRegistry `code` score; no score ranks last.
 * An empty result means ladder_exhausted at submit.
 */
export async function buildLadder(opts: BuildLadderOptions): Promise<LadderEntry[]> {
  const local: Candidate[] = [];
  const free: Candidate[] = [];
  const paid: Candidate[] = [];
  let order = 0;
  const scoreOf = (id: string): number => {
    const s = opts.models.getModel(id)?.capabilities?.scores?.code;
    return typeof s === 'number' && Number.isFinite(s) ? s : -Infinity;
  };

  for (const provider of opts.providers.list()) {
    const isLocal = provider.isLocal || provider.costClass === 'local';
    const models = await listSafe(provider);
    for (const m of models) {
      const score = scoreOf(m.id);
      order += 1;
      if (isLocal) {
        local.push({ entry: { model_id: m.id, provider_id: provider.id, cost_class: 'local' }, score, order });
        continue;
      }
      const price = priceOf(provider, m);
      if (!price) continue;
      if (price.prompt === 0 && price.completion === 0) {
        free.push({ entry: { model_id: m.id, provider_id: provider.id, cost_class: 'free' }, score, order });
      } else {
        paid.push({
          entry: {
            model_id: m.id, provider_id: provider.id, cost_class: 'paid',
            prompt_price: price.prompt, completion_price: price.completion,
          },
          score, order,
        });
      }
    }
  }

  const ladder = [...rank(local, opts.localModels), ...rank(free, opts.freeModels)];
  if (opts.allowPaid && !opts.freeOnly) ladder.push(...rank(paid, opts.paidModels));
  return ladder;
}
