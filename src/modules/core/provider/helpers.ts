import { CostClass } from './types.js';
import { getProviderRegistry } from './registry.js';
import type { TaskExecutionOptions, TaskExecutionResult } from './types.js';

/**
 * Fallback set of provider ids known to be local. Consulted only when the
 * runtime registry has not (yet) been populated — for instance, in unit tests
 * that import classification code directly without bootstrapping the server.
 */
const KNOWN_LOCAL_PROVIDER_IDS: ReadonlySet<string> = new Set([
  'local',
  'lm-studio',
  'ollama',
]);

/**
 * Is the given provider id considered "local" (no network egress, no cost)?
 *
 * Resolution order:
 *   1. If the provider is registered, trust `LLMProvider.isLocal`.
 *   2. Otherwise fall back to the known-local set so legacy call sites and
 *      tests behave identically to the pre-registry literal checks.
 */
export function isProviderLocal(providerId: string | undefined | null): boolean {
  if (!providerId) return false;
  const provider = getProviderRegistry().get(providerId);
  if (provider) return provider.isLocal;
  return KNOWN_LOCAL_PROVIDER_IDS.has(providerId);
}

/**
 * Cost class for a provider id, falling back to a sensible default when the
 * provider is not registered (local for known-local ids, paid otherwise).
 */
export function providerCostClass(providerId: string | undefined | null): CostClass {
  if (!providerId) return 'paid';
  const provider = getProviderRegistry().get(providerId);
  if (provider) return provider.costClass;
  return KNOWN_LOCAL_PROVIDER_IDS.has(providerId) ? 'local' : 'paid';
}

/**
 * Compare a model's provider against a specific provider id without using a
 * raw string-literal comparison at the call site. Routes through the registry
 * when possible; falls back to direct id comparison so legacy data
 * (deserialized from disk, etc.) still resolves correctly.
 */
export function isProviderId(
  modelProvider: string | undefined | null,
  expectedId: string,
): boolean {
  if (!modelProvider) return false;
  const provider = getProviderRegistry().get(modelProvider);
  if (provider) return provider.id === expectedId;
  return modelProvider === expectedId;
}

/**
 * Execute a task through the provider registry so all callers inherit
 * circuit-breaker and concurrency-limit protections.
 */
export async function executeProviderTask(
  providerId: string,
  modelId: string,
  task: string,
  options?: TaskExecutionOptions,
): Promise<TaskExecutionResult> {
  const registry = getProviderRegistry();
  const provider = registry.get(providerId);
  if (!provider) {
    throw new Error(`Provider '${providerId}' is not registered`);
  }

  if (!registry.isAvailable(provider.id)) {
    throw new Error(`Provider '${provider.id}' is temporarily unavailable (circuit open)`);
  }

  try {
    const result = await registry.executeWithConcurrencyLimit(
      provider,
      async () => await provider.executeTask(modelId, task, options),
    );
    registry.recordProviderSuccess(provider.id);
    return result;
  } catch (error) {
    registry.recordProviderFailure(provider.id);
    throw error;
  }
}
