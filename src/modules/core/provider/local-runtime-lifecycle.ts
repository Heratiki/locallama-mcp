import { logger } from '../../../utils/logger.js';
import type { LLMProvider } from './types.js';
import { getProviderRegistry } from './registry.js';

let activeLocalProviderId: string | undefined;
let activeLocalModelId: string | undefined;

export const localProviderLifecycle = {
  async beforeExecution(provider: LLMProvider, modelId: string): Promise<void> {
    if (!provider.isLocal) {
      return;
    }

    if (activeLocalProviderId && activeLocalProviderId !== provider.id) {
      const previousProvider = getProviderRegistry().get(activeLocalProviderId);
      if (previousProvider?.isLocal && previousProvider.releaseResources) {
        logger.info(
          `Switching local execution from ${activeLocalProviderId}:${activeLocalModelId ?? 'unknown'} to ${provider.id}:${modelId}; unloading previous local runtime first`,
        );
        await previousProvider.releaseResources({
          reason: 'cross-provider-handoff',
          modelId: activeLocalModelId,
        });
      } else {
        logger.debug(
          `Switching local execution from ${activeLocalProviderId} to ${provider.id} without explicit release hook on the previous provider`,
        );
      }
    }

    activeLocalProviderId = provider.id;
    activeLocalModelId = modelId;
  },
};

export function _resetLocalProviderLifecycleForTests(): void {
  activeLocalProviderId = undefined;
  activeLocalModelId = undefined;
}