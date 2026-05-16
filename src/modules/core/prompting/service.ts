import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import { fileURLToPath } from 'url';
import { logger } from '../../../utils/logger.js';
import type {
  PromptingStrategyDef,
  PromptingStrategiesConfig,
  UserStrategiesFile,
} from './types.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Built-in strategies config lives in src/config/ next to models.json.
// At runtime resolves relative to dist/modules/core/prompting/service.js.
const BUILTIN_CONFIG_PATH = path.resolve(
  __dirname,
  '../../../../config/prompting-strategies.json',
);

/** Path where the auto-improvement loop writes learned per-model strategies. */
export const USER_STRATEGIES_PATH = path.join(
  os.homedir(),
  '.locallama',
  'strategies.json',
);

// ---------------------------------------------------------------------------
// PromptingStrategyService
// ---------------------------------------------------------------------------

/**
 * Single authority for prompting strategy resolution.
 *
 * Resolution priority for `resolveStrategyId(modelId, family?, providerId?)`:
 *  1. Provider + family match (appliesTo.providerIds + appliesTo.families)
 *  2. Provider match only (appliesTo.providerIds, no family restriction)
 *  3. Family match (appliesTo.families)
 *  4. modelId pattern match (appliesTo.modelIdPatterns)
 *  5. `defaultStrategyId` from the config
 */
export class PromptingStrategyService {
  private strategies: PromptingStrategyDef[] = [];
  private defaultStrategyId = 'default';

  // ---------------------------------------------------------------------------
  // Loading
  // ---------------------------------------------------------------------------

  /**
   * Load strategies from the built-in config file.
   * User overrides in `~/.locallama/strategies.json` are not loaded here —
   * those are per-model overrides consumed at execution time by each provider.
   *
   * @param configPath  Override the path to `prompting-strategies.json`
   *                    (used in tests to supply a temp file).
   */
  async loadFromFile(configPath?: string): Promise<void> {
    const filePath = configPath ?? BUILTIN_CONFIG_PATH;
    try {
      const raw = await fs.readFile(filePath, 'utf-8');
      const parsed = JSON.parse(raw) as PromptingStrategiesConfig;
      if (!Array.isArray(parsed.strategies)) {
        logger.warn(`PromptingStrategyService: 'strategies' is not an array in ${filePath}`);
        return;
      }
      this.strategies = parsed.strategies;
      this.defaultStrategyId = parsed.defaultStrategyId ?? 'default';
      logger.debug(
        `PromptingStrategyService: loaded ${this.strategies.length} strategies` +
          ` (default: '${this.defaultStrategyId}') from ${filePath}`,
      );
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        logger.debug(
          `PromptingStrategyService: no config at ${filePath} — keeping defaults`,
        );
      } else {
        logger.warn(
          `PromptingStrategyService: failed to parse ${filePath}: ${String(err)}`,
        );
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Resolution
  // ---------------------------------------------------------------------------

  /**
   * Resolve the best strategy id for a model.
   *
   * @param modelId    The model's unique id (e.g. 'qwen2.5-coder-7b').
   * @param family     Optional model family string (e.g. 'qwen-coder').
   * @param providerId Optional provider id (e.g. 'openrouter').
   * @returns          A strategy id that exists in the loaded config.
   */
  resolveStrategyId(
    modelId: string,
    family?: string,
    providerId?: string,
  ): string {
    // Priority 1: provider + family both match
    if (providerId && family) {
      const hit = this.strategies.find(
        (s) =>
          s.appliesTo?.providerIds?.includes(providerId) &&
          s.appliesTo.families?.includes(family),
      );
      if (hit) return hit.id;
    }

    // Priority 2: provider match only (no family restriction in the strategy)
    if (providerId) {
      const hit = this.strategies.find(
        (s) =>
          s.appliesTo?.providerIds?.includes(providerId) &&
          !s.appliesTo.families,
      );
      if (hit) return hit.id;
    }

    // Priority 3: family match
    if (family) {
      const hit = this.strategies.find((s) =>
        s.appliesTo?.families?.includes(family),
      );
      if (hit) return hit.id;
    }

    // Priority 4: modelId pattern match
    const byPattern = this.strategies.find((s) =>
      s.appliesTo?.modelIdPatterns?.some((p) => {
        try {
          return new RegExp(p, 'i').test(modelId);
        } catch {
          return false;
        }
      }),
    );
    if (byPattern) return byPattern.id;

    return this.defaultStrategyId;
  }

  // ---------------------------------------------------------------------------
  // Reads
  // ---------------------------------------------------------------------------

  /** Return the full strategy definition for a given id, or `undefined`. */
  getStrategy(id: string): PromptingStrategyDef | undefined {
    return this.strategies.find((s) => s.id === id);
  }

  /** Return all loaded strategy definitions. */
  listStrategies(): PromptingStrategyDef[] {
    return [...this.strategies];
  }

  get defaultId(): string {
    return this.defaultStrategyId;
  }

  // ---------------------------------------------------------------------------
  // User-override file helpers (used by provider auto-improvement loops)
  // ---------------------------------------------------------------------------

  /**
   * Read the user-override file (`~/.locallama/strategies.json`).
   * Returns an empty object when the file doesn't exist.
   */
  async readUserOverrides(filePath?: string): Promise<UserStrategiesFile> {
    const p = filePath ?? USER_STRATEGIES_PATH;
    try {
      const raw = await fs.readFile(p, 'utf-8');
      return JSON.parse(raw) as UserStrategiesFile;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
        logger.warn(`PromptingStrategyService: could not read user overrides at ${p}: ${String(err)}`);
      }
      return {};
    }
  }

  /**
   * Merge `updates` into the user-override file, then write it back.
   * Existing entries for other model ids are preserved.
   */
  async mergeUserOverrides(
    updates: UserStrategiesFile,
    filePath?: string,
  ): Promise<void> {
    const p = filePath ?? USER_STRATEGIES_PATH;
    const existing = await this.readUserOverrides(p);
    const merged = { ...existing, ...updates };
    try {
      await fs.mkdir(path.dirname(p), { recursive: true });
      await fs.writeFile(p, JSON.stringify(merged, null, 2));
      logger.debug(
        `PromptingStrategyService: wrote ${Object.keys(updates).length} user override(s) to ${p}`,
      );
    } catch (err) {
      logger.warn(`PromptingStrategyService: could not write user overrides to ${p}: ${String(err)}`);
    }
  }
}

// ---------------------------------------------------------------------------
// Singleton
// ---------------------------------------------------------------------------

let _instance: PromptingStrategyService | undefined;

/** Return the process-wide singleton. Created lazily on first call. */
export function getPromptingStrategyService(): PromptingStrategyService {
  if (!_instance) {
    _instance = new PromptingStrategyService();
  }
  return _instance;
}

/** Replace the singleton — used only in tests. */
export function _setPromptingStrategyServiceForTests(
  svc: PromptingStrategyService,
): void {
  _instance = svc;
}
