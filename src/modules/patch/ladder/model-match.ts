/**
 * Model id matching and size parsing for the patch ladder (#153).
 *
 * Ranking rule (see build.ts): a model with a benchmark-derived `code` score
 * ranks first, by score. Models with no such score rank after, by parameter
 * size (bigger first), then by provider order. Seeded, EMA-feedback or
 * heuristic scores do not count as a score.
 */

const PROVIDER_PREFIX = /^(?:llama-?cpp|ollama|lm-?studio|openrouter):/i;

/**
 * One normal form for a model id: lower case, provider prefix and `.gguf`
 * suffix removed. `llama-cpp:Qwen3-8B-Q4_K_M.gguf` and `Qwen3-8B-Q4_K_M`
 * normalize to the same string. Applied to both sides of every lookup.
 */
export function normalizeModelId(id: string): string {
  return id.trim().replace(PROVIDER_PREFIX, '').replace(/\.gguf$/i, '').toLowerCase();
}

/** Ids that carry their size in the name but not as `<n>b`. */
const NAMED_SIZES: Array<[RegExp, number]> = [[/tinyllama/i, 1.1]];

/** Parameter count in billions parsed from an id (`8B`, `7b`, `1.5b`), or undefined. */
export function parseParamsB(id: string): number | undefined {
  const m = /(?:^|[^a-z0-9.])(\d+(?:\.\d+)?)b(?![a-z0-9])/i.exec(id);
  if (m) {
    const n = Number(m[1]);
    if (Number.isFinite(n) && n > 0) return n;
  }
  for (const [re, size] of NAMED_SIZES) if (re.test(id)) return size;
  return undefined;
}

/** The registry shape the ladder reads. `listAll` is optional (older fakes). */
export interface ModelMetaLike {
  id?: string;
  parameters?: number;
  capabilities?: { scores?: { code?: number } };
  benchmarkSummary?: { taskCategories?: string[]; scores?: { code?: number } };
}

/**
 * The benchmark-derived `code` score of one registry entry, or undefined.
 * With a benchmarkSummary, only a summary whose taskCategories include 'code'
 * counts (written by the model benchmarker); a score added by rate_model EMA
 * or a models-db import has no such category and counts as no score. An entry
 * with no benchmarkSummary is read from capabilities.scores.code.
 */
export function benchmarkCodeScore(meta: ModelMetaLike | undefined): number | undefined {
  if (!meta) return undefined;
  const summary = meta.benchmarkSummary;
  let s: number | undefined;
  if (summary) {
    if (!summary.taskCategories?.includes('code')) return undefined;
    s = summary.scores?.code ?? meta.capabilities?.scores?.code;
  } else {
    s = meta.capabilities?.scores?.code;
  }
  return typeof s === 'number' && Number.isFinite(s) ? s : undefined;
}
