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
      // Cross-provider switch: unload the previous provider's model.
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
    } else if (
      activeLocalProviderId === provider.id &&
      activeLocalModelId !== undefined &&
      activeLocalModelId !== modelId
    ) {
      // Same-provider model switch: unload the previously loaded model to
      // free VRAM before loading the new one.
      if (provider.releaseResources) {
        logger.info(
          `Switching model within ${provider.id} from ${activeLocalModelId} to ${modelId}; unloading previous model to reclaim VRAM`,
        );
        await provider.releaseResources({
          reason: 'same-provider-model-switch',
          modelId: activeLocalModelId,
        });
      } else {
        logger.debug(
          `Model switch within ${provider.id} from ${activeLocalModelId} to ${modelId}: provider has no releaseResources hook`,
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