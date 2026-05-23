import { logger } from '../../../utils/logger.js';
import { CostClass, LLMProvider } from './types.js';
import { CircuitBreaker } from './circuit-breaker.js';
import { ProviderQueueStats, ProviderRateLimiter, ProviderScheduleOptions } from './rate-limiter.js';
import { config } from '../../../config/index.js';
import fs from 'fs/promises';
import path from 'path';

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

  // --- Circuit breaker (Issue 24) ---
  private readonly circuitBreaker = new CircuitBreaker();

  // --- Health probe (Issue 26) ---
  private healthProbeTimer: ReturnType<typeof setInterval> | undefined;
  private availabilityMap = new Map<string, boolean>();
  private readonly rateLimiter = new ProviderRateLimiter({
    maxConcurrentLocal: config.providerMaxConcurrentLocal,
    maxConcurrentRemote: config.providerMaxConcurrentRemote,
  });

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

    // Load compatibility matrix
    let compatMatrix: Record<string, string> = {};
    try {
      const filePath = path.join(config.rootDir, 'src', 'config', 'provider-compat.json');
      const raw = await fs.readFile(filePath, 'utf-8');
      compatMatrix = JSON.parse(raw) as Record<string, string>;
    } catch (err) {
      logger.warn(`[Provider Compatibility] Failed to load provider-compat.json: ${err instanceof Error ? err.message : String(err)}`);
    }

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

        if (provider.getVersion) {
          try {
            const detected = await provider.getVersion();
            if (detected) {
              const minVersion = compatMatrix[provider.id];
              if (minVersion) {
                if (compareVersions(detected, minVersion) < 0) {
                  logger.warn(
                    `[Provider Compatibility] Provider '${provider.id}' version '${detected}' is below the minimum required version '${minVersion}'.`
                  );
                }
              }
            } else {
              logger.warn(`[Provider Compatibility] Could not determine version for provider '${provider.id}'.`);
            }
          } catch (versionError) {
            logger.warn(
              `[Provider Compatibility] Error checking version for provider '${provider.id}': ${
                versionError instanceof Error ? versionError.message : String(versionError)
              }`
            );
          }
        }
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        logger.error(`Provider '${provider.id}' failed to initialize: ${msg}`);
      }
    }
    return successes;
  }

  // ---------------------------------------------------------------------------
  // Circuit breaker (Issue 24)
  // ---------------------------------------------------------------------------

  /**
   * Returns `true` when the circuit breaker allows calls to this provider
   * (i.e., the circuit is CLOSED or HALF_OPEN). Returns `true` for unknown
   * providers (no failures recorded yet).
   */
  isAvailable(providerId: string): boolean {
    return this.circuitBreaker.isAvailable(providerId);
  }

  /** Record a successful call to `providerId` (closes an open circuit). */
  recordProviderSuccess(providerId: string): void {
    this.circuitBreaker.recordSuccess(providerId);
  }

  /** Record a failed call to `providerId` (increments failure counter). */
  recordProviderFailure(providerId: string): void {
    this.circuitBreaker.recordFailure(providerId);
  }

  async executeWithConcurrencyLimit<T>(provider: LLMProvider, run: () => Promise<T>, options?: ProviderScheduleOptions): Promise<T> {
    return await this.rateLimiter.schedule(
      provider.id,
      provider.isLocal ? 'local' : 'remote',
      run,
      options,
    );
  }

  getExecutionQueueStats(providerId: string): ProviderQueueStats {
    const provider = this.providers.get(providerId);
    if (!provider) {
      return {
        activeCount: 0,
        queuedCount: 0,
        activeBenchmarks: 0,
        queuedBenchmarks: 0,
      };
    }

    return this.rateLimiter.getQueueStats(
      provider.id,
      provider.isLocal ? 'local' : 'remote',
    );
  }

  getLocalExecutionQueueStats(): ProviderQueueStats {
    return this.rateLimiter.getQueueStats('local', 'local');
  }

  // ---------------------------------------------------------------------------
  // Health probe (Issue 26)
  // ---------------------------------------------------------------------------

  /**
   * Start a background loop that calls `provider.isAvailable()` on every
    * registered provider every `intervalMs` milliseconds (default 60 000).
   * Availability changes are logged and fed into the circuit breaker.
   *
   * Calling this when the probe is already running is a no-op.
   */
  startHealthProbe(intervalMs = 60_000): void {
    if (this.healthProbeTimer) return;
    this.healthProbeTimer = setInterval(() => {
      void this.runHealthProbe();
    }, intervalMs);
    // Allow the Node.js event loop to exit even if the timer is still running.
    if (typeof this.healthProbeTimer === 'object' && 'unref' in this.healthProbeTimer) {
      (this.healthProbeTimer as { unref(): void }).unref();
    }
  }

  /** Stop the background health probe loop. */
  stopHealthProbe(): void {
    if (this.healthProbeTimer) {
      clearInterval(this.healthProbeTimer);
      this.healthProbeTimer = undefined;
    }
  }

  private async runHealthProbe(): Promise<void> {
    for (const provider of this.list()) {
      try {
        const available = await provider.isAvailable();
        const previous = this.availabilityMap.get(provider.id);
        this.availabilityMap.set(provider.id, available);

        if (previous !== undefined && previous !== available) {
          if (available) {
            logger.info(`Health probe: provider '${provider.id}' is now available`);
          } else {
            logger.warn(`Health probe: provider '${provider.id}' is no longer available`);
          }
        }

        if (available) {
          this.circuitBreaker.recordSuccess(provider.id);
        } else {
          this.circuitBreaker.recordFailure(provider.id);
        }
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        logger.debug(`Health probe: provider '${provider.id}' threw: ${msg}`);
        this.circuitBreaker.recordFailure(provider.id);
      }
    }
  }

  // ---------------------------------------------------------------------------

  /**
   * Test-only: drop all providers. Production code should never call this.
   */
  clear(): void {
    this.providers.clear();
    this.initialized.clear();
    this.stopHealthProbe();
    this.availabilityMap.clear();
    this.rateLimiter.clear();
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

/**
 * Helper to compare two version strings.
 * Returns -1 if v1 < v2, 1 if v1 > v2, 0 if v1 === v2.
 */
function compareVersions(v1: string, v2: string): number {
  const clean = (v: string) => {
    const match = v.match(/(\d+\.\d+(?:\.\d+)?)/);
    return match ? match[1] : '0.0.0';
  };
  
  const parse = (v: string) => clean(v).split('.').map(Number);
  const parts1 = parse(v1);
  const parts2 = parse(v2);
  const length = Math.max(parts1.length, parts2.length);
  for (let i = 0; i < length; i++) {
    const p1 = parts1[i] || 0;
    const p2 = parts2[i] || 0;
    if (p1 !== p2) return p1 > p2 ? 1 : -1;
  }
  return 0;
}
