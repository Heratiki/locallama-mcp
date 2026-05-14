export interface ModelMetadata {
  id: string;
  name: string;
  provider: string;
  capabilities: {
    chat: boolean;
    code: boolean;
    vision: boolean;
    maxContextTokens: number;
  };
  costPerToken: { prompt: number; completion: number };
  promptingTemplate: string; // Reference to strategy
}

export class ModelRegistry {
  private models: Map<string, ModelMetadata> = new Map();

  async loadFromConfig(configPath: string): Promise<void> {
    const config = await import(configPath);
    config.models.forEach((model: ModelMetadata) => {
      this.models.set(model.id, model);
    });
  }

  getModel(modelId: string): ModelMetadata | undefined {
    return this.models.get(modelId);
  }

  registerModel(model: ModelMetadata): void {
    this.models.set(model.id, model);
  }
}