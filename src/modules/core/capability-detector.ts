import { ModelRegistry } from './model/registry.js';
import type { ModelCapabilities } from './model/types.js';

export type { ModelCapabilities };

export class CapabilityDetector {
  private modelRegistry: ModelRegistry;

  constructor(modelRegistry: ModelRegistry) {
    this.modelRegistry = modelRegistry;
  }

  detectCapabilities(modelId: string): ModelCapabilities {
    const model = this.modelRegistry.getModel(modelId);
    if (!model) {
      // Return conservative defaults rather than throwing — Section 5 will
      // make this smarter with heuristic + empirical layers.
      return {
        chat: true,
        code: false,
        vision: false,
        toolUse: false,
        largeContext: false,
        maxContextTokens: 4096,
      };
    }
    return model.capabilities;
  }
}