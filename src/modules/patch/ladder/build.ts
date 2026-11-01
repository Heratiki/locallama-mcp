import type { LLMProvider, ProviderModel } from '../../core/provider/types.js';
import { getProviderRegistry } from '../../core/provider/index.js';
import type { LadderEntry } from '../types.js';
import { benchmarkCodeScore, normalizeModelId, parseParamsB, type ModelMetaLike } from './model-match.js';

/** What the ladder needs from ProviderRegistry. */
export interface LadderProviders {
  list(): LLMProvider[];
}

/** What the ladder needs from ModelRegistry. */
export interface LadderModelScores {
  getModel(modelId: string): ModelMetaLike | undefined;
  /** When present, scores are also matched across provider prefix and `.gguf` (#153). */
  listAll?(): ModelMetaLike[];
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
  /** Benchmark-derived code score; -Infinity when none. */
  score: number;
  /** Parameter size in billions; 0 when unknown. Ranks models with no score. */
  size: number;
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
    // Only an open circuit breaker (real call failures) should keep a provider
    // out of the ladder. For local providers, skip the provider-level
    // isAvailable() health gate so a router still loading its models is not
    // dropped at submit time.
    if (!getProviderRegistry().isAvailable(provider.id)) return [];
    if (!provider.isLocal && !(await provider.isAvailable())) return [];
    return await provider.listModels();
  } catch {
    return [];
  }
}

function rank(list: Candidate[], keep: number): LadderEntry[] {
  const seen = new Set<string>();
  const out: LadderEntry[] = [];
  const sorted = [...list].sort((a, b) => b.score - a.score || b.size - a.size || a.order - b.order);
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
 * Ranked by the benchmark-derived `code` score (seeded or feedback scores do
 * not count). Models with no score rank after the scored ones, by parameter
 * size (bigger first), then provider order. Ids match stored scores across a
 * provider prefix and `.gguf` suffix.
 * An empty result means ladder_exhausted at submit.
 */
export async function buildLadder(opts: BuildLadderOptions): Promise<LadderEntry[]> {
  const local: Candidate[] = [];
  const free: Candidate[] = [];
  const paid: Candidate[] = [];
  let order = 0;
  // Normalized id -> best benchmark code score, from every registry entry.
  const byNorm = new Map<string, number>();
  for (const meta of opts.models.listAll?.() ?? []) {
    const s = benchmarkCodeScore(meta);
    if (s === undefined || !meta.id) continue;
    const key = normalizeModelId(meta.id);
    byNorm.set(key, Math.max(byNorm.get(key) ?? -Infinity, s));
  }
  const scoreOf = (id: string): number => {
    const direct = benchmarkCodeScore(opts.models.getModel(id));
    const viaNorm = byNorm.get(normalizeModelId(id));
    return Math.max(direct ?? -Infinity, viaNorm ?? -Infinity);
  };
  const sizeOf = (id: string): number =>
    opts.models.getModel(id)?.parameters ?? parseParamsB(id) ?? 0;

  for (const provider of opts.providers.list()) {
    const isLocal = provider.isLocal || provider.costClass === 'local';
    const models = await listSafe(provider);
    for (const m of models) {
      const score = scoreOf(m.id);
      const size = sizeOf(m.id);
      order += 1;
      if (isLocal) {
        local.push({ entry: { model_id: m.id, provider_id: provider.id, cost_class: 'local' }, score, size, order });
        continue;
      }
      const price = priceOf(provider, m);
      if (!price) continue;
      if (price.prompt === 0 && price.completion === 0) {
        free.push({ entry: { model_id: m.id, provider_id: provider.id, cost_class: 'free' }, score, size, order });
      } else {
        paid.push({
          entry: {
            model_id: m.id, provider_id: provider.id, cost_class: 'paid',
            prompt_price: price.prompt, completion_price: price.completion,
          },
          score, size, order,
        });
      }
    }
  }

  const ladder = [...rank(local, opts.localModels), ...rank(free, opts.freeModels)];
  if (opts.allowPaid && !opts.freeOnly) ladder.push(...rank(paid, opts.paidModels));
  return ladder;
}
