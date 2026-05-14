import { ModelRegistry } from './model-registry';

export interface ModelCapabilities {
  chat: boolean;
  code: boolean;
  vision: boolean;
  maxContextTokens: number;
}

export class CapabilityDetector {
  private modelRegistry: ModelRegistry;

  constructor(modelRegistry: ModelRegistry) {
    this.modelRegistry = modelRegistry;
  }

  detectCapabilities(modelId: string): ModelCapabilities {
    const model = this.modelRegistry.getModel(modelId);
    if (!model) {
      throw new Error(`Model not found: ${modelId}`);
    }

    // Example logic for capability detection
    return {
      chat: model.capabilities.chat,
      code: model.capabilities.code,
      vision: model.capabilities.vision,
      maxContextTokens: model.capabilities.maxContextTokens,
    };
  }
}