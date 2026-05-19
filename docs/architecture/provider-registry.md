# Provider Registry — Architecture Notes

> Section 1 of [PLAN.md](../PLAN.md). Completed 2026-05-15.

## Problem solved

The codebase had 44 `model.provider === 'lm-studio' || ... === 'ollama'` string-literal comparisons scattered across routing, benchmarking, cost-monitoring, and fallback-handler modules. Adding a new LLM runtime (a fourth local runner, a new free-tier API) required touching every one of them.

## What was added

```
src/modules/core/provider/
  types.ts       — LLMProvider interface, ProviderModel, CostClass, TaskExecution{Options,Result}
  registry.ts    — ProviderRegistry class + getProviderRegistry() singleton
  helpers.ts     — isProviderLocal(), isProviderId(), providerCostClass()
  index.ts       — barrel re-export

src/modules/lm-studio/provider.ts   — LLMProvider adapter wrapping lmStudioModule
src/modules/ollama/provider.ts      — LLMProvider adapter wrapping ollamaModule
src/modules/openrouter/provider.ts  — LLMProvider adapter wrapping openRouterModule
```

Tests: `test/modules/core/provider/registry.test.ts` (8 cases).

## Key contracts

### `LLMProvider`

```ts
interface LLMProvider {
  readonly id: string;          // 'lm-studio' | 'ollama' | 'openrouter' | ...
  readonly costClass: CostClass; // 'local' | 'free' | 'paid'
  readonly isLocal: boolean;

  init(): Promise<void>;
  isAvailable(): Promise<boolean>;
  listModels(): Promise<ProviderModel[]>;
  supportsModel(modelId: string): boolean | Promise<boolean>;
  executeTask(modelId, task, options?): Promise<TaskExecutionResult>;
  getCost(modelId): { prompt: number; completion: number };
}
```

### `ProviderRegistry`

- `register(provider)` — adds or overwrites by id (logs a warning on overwrite).
- `get(id)` — returns the provider or `undefined`.
- `has(id)` — boolean presence check (used to gate OpenRouter tools).
- `list()` / `listByCostClass(costClass)` — enumerate providers.
- `isLocalProvider(id)` — shorthand for `get(id)?.isLocal ?? false`.
- `initAll()` — calls `provider.init()` on each registered provider; **isolates failures** (one crashing provider does not stop the others). Returns ids of successfully initialized providers. Idempotent: already-initialized providers are skipped.
- `_setProviderRegistryForTests(registry | undefined)` — resets singleton in tests.

### `helpers.ts`

These are the primary call sites for classification checks that replaced the old literal comparisons:

| Helper | Replaces |
|---|---|
| `isProviderLocal(id)` | `id === 'local' \|\| id === 'lm-studio' \|\| id === 'ollama'` |
| `isProviderId(modelProvider, expectedId)` | `model.provider === 'lm-studio'` dispatch checks |
| `providerCostClass(id)` | deriving cost-class from a provider id string |

Both `isProviderLocal` and `isProviderId` have a **registry-first, fallback-to-known-set** resolution strategy so they work correctly in tests that import classification code without bootstrapping the server.

## Bootstrap order

In `LocalLamaMcpServer.run()` ([src/index.ts](../../src/index.ts)):

```
lock acquired
  → provider registry built and initAll() called
    → decisionEngine.initialize()
      (modelsDb → lmStudioModule init → ollamaModule init
       → modelPerformanceTracker → codeModelSelector → jobTracker)
    → setupResourceHandlers()
    → server.connect()
```

The registry is available **before** the decision engine starts, so routing code that calls `isProviderLocal()` will always find the registry populated during normal operation.

## Adding a new provider

1. Create `src/modules/<name>/provider.ts` implementing `LLMProvider`.
2. In `src/index.ts` `run()`, conditionally `registry.register(yourProvider)`.
3. No other files need to change — routing, benchmarking, and fallback logic all query the registry.

## What this section does NOT do

- **Routing dispatch through providers** — `TaskExecutor` still uses per-provider code paths. That is Section 3.
- **Model capability inference** — `CapabilityDetector` is still a stub. That is Section 5.
- **Benchmark pipeline through providers** — benchmark dispatch still calls `callLmStudioApi`/`callOllamaApi` directly. That is Section 6.
- **`costClass` on response payloads** — `route_task` still returns `provider: 'paid'` for free OpenRouter models. That is Section 7.
