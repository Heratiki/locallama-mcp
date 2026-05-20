import type { ModelRegistry } from './model/registry.js';
import type { ModelCapabilities } from './model/types.js';
import type { ProviderModel } from './provider/types.js';

export type { ModelCapabilities };

// ---------------------------------------------------------------------------
// Heuristic tables (shared between static inference and instance detection)
// ---------------------------------------------------------------------------

const CODE_FAMILIES = new Set([
  'codellama',
  'deepseek-coder',
  'qwen-coder',
  'starcoder',
  'codestral',
]);

const VISION_PATTERNS = /vision|vl\b|llava|bakllava|qwen2[.-]?vl/i;
const CODE_PATTERNS = /code|coder/i;

/**
 * Families + id patterns that indicate reliable tool-use capability.
 * The model must also have >= 7B parameters (extracted from the id if not
 * declared) to be considered capable.
 */
const TOOL_USE_FAMILIES = new Set(['gpt', 'claude', 'mistral-large']);
const TOOL_USE_ID_PATTERNS = /qwen2\.5|llama[.-]3\.1|mistral[.-]large/i;

/**
 * Extract a parameter count (in billions) from a model id like
 * `llama-3.1-70b` → 70 or `qwen2.5-coder-7b` → 7. Returns undefined if the
 * id doesn't include a clear `<n>b` token.
 */
function extractParametersBillions(modelId: string): number | undefined {
  // Match patterns like 7b, 70b, 1.5b, 2.5b (case-insensitive, word boundary)
  const match = modelId.match(/(\d+(?:\.\d+)?)\s*[bB]\b/);
  return match ? parseFloat(match[1]) : undefined;
}

/**
 * Infer whether a model supports tool / function calling.
 * Uses family + id pattern matching plus a 7B parameter floor.
 */
function inferToolUse(id: string, family: string, parameters?: number): boolean {
  const params = parameters ?? extractParametersBillions(id);
  // Models under 7B are generally unreliable at tool use
  if (params !== undefined && params < 7) return false;
  if (TOOL_USE_FAMILIES.has(family)) return true;
  if (TOOL_USE_ID_PATTERNS.test(id)) return true;
  return false;
}

/** Conservative defaults returned for completely unknown models. */
function conservativeDefaults(): ModelCapabilities {
  return {
    chat: true,
    code: false,
    vision: false,
    toolUse: false,
    largeContext: false,
    maxContextTokens: 4096,
  };
}

// ---------------------------------------------------------------------------
// CapabilityDetector
// ---------------------------------------------------------------------------

/**
 * Three-layer capability inference (Section 5 of PLAN.md):
 *
 * 1. **Declared** — the ModelRegistry entry reflects models.json overrides
 *    applied at seeding time.  The stored `capabilities` object is the
 *    authoritative source unless empirical data says otherwise.
 *
 * 2. **Heuristic** — id / family pattern matching adds `toolUse` (and
 *    re-derives other flags for models not yet in the registry).
 *    `inferFromProviderModel()` is a static helper used by `ModelRegistry`
 *    during seeding — this eliminates the local `inferCapabilities` helper
 *    that previously lived in registry.ts.
 *
 * 3. **Empirical** — benchmark scores stored in `BenchmarkSummary.scores`
 *    can flip capability flags.  A code score below 0.3 removes the `code`
 *    flag even if the model name implies it.
 *
 * The detector never throws for unknown models — it returns conservative
 * defaults (`{ chat: true, everything-else: false }`).
 */
export class CapabilityDetector {
  private modelRegistry: ModelRegistry;

  constructor(modelRegistry: ModelRegistry) {
    this.modelRegistry = modelRegistry;
  }

  /**
   * Detect capabilities for a registered model using all three layers.
   * Call this instead of reading `model.capabilities` directly when you need
   * the empirical corrections from benchmark data.
   */
  detectCapabilities(modelId: string): ModelCapabilities {
    const model = this.modelRegistry.getModel(modelId);
    if (!model) {
      return conservativeDefaults();
    }

    // Layer 1 + 2: start from the registry's stored capabilities (seeded with
    // heuristics) and re-derive toolUse in case it was false at seed time.
    const id = model.id.toLowerCase();
    const family = (model.family ?? '').toLowerCase();
    const base: ModelCapabilities = {
      ...model.capabilities,
      toolUse:
        model.capabilities.toolUse ||
        inferToolUse(id, family, model.parameters),
    };

    // Layer 3: empirical corrections.
    // Prefer benchmarkSummary.scores over the raw capabilities.scores since
    // the summary is written by an actual benchmark run.
    const scores = model.benchmarkSummary?.scores ?? model.capabilities.scores;
    if (!scores) return base;

    // A measured code score below 0.3 indicates the model consistently failed
    // code tasks — remove the code flag even if the name implied it.
    const codeFlag =
      scores.code !== undefined ? scores.code >= 0.3 : base.code;

    return {
      ...base,
      code: codeFlag,
      scores,
    };
  }

  /**
   * Infer capabilities purely from a `ProviderModel` (no registry needed).
   * Called by `ModelRegistry.seedFromProvider` so the registry stores accurate
   * capabilities at registration time, including `toolUse`.
   */
  static inferFromProviderModel(model: ProviderModel): ModelCapabilities {
    const id = model.id.toLowerCase();
    const family = (model.family ?? '').toLowerCase();
    const contextWindow = model.contextWindow ?? 4096;

    const code = CODE_FAMILIES.has(family) || CODE_PATTERNS.test(id);
    const vision = VISION_PATTERNS.test(id) || VISION_PATTERNS.test(family);
    const toolUse = inferToolUse(id, family);

    return {
      chat: true,
      code,
      vision,
      toolUse,
      largeContext: contextWindow >= 32768,
      maxContextTokens: contextWindow,
    };
  }
}

// ---------------------------------------------------------------------------
// Singleton
// ---------------------------------------------------------------------------

let singleton: CapabilityDetector | undefined;

/**
 * Initialize the process-wide CapabilityDetector singleton. Must be called
 * once at startup (after the ModelRegistry is seeded) before routing modules
 * call `getCapabilityDetector()`.
 */
export function initCapabilityDetector(modelRegistry: ModelRegistry): CapabilityDetector {
  singleton = new CapabilityDetector(modelRegistry);
  return singleton;
}

/**
 * Return the initialized CapabilityDetector singleton.
 * Throws if `initCapabilityDetector()` has not been called yet.
 */
export function getCapabilityDetector(): CapabilityDetector {
  if (!singleton) {
    throw new Error(
      'CapabilityDetector not initialized — call initCapabilityDetector() first.',
    );
  }
  return singleton;
}

/** Test-only: replace or clear the singleton. */
export function _setCapabilityDetectorForTests(
  d: CapabilityDetector | undefined,
): void {
  singleton = d;
}
