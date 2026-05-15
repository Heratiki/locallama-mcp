/**
 * @deprecated Import from `src/modules/core/model/index.ts` directly.
 * This module is a compatibility shim so legacy consumers still resolve.
 */
export type { ModelMetadata, ModelCapabilities, BenchmarkSummary, ModelOverride } from './model/types.js';
export { ModelRegistry, getModelRegistry, _setModelRegistryForTests } from './model/registry.js';