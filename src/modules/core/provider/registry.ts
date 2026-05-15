import { logger } from '../../../utils/logger.js';
import { CostClass, LLMProvider } from './types.js';

/**
 * Central registry of `LLMProvider` implementations. Lookups are by provider
 * `id`; routing/benchmarking layers ask the registry rather than switching on
 * provider string literals (see PLAN.md §1).
 *
 * Init isolation: a provider that throws from `init()` is logged and dropped,
 * but other providers continue to initialize.
 */
export class ProviderRegistry {
  private providers = new Map<string, LLMProvider>();
  private initialized = new Set<string>();

  register(provider: LLMProvider): void {
    if (this.providers.has(provider.id)) {
      logger.warn(`Provider '${provider.id}' is already registered; overwriting`);
    }
    this.providers.set(provider.id, provider);
  }

  unregister(providerId: string): boolean {
    this.initialized.delete(providerId);
    return this.providers.delete(providerId);
  }

  has(providerId: string): boolean {
    return this.providers.has(providerId);
  }

  get(providerId: string): LLMProvider | undefined {
    return this.providers.get(providerId);
  }

  list(): LLMProvider[] {
    return Array.from(this.providers.values());
  }

  listByCostClass(costClass: CostClass): LLMProvider[] {
    return this.list().filter((p) => p.costClass === costClass);
  }

  /**
   * Convenience: is the model's provider local? Used by routing to replace
   * `provider === 'local' || provider === 'lm-studio' || provider === 'ollama'`.
   * Unknown providers return `false`.
   */
  isLocalProvider(providerId: string): boolean {
    return this.providers.get(providerId)?.isLocal ?? false;
  }

  /**
   * Initialize every registered provider. Errors are isolated: one provider
   * failing does not prevent the others from booting. Returns the list of
   * provider ids that initialized successfully.
   */
  async initAll(): Promise<string[]> {
    const successes: string[] = [];
    for (const provider of this.list()) {
      if (this.initialized.has(provider.id)) {
        successes.push(provider.id);
        continue;
      }
      try {
        await provider.init();
        this.initialized.add(provider.id);
        successes.push(provider.id);
        logger.info(`Provider initialized: ${provider.id} (${provider.costClass})`);
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        logger.error(`Provider '${provider.id}' failed to initialize: ${msg}`);
      }
    }
    return successes;
  }

  /**
   * Test-only: drop all providers. Production code should never call this.
   */
  clear(): void {
    this.providers.clear();
    this.initialized.clear();
  }
}

let singleton: ProviderRegistry | undefined;

export function getProviderRegistry(): ProviderRegistry {
  if (!singleton) {
    singleton = new ProviderRegistry();
  }
  return singleton;
}

/**
 * Test-only: replace the singleton (e.g. with a fresh instance per test).
 * Production code should never call this.
 */
export function _setProviderRegistryForTests(registry: ProviderRegistry | undefined): void {
  singleton = registry;
}
