import type { Model } from '../../types/index.js';
import type { ModelMetadata } from '../core/model/types.js';
import { getModelRegistry } from '../core/model/index.js';
import { countTokens } from './tokenCount.js';

export class ContextWindowError extends Error {
  readonly name = 'ContextWindowError' as const;

  constructor(
    public readonly modelId: string,
    public readonly estimatedTokens: number,
    public readonly modelContextWindow: number,
  ) {
    super(
      `Task exceeds context window for model '${modelId}': ` +
        `estimated ${estimatedTokens} tokens > limit ${modelContextWindow} tokens`,
    );
  }

  get contextWindow(): number {
    return this.modelContextWindow;
  }
}

export interface ContextWindowCheckTarget {
  id: string;
  provider?: string;
  contextWindow?: number;
}

function stripProviderPrefix(modelId: string, providerId?: string): string {
  if (providerId && modelId.startsWith(`${providerId}:`)) {
    return modelId.slice(providerId.length + 1);
  }

  const knownPrefixes = ['lm-studio:', 'ollama:', 'openrouter:'];
  for (const prefix of knownPrefixes) {
    if (modelId.startsWith(prefix)) return modelId.slice(prefix.length);
  }

  return modelId;
}

export function resolveModelContextWindow(
  target: ContextWindowCheckTarget,
): { modelId: string; contextWindow?: number; metadata?: ModelMetadata } {
  const bareId = stripProviderPrefix(target.id, target.provider);
  const registry = getModelRegistry();
  const metadata = registry.getModel(bareId) ?? registry.getModel(target.id);

  return {
    modelId: target.id,
    contextWindow: target.contextWindow ?? metadata?.contextWindow,
    metadata,
  };
}

export function assertPromptWithinContextWindow(
  target: ContextWindowCheckTarget | Model,
  prompt: string,
): number {
  const { modelId, contextWindow } = resolveModelContextWindow(target);
  const estimatedTokens = countTokens(prompt, modelId);

  if (contextWindow !== undefined && estimatedTokens > contextWindow) {
    throw new ContextWindowError(modelId, estimatedTokens, contextWindow);
  }

  return estimatedTokens;
}
