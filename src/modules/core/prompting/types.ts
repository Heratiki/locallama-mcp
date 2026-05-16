/**
 * Unified prompting strategy types for Section 4 of PLAN.md.
 *
 * The central `prompting-strategies.json` file is the single source of truth
 * for strategy definitions. Each provider's per-model learned strategies are
 * user overrides stored in `~/.locallama/strategies.json`.
 */

/** Describes which models a strategy applies to (family-level or provider-level). */
export interface PromptingStrategyAppliesTo {
  /** Model family strings this strategy applies to (e.g. 'llama', 'qwen-coder'). */
  families?: string[];
  /** Provider IDs this strategy applies to (e.g. 'openrouter', 'lm-studio'). */
  providerIds?: string[];
  /** Regex patterns matched against the model id (case-insensitive). */
  modelIdPatterns?: string[];
}

/** A single strategy definition as it appears in `prompting-strategies.json`. */
export interface PromptingStrategyDef {
  /** Unique strategy identifier (referenced by `ModelMetadata.promptingStrategyId`). */
  id: string;
  /** Criteria for automatically selecting this strategy during model registration. */
  appliesTo?: PromptingStrategyAppliesTo;
  /** System prompt text. */
  systemPrompt: string;
  /** Optional user prompt template (may contain `{{task}}` placeholder). */
  userPromptTemplate?: string;
  /** Optional assistant prompt template. */
  assistantPromptTemplate?: string;
  /** Whether to use chat-completion format (true) or text-completion format (false). */
  useChat: boolean;
  /** Optional stop sequences. */
  stopSequences?: string[];
  /** Optional default temperature override (0..2). */
  temperature?: number;
}

/** Root shape of `prompting-strategies.json`. */
export interface PromptingStrategiesConfig {
  strategies: PromptingStrategyDef[];
  /** Id of the strategy to use when no `appliesTo` rule matches. Must exist in `strategies`. */
  defaultStrategyId: string;
}

/**
 * Per-model strategy override as written by the auto-improvement loop.
 * Stored in `~/.locallama/strategies.json` keyed by model id.
 */
export interface UserStrategyOverride {
  modelId: string;
  systemPrompt?: string;
  userPrompt?: string;
  assistantPrompt?: string;
  useChat?: boolean;
  stopSequences?: string[];
  temperature?: number;
  /** Optional: pin a specific central strategy id instead of overriding text directly. */
  strategyId?: string;
}

/** Shape of the user-override file `~/.locallama/strategies.json`. */
export type UserStrategiesFile = Record<string, UserStrategyOverride>;
