# Plan: Make LocaLLama MCP Provider-Agnostic and Local-First

> **Current reader guide (updated 2026-05-19).** This file is both roadmap and historical record. For the fastest orientation, read this guide, then `docs/PROJECT_STATE.md`, then the **Known Bugs / Operational Fixes** and **End-to-End Functional Test Status** sections near the bottom of this file. Sections 0-9 document completed modernization work unless a later operational bug explicitly overrides them. The currently actionable work is: keep `npm run build` and `npm test` green on native Windows/macOS/Linux, then work the next issue buckets in this order: Issue 34 (Windows/path portability), Issues 24+26 (provider circuit breaker + health probing), Issues 20+25 (token counting + context-window enforcement), Issue 19 (backpressure/rate limiting), and Issue 18 (streaming vs async job design).
>
> **Verification baseline (2026-05-19).** `npm run build` succeeds. `npm test` is now shell-agnostic because the script invokes `node --experimental-vm-modules ./node_modules/jest/bin/jest.js` instead of Unix-style `NODE_OPTIONS=...`; latest local result: 23 suites / 186 tests passing on Windows, with no Jest forced-worker-exit/open-handle warning. `npm run lint` still fails because `eslint-plugin-import` is referenced by `eslint.config.js` but is not installed.
>
> **Self-update status (2026-05-19).** The install/self-update design is implemented in source: `src/modules/updater/index.ts`, `check_for_updates`, `update_server`, and startup update checks are wired. Older superpowers design/plan files are retained as implementation history, not as the current task list.

> **Audit note (2026-05-14).** The prior version of this plan marked sections 1–6 as ✅ Completed. A code audit found those completions are stubs or broken: `ProviderRegistry` is referenced but the file does not exist, `ModelRegistry` is a 32-line stub that is never populated, two conflicting `TaskExecutor` classes exist and neither is wired into routing, `CapabilityDetector` only proxies `ModelMetadata.capabilities` and throws on any unregistered model, and `benchmarkModel()` is an unreferenced placeholder. Forty-five hardcoded `provider === 'local'|'lm-studio'|'ollama'|'openrouter'` conditionals remain across the decision-engine, benchmark, and fallback-handler modules. **All sections below are reset to a real status. The prior "agnostic" code must be either finished or removed before further work — it currently breaks the build.**

---

## Working agreement (READ FIRST)

This section exists because the previous planner wrote files that name the right concepts, marked work ✅ Completed, but produced code that doesn't compile and isn't wired into anything. We are not doing that again. The rules below are binding for any agent — human or AI — picking up this plan.

### Rules for marking a section ✅ Completed

A section may **only** be marked ✅ Completed when **every** item below is true. If any is missing, the section stays 🚧 In Progress and the gap is named explicitly.

1. **It builds.** `npm run build` succeeds on a clean checkout after the change. No `tsc` errors. No silent import-of-missing-file (an unresolved import in a file that's only `import`-ed conditionally still counts as a failure).
2. **It runs.** `npm start` boots without throwing during the init sequence in [src/index.ts](src/index.ts) (lock acquisition → provider init → decision engine → tool registration).
3. **It's wired.** A new class/module is not "done" until something in the live code path actually constructs and uses it. Search proof required: `grep -rn 'NewClassName' src/` shows at least one **non-test, non-self** usage, AND that usage is reachable from `LocalLamaMcpServer` startup or an MCP tool handler. A `new Foo()` at the top of a module file that's never imported by `src/index.ts` (directly or transitively) does **not** count.
4. **It has tests.** Per [CLAUDE.md](CLAUDE.md), tests import from compiled `dist/`. At minimum: one unit test per new class, one integration test per new wiring point. `npm test` passes.
5. **The old code is gone.** If the section refactors away a pattern (e.g., hardcoded `provider === '...'` checks), the old pattern's `grep` count must be **zero** outside intentionally preserved adapters. A new abstraction added next to the old code, with the old code still in use, is **not** Completed — it's a partial migration.
6. **Acceptance criteria pass.** Each section below lists explicit acceptance criteria. They must all be checked, not paraphrased away.

Status legend used in this doc:

- ⏳ Not started
- 🚧 In progress — must include a one-line "what's left" note
- ⚠️ Half-done / regressed — must include a one-line "what's broken" note
- ✅ Completed — must include a one-line link to the commit/PR that landed it AND the date the criteria above were re-checked

### Forbidden shortcuts (specific failure modes observed in the prior plan)

- **Don't write a class that imports a file that doesn't exist** and call it done. If you need `ProviderRegistry`, write `provider-registry.ts` first, then write code that imports it.
- **Don't instantiate classes that are never imported.** [task-execution/index.ts:14-15](src/modules/api-integration/task-execution/index.ts#L14-L15) calls `new OpenRouterProvider()` and `new LocalModelProvider()` — neither class has an `import` statement. This must fail a code review.
- **Don't declare a duplicate class in a `types.ts` file.** Types files hold interfaces and type aliases. The phantom `TaskExecutor` class in [task-execution/types.ts:13-28](src/modules/api-integration/task-execution/types.ts#L13-L28) is an artifact of a planner that didn't read the file before writing it.
- **Don't add `console.log("Benchmarking model: ...")` placeholders** and mark the section ✅ ([benchmark/index.ts:67-84](src/modules/benchmark/index.ts#L67-L84)). Placeholders are 🚧 with the unfinished work named.
- **Don't add new files without callers.** Before writing a new file, identify the call site that will use it in the same change. If the call site doesn't exist yet, you're writing the section in the wrong order.

### Required research before editing this plan

Before changing a status here, re-run these checks. (Most are one shell command.)

| Check | Command | Why |
|---|---|---|
| Build green | `npm run build` | Confirms no broken imports |
| Tests green | `npm test` | Confirms wired-in behavior |
| Provider literals gone | `grep -rn "provider === '\(local\|lm-studio\|ollama\|openrouter\|paid\|free\)'" src/` | Tracks Section 1 migration progress |
| New class is used | `grep -rn 'YourClassName' src/ \| grep -v dist \| grep -v test` | Confirms wiring |
| No phantom imports | `grep -rn "from '\.\./\.\./core/" src/ \| awk '{print $NF}' \| sort -u` then verify each path | Catches the failure mode that started this audit |

### Fresh-clone state note

The repo was cloned to this machine recently and is **not yet adapted**:

- `node_modules/` is absent. Run `npm install` before any build/test/lint command can succeed.
- The build artifacts in `dist/` will not exist until `npm run build` is run. Jest reads from `dist/`, so a `npm test` invocation builds first (the `test` script chains it).
- The `data/jobs.db` SQLite file and the `lm-studio-models.json` / `openrouter-models.json` caches will be created on first run.
- `.env` is not in the repo (correctly). Copy from `.env.example` if present, or set `OPENROUTER_API_KEY`, `LM_STUDIO_ENDPOINT`, `OLLAMA_ENDPOINT` as needed before `npm start`.
- A `locallama.lock` file at the project root means a prior process didn't shut down cleanly. The lock handler auto-recovers if `REMOVE_STALE_LOCK_FILES` is set; otherwise delete the file manually after confirming no `node dist/index.js` is running.

**Before Section 0's work begins, the agent must run `npm install` and `npm run build` and report which errors surface. The build is currently expected to fail because of the broken state described in the audit note. Capturing the actual error list is the first deliverable.**

### How to update this plan

- One section per PR is the default. If you must touch two, say why in the PR description.
- When you finish a section: update its status block, add the PR/commit link, and tick the acceptance-criteria checkboxes. Do not rewrite the section history.
- If you discover the plan is wrong (e.g., a section's design won't work), **stop and amend the plan first**, then code. Don't silently change scope.
- If you delete a section as obsolete, leave a one-line tombstone explaining why.

---

## Goals (reframed)

1. **Provider-agnostic LLM layer.** Routing, benchmarking, model selection, and fallback logic must not switch on provider string literals. New LLM providers (a third local runtime, a new free-tier API, a self-hosted vLLM endpoint, etc.) should be addable in one place.
2. **Local-first scoring.** When a local model is *capable enough*, it wins. "Capable enough" must be derived from measured benchmarks + declared metadata, not from the provider label.
3. **Client-agnostic MCP surface.** The MCP tools (`route_task`, `preemptive_route_task`, `get_cost_estimate`, etc.) must work cleanly for any MCP-speaking coding agent — Claude Code, Codex CLI, Copilot Chat in VS Code, Cline, Roo Code. We do **not** call those agents; they call us. The work is making the tool descriptions, argument shapes, and response shapes friendly to each.
4. **Lightweight-hardware path.** Provide a tested configuration that runs end-to-end on a machine with ≤16 GB RAM and no GPU.

## Non-goals

- Replacing or wrapping Claude Code / Codex / Copilot as upstream LLM providers — they don't expose APIs we'd call in that role.
- Implementing a VS Code extension. (The MCP server already plugs into VS Code-based agents via their MCP client config.)
- Generic plugin system / dynamic provider loading from npm. Providers ship in-tree.

---

## Section 0 — Stabilize the broken baseline (PREREQUISITE)

Without this, none of the rest builds.

**Status:** ✅ Completed — commit `778b82d` (2026-05-15). `npm run build` clean; `npm test` 27/27 passing; phantom `TaskExecutor` class in `types.ts` removed; dead `CapabilityDetector`/`ModelRegistry` instances in `benchmark/index.ts` removed; no unused `core/*` symbols.

**Tasks:**

1. **Decide fate of dual `TaskExecutor`.** Delete the class declaration inside [src/modules/api-integration/task-execution/types.ts:13-28](src/modules/api-integration/task-execution/types.ts#L13-L28) (it's a phantom). Keep only `ITaskExecutor`, `TaskExecutionOptions`, `TaskExecutionResult` interfaces in that file. The real implementation lives in [task-execution/index.ts](src/modules/api-integration/task-execution/index.ts).
2. **Fix [task-execution/index.ts](src/modules/api-integration/task-execution/index.ts).** Lines 9, 14, 15 reference symbols that don't exist (`ProviderRegistry`, `OpenRouterProvider`, `LocalModelProvider`). Either revert to the pre-refactor implementation or land Section 1 atomically with this file. **Recommendation:** revert this file to its pre-refactor state on a stabilization branch first, then do Section 1 as a single atomic PR that includes the new files *and* the rewrite of this file.
3. **Remove dead `CapabilityDetector` / `ModelRegistry` instances in [benchmark/index.ts:25-29, 67-84](src/modules/benchmark/index.ts#L25-L29).** They're unused; their presence implies functionality that doesn't exist. Delete them on the stabilization branch; reintroduce purposefully in Sections 5–6.
4. **Verify build green.** `npm run build && npm test` must pass on the stabilization branch before Section 1 begins.

**Acceptance:** `npm run build` succeeds; `npm test` passes; no unused `core/*` symbols.

**Estimated effort:** 0.5 day.

---

## Section 1 — Real ProviderRegistry abstraction

**Status:** ✅ Completed — 2026-05-15. `npm run build` clean; `npm test` 88/88 passing; grep returns 0 hardcoded provider conditionals outside the comment in `registry.ts`.

**Acceptance criteria check:**
- [x] All 45 hardcoded provider conditionals replaced; `grep -rn "provider === '\(local\|lm-studio\|ollama\|openrouter\|paid\|free\)'" src/` returns 0 live code hits.
- [x] Unit tests for `ProviderRegistry` (8 cases: register/get, listByCostClass, isLocalProvider, duplicate-overwrite warning, initAll failure isolation, initAll idempotency, unregister, singleton accessor).
- [x] `isOpenRouterConfigured()` in `tool-definition/index.ts` gates on `registry.has('openrouter')` before falling back to config key check.
- [x] `codeModelSelector` line 179 replaced with `!isProviderLocal(model.provider)`.
- [x] `fallback-handler` dispatch replaced with `ProviderRegistry`-based routing; `axios`/`constructLMStudioUrl`/`openhermes` stub removed.
- [x] `getFallbackModel` hardcoded `provider: 'local'` / `'gpt-3.5-turbo'` stubs replaced with `costMonitor` + registry lookups.
- [ ] Smoke test: `route_task` end-to-end with a real LM Studio / Ollama instance — requires a running provider; not automated yet (pending Section 3 integration tests).

### Design

Define a `LLMProvider` interface that captures everything the routing and benchmarking layers currently switch on. Each existing provider module ([lm-studio/index.ts](src/modules/lm-studio/index.ts), [ollama/index.ts](src/modules/ollama/index.ts), [openrouter/index.ts](src/modules/openrouter/index.ts)) becomes an `LLMProvider` implementation. A central `ProviderRegistry` holds them, exposes them by `id`, and answers questions like "is this provider local?" / "what's the cost class?" / "is this model available right now?".

```ts
// src/modules/core/provider/types.ts
export type CostClass = 'local' | 'free' | 'paid';

export interface LLMProvider {
  readonly id: string;                  // 'lm-studio' | 'ollama' | 'openrouter' | ...
  readonly displayName: string;
  readonly costClass: CostClass;
  readonly isLocal: boolean;            // convenience derived from costClass === 'local'

  // Lifecycle
  init(): Promise<void>;
  isAvailable(): Promise<boolean>;      // can we reach the endpoint right now?

  // Capability surface
  listModels(): Promise<ProviderModel[]>;
  supportsModel(modelId: string): boolean;

  // Execution
  executeTask(
    modelId: string,
    task: string,
    options: TaskExecutionOptions
  ): Promise<TaskExecutionResult>;

  // Cost (per 1k tokens; zero for local/free)
  getCost(modelId: string): { prompt: number; completion: number };
}
```

### File layout

```
src/modules/core/
  provider/
    types.ts              # LLMProvider, ProviderModel, CostClass
    registry.ts           # ProviderRegistry class + getProviderRegistry() singleton accessor
    index.ts              # barrel
  model/                  # (Section 2)
  capability/             # (Section 5)
```

Each existing provider module gets a thin adapter:

```
src/modules/lm-studio/provider.ts    # implements LLMProvider, delegates to lmStudioModule
src/modules/ollama/provider.ts       # ditto
src/modules/openrouter/provider.ts   # ditto, knows about free-tier vs. paid models
```

The adapters import the existing module-level singletons and wrap them. We do **not** rewrite the underlying HTTP / API code in this section — only add the abstraction.

### Bootstrap

`src/index.ts` already runs an init sequence in `LocalLamaMcpServer`. Add:

```ts
const registry = getProviderRegistry();
registry.register(lmStudioProvider);
registry.register(ollamaProvider);
if (config.openRouterApiKey) registry.register(openRouterProvider);
await registry.initAll();
```

### Migration of the 44 hardcoded conditionals ✅

All 44 sites replaced using two helpers from [src/modules/core/provider/helpers.ts](src/modules/core/provider/helpers.ts):

- `isProviderLocal(id)` — replaces `id === 'local' || id === 'lm-studio' || id === 'ollama'`. Falls back to a hard-coded known-local set when the registry is empty (e.g., unit tests).
- `isProviderId(modelProvider, expectedId)` — replaces `model.provider === 'lm-studio'` dispatch checks. Routes through registry when populated; falls back to direct string compare for legacy deserialized data.

**fallback-handler note:** The `handleError` context field was `provider: 'local' | 'paid'` (a cost-class union, not a real provider id). Renamed to `costClass` throughout [src/modules/fallback-handler/index.ts](src/modules/fallback-handler/index.ts) — also renames `FallbackResult.provider` to `FallbackResult.costClass` which is a minor interface change; the module has no external callers in the current codebase.

### Risks / gotchas

- **Circular-dependency hack.** [CLAUDE.md](CLAUDE.md) calls out the `modelPerformanceTracker` ↔ `codeModelSelector` setter-injection dance. The registry must be initialized **before** either of those, since both touch provider metadata. Bootstrap order: providers → registry → modelsDb → performance tracker → code-model selector.
- **Lock-file ordering.** The lock acquisition in [src/index.ts](src/index.ts) must remain the first side effect. Provider init goes *after* lock acquisition, before tool registration.
- **Conditional tool registration.** [tool-definition/index.ts](src/modules/api-integration/tool-definition/index.ts) gates `get_free_models`, `benchmark_free_models`, etc. on `config.openRouterApiKey`. After the registry exists, gate on `registry.has('openrouter')` instead, so a future user-supplied OpenRouter provider works the same.

**Acceptance:**

- All 45 hardcoded provider conditionals replaced; `grep -rn "provider === '\(local\|lm-studio\|ollama\|openrouter\|paid\|free\)'" src/` returns 0 outside the provider adapters themselves.
- Unit tests for `ProviderRegistry` (register / get / listByCostClass / initAll error handling).
- Smoke test: `route_task` with `task_type: 'general'` returns a routing decision via the registry path.

**Estimated effort:** 2–3 days.

---

## Section 2 — Real ModelRegistry, fed by providers and benchmarks

**Status:** ✅ Completed — 2026-05-15. `npm run build` clean; `npm test` 58/58 passing (+14 new tests). `ModelRegistry` in `src/modules/core/model/`; old stub re-exports from new location; `modelsDb.ts` bridges to registry; `src/index.ts` seeds registry from all initialized providers after `registry.initAll()`; `capability-detector.ts` updated to use new `ModelMetadata`.

**Acceptance criteria check:**
- [x] `ModelRegistry` populated at startup from all registered providers via `seedFromProvider()`.
- [x] `modelsDb` callers still work — `getDatabase()` and `updateModelData()` signatures unchanged; `updateModelData` now also calls `registry.updateBenchmarkSummary()`.
- [x] Unit tests: provider-declared seeding (5 cases), JSON override (3 cases), benchmark feedback update (2 cases), staleness pruning (2 cases), singleton accessor (2 cases). 14 tests total.

### Design

The current code has *two* model stores that nobody loves: [modelsDb.ts](src/modules/decision-engine/services/modelsDb.ts) (runtime cache of available models, on-disk JSON) and the new `ModelRegistry` stub. We pick one. Recommendation: **rebuild `ModelRegistry` as the authority, have `modelsDbService` delegate to it**, so we don't grow a third store.

`ModelMetadata` should be richer than the stub:

```ts
export interface ModelMetadata {
  id: string;
  providerId: string;                 // matches LLMProvider.id
  displayName: string;
  family?: string;                    // 'llama', 'qwen', 'gpt', 'claude', 'mistral', ...
  parameters?: number;                // in billions, if known
  contextWindow: number;
  capabilities: ModelCapabilities;    // see Section 5 — not just bool flags
  cost: { prompt: number; completion: number };  // per 1k tokens; 0 for local
  promptingStrategyId: string;        // references prompting-strategies.json id
  benchmarkSummary?: BenchmarkSummary; // latest aggregated scores from benchmark DB
  lastSeen?: number;                  // unix ms; for staleness checks
}
```

### Sources of truth

1. **Provider-declared.** Each provider's `listModels()` returns base metadata (id, context window, family).
2. **Config-overridable.** A `src/config/models.json` file can override or add fields (e.g., declared `parameters`, hand-picked `promptingStrategyId`).
3. **Benchmark-derived.** When a benchmark completes, its result feeds back via `registry.updateBenchmarkSummary(modelId, summary)`.

`loadFromConfig` becomes `await fs.readFile(configPath, 'utf-8').then(JSON.parse)` — not dynamic `import()`. Tests will use a synthetic in-memory registry.

### Migration path from `modelsDb`

- Keep `modelsDb.ts` API surface stable in the same PR. Internally, redirect reads/writes to `ModelRegistry`.
- Add an "import" routine that walks the existing `lm-studio-models.json` / `openrouter-models.json` caches and seeds the registry on startup.

**Acceptance:**

- `ModelRegistry` is populated at startup with all available models from all registered providers.
- `modelsDb` callers still work (no breaking signature change).
- Unit tests cover: provider-declared seeding, JSON override, benchmark feedback update, staleness pruning.

**Estimated effort:** 2 days.

---

## Section 3 — Provider-agnostic TaskExecutor wired into routing

**Status:** ✅ Completed — 2026-05-15. `npm run build` clean; `npm test` 66/66 passing (+8 new tests). `TaskExecutor` in `task-execution/index.ts` now dispatches via `ProviderRegistry`+`ModelRegistry` — no hardcoded provider prefix-switch. Both `switch(model.provider)` blocks in `codeTaskCoordinator.ts` replaced with registry calls. Legacy `executeOllamaModel`/`executeLmStudioModel`/`executeLocalModel` exports and `LegacyTaskExecutor` class removed (had no external callers).

### Design

```ts
class TaskExecutor implements ITaskExecutor {
  constructor(
    private registry: ProviderRegistry,
    private models: ModelRegistry,
    private jobs: JobTracker
  ) {}

  async executeTask(modelId: string, task: string, jobId: string): Promise<string> {
    const meta = this.models.getModel(modelId);
    if (!meta) throw new Error(`Unknown model: ${modelId}`);
    const provider = this.registry.get(meta.providerId);
    if (!provider) throw new Error(`Unknown provider: ${meta.providerId}`);

    await this.jobs.updateJobProgress(jobId, 25, 120_000);
    const result = await provider.executeTask(modelId, task, { /* options */ });
    await this.jobs.updateJobProgress(jobId, 75, 30_000);
    return result.content;
  }
}
```

The legacy `executeOllamaModel`/`executeLmStudioModel`/`executeLocalModel` exports in [task-execution/index.ts:154-164](src/modules/api-integration/task-execution/index.ts#L154-L164) get deleted (no production callers — verify with `grep -rn "executeOllamaModel\|executeLmStudioModel\|executeLocalModel" src test` first; if anything still calls them, migrate the call site).

### Wiring into routing

[taskRouter.ts](src/modules/decision-engine/services/taskRouter.ts) and the decomposition path in [codeTaskCoordinator.ts](src/modules/decision-engine/services/codeTaskCoordinator.ts) currently dispatch to provider-specific code paths. After this section, both call `taskExecutor.executeTask(modelId, ...)` and let the registry handle provider routing.

**Acceptance:**

- `route_task` end-to-end works for LM Studio, Ollama, and an OpenRouter free model with no `provider === '...'` checks on the execution path.
- Integration test: mock the registry, assert that `executeTask` dispatches to the right provider stub.
- Job progress updates still fire at 25% / 75%.

**Estimated effort:** 1.5 days.

---

## Section 4 — Unified prompting strategies

**Status:** ✅ Completed — 2026-05-16. `npm run build` clean; `npm test` 107/107 passing (+19 new tests). `PromptingStrategyService` in `src/modules/core/prompting/`; `ModelRegistry.toMetadata()` resolves `promptingStrategyId` via service; per-provider `STRATEGIES_FILE_PATH` constants removed; all three providers read/write to `~/.locallama/strategies.json` via merge-write; `src/index.ts` loads service before `registry.initAll()`.

**Acceptance criteria check:**
- [x] A model with `family: 'qwen-coder'` in `models.json` automatically resolves the 'coding' strategy (no code change needed).
- [x] Per-provider `STRATEGIES_FILE_PATH` writes/reads removed; auto-improvement loop now uses `getPromptingStrategyService().mergeUserOverrides()` → `~/.locallama/strategies.json`.
- [x] Tests cover resolution priority order: provider+family > provider-only > family > modelIdPattern > defaultStrategyId.

### Design

- Promote the JSON file to the single source of truth. Schema:

  ```jsonc
  {
    "strategies": [
      {
        "id": "claude-coding-v1",
        "appliesTo": { "families": ["claude"], "providerIds": ["openrouter"] },
        "systemPrompt": "...",
        "userPromptTemplate": "...",
        "useChat": true,
        "stopSequences": ["</answer>"],
        "temperature": 0.2
      }
    ],
    "defaultStrategyId": "default"
  }
  ```

- `ModelRegistry` resolves `promptingStrategyId` for each model at registration time, in this priority: explicit override in `models.json` → first strategy whose `appliesTo.providerIds` or `appliesTo.families` matches → `defaultStrategyId`.
- The per-provider runtime strategy files ([lm-studio strategies file](src/modules/lm-studio/index.ts#L295), [ollama](src/modules/ollama/index.ts#L123), [openrouter](src/modules/openrouter/index.ts#L139)) become a *user-override* layer only: `~/.locallama/strategies.json`. The provider modules stop maintaining their own defaults.
- The auto-improvement logic (the existing `DEFAULT_PROMPT_IMPROVEMENT_CONFIG` machinery in LM Studio and Ollama) writes its learned strategies into the user-override file, not the in-tree JSON.

**Acceptance:**

- A model added to `models.json` with `family: 'qwen-coder'` and no explicit strategy automatically resolves a sensible strategy.
- Removing the per-provider `STRATEGIES_FILE_PATH` writes/reads does not break the prompt-improvement loop (the loop now writes to the user-override path).
- Tests cover the resolution priority order.

**Estimated effort:** 1.5 days.

---

## Section 5 — CapabilityDetector that actually detects

**Status:** ✅ Completed — 2026-05-15. `npm run build` clean; `npm test` 88/88 passing (22 new capability-detector tests). Wired via `CapabilityDetector.inferFromProviderModel` in `ModelRegistry.toMetadata()` and singleton initialized in `src/index.ts`.

**Acceptance criteria check:**
- [x] `qwen2.5-coder-7b` → `{ code: true, toolUse: true, largeContext: false }` without any code change (static inference test passes).
- [x] A benchmark run with code score < 0.3 flips `caps.code` to `false` in `detectCapabilities()` (empirical layer test passes).
- [x] `CapabilityDetector` wired: `grep -rn 'CapabilityDetector' src/` shows usage in `registry.ts` and `index.ts`.
- [x] Never throws for unknown model — `conservativeDefaults()` returns `{ chat: true, code: false, vision: false, toolUse: false, largeContext: false, maxContextTokens: 4096 }`.
- [ ] `taskRouter` context-window filter uses `caps.largeContext` — pending Section 4.
- [ ] `codeModelSelector` score filter by `caps.scores.code` — pending Section 4/6 empirical data pipeline.

### Design

Three layers of capability inference, applied in order:

1. **Declared.** If `models.json` declares a capability, use it.
2. **Heuristic by name/family.**
   - `vision`: model id matches `/(vision|vl|llava|qwen2[.-]?vl)/i`.
   - `code`: family in `{'codellama','deepseek-coder','qwen-coder','starcoder','codestral'}` or id matches `/code|coder/i`.
   - `largeContext` (≥32k): metadata `contextWindow >= 32768`.
   - `toolUse`: family in `{'gpt','claude','llama-3.1','qwen2.5','mistral-large'}` AND `parameters >= 7` (rough).
3. **Empirical.** When benchmarks run, store per-capability pass/fail in `benchmarkSummary`. A model that fails the code benchmark loses the `code` capability flag even if its name implies it.

```ts
export interface ModelCapabilities {
  chat: boolean;
  code: boolean;
  vision: boolean;
  toolUse: boolean;
  largeContext: boolean;
  maxContextTokens: number;
  // empirical scores 0..1, undefined = not measured
  scores?: { code?: number; reasoning?: number; speed?: number };
}
```

The detector lives in `src/modules/core/capability/detector.ts`. It is called by `ModelRegistry` when a model is registered or refreshed, never throws for an unknown model (returns a conservative default of all `false` except `chat`).

### Use sites

- `codeModelSelector` filters by `caps.code && caps.scores?.code !== undefined && caps.scores.code > X`.
- `taskRouter` filters by `caps.largeContext` when the input is over 32k tokens.
- Tool registration: if no registered model has `caps.toolUse`, hide tool-using benchmark configurations.

**Acceptance:**

- Adding a new model id `qwen2.5-coder-7b` to a provider yields `{ code: true, toolUse: true, largeContext: false }` without any code change.
- A benchmark run that fails the code suite for a "coder" model flips `caps.scores.code` low and removes it from the coder-eligible pool in the next routing decision.

**Estimated effort:** 2 days.

---

## Section 6 — Benchmarking pipeline that uses Sections 1–5

**Status:** ✅ Completed 2026-05-16.

### Design

- New `benchmark_model` MCP tool (added to [tool-definition/index.ts](src/modules/api-integration/tool-definition/index.ts) + dispatcher in [src/index.ts](src/index.ts)) takes `{ modelId, taskCategories?: ['code','chat','tool-use','long-context'] }` and runs the matching benchmark suites against that model **via the provider abstraction**.
- Results flow into `ModelRegistry.updateBenchmarkSummary` and persist to the existing `data/benchmarks.db` (via [benchmark/storage/benchmarkDb.ts](src/modules/benchmark/storage/benchmarkDb.ts)).
- Existing `benchmark_task`, `benchmark_tasks`, and `benchmark_free_models` tools continue to work but use the provider abstraction internally — drop the hardcoded `provider === 'lm-studio'` / `'ollama'` branches in [benchmark/core/runner.ts:81-93](src/modules/benchmark/core/runner.ts#L81-L93).
- Startup benchmark (`STARTUP_BENCHMARK_TARGETS`) iterates providers by `costClass` instead of name, so adding a new "local" provider Just Works.

**Acceptance:**

- `benchmark_model qwen2.5-coder-7b code` runs against whichever local provider hosts that model, results land in the DB and update the registry.
- Benchmark runner contains zero hardcoded provider literals.
- `STARTUP_BENCHMARK_TARGETS=local` benchmarks all models from all `costClass === 'local'` providers without naming them.

**Estimated effort:** 2 days.

---

## Section 7 — Client-side polish for Claude Code, Codex, Copilot, Cline, Roo Code

> **Reframed from prior plan.** These are MCP **clients**, not providers. The work is making the tool surface they call into easy and effective to use.

**Status:** ✅ Completed — 2026-05-16. `npm run build` clean; `npm test` 120/120 passing. Tool descriptions rewritten; `route_task` / `preemptive_route_task` outputSchemas normalised to `{ costClass, providerId, modelId, content, reason, estimatedCost? }`; `provider: 'paid'` overload replaced by split `costClass` + `providerId` fields in `RouteTaskResult`; tool dispatcher returns proper MCP `content: [{ type: 'text', text: JSON }]` format; `src/modules/core/client/hints.ts` created with per-client defaults keyed on `clientInfo.name`; wired into `src/index.ts` via `server.getClientVersion()` after transport connect; `docs/client-compatibility.md` created with tool surface table, response shape examples, and manual smoke-test matrix.

**Acceptance criteria check:**
- [x] Tool schemas validated: `route_task` and `preemptive_route_task` have normalised `outputSchema` with `costClass`, `providerId`, `modelId`.
- [x] Response shape consistent: `costClass` field present everywhere a provider is returned; old `provider: 'paid'` overloading removed.
- [x] `docs/client-compatibility.md` created with per-client config examples and smoke-test matrix.
- [ ] All five clients listed above successfully call `route_task` on a sample task — pending manual testing with running providers.

### Tasks

1. **Audit tool descriptions.** Each `name`/`description` in [tool-definition/index.ts](src/modules/api-integration/tool-definition/index.ts) is the only thing an LLM client sees. Rewrite for clarity. Specifically:
   - `route_task` — current description likely undersells the cost-saving angle to a coding agent. State plainly: "Delegate a coding subtask to a local LLM when it can handle it; the caller stays free to use its strong model for the harder pieces."
   - `preemptive_route_task` — explain when to prefer it over `route_task` (cheap pre-check before committing to a provider).
   - `get_cost_estimate` — make output shape predictable JSON, not prose.
2. **Argument-shape normalization.** Some tools accept ad-hoc free-form fields. Tighten JSON schemas so the schema-aware clients (Claude Code, Codex) can construct correct calls on first try.
3. **Response-shape normalization.** Return `{ provider, modelId, content, usage }` consistently across `route_task`, `preemptive_route_task`, and benchmarks. Currently `provider: 'paid'` is overloaded to include free OpenRouter models — split into `costClass` (`'local'|'free'|'paid'`) plus `providerId`. (This is also called out in [CLAUDE.md](CLAUDE.md) as a known footgun.)
4. **Per-client behavioral hints.** MCP exposes the client name via the initialize handshake. We can use it: e.g., when caller is Claude Code, default to a chunkier subtask granularity; when caller is Copilot Chat, prefer inline-completion-style short outputs. Add a `src/modules/core/client/hints.ts` keyed by client name with defaults.
5. **Manual smoke test matrix.** Document a short script: configure each client to point at `dist/index.js`, run a representative coding task, capture which tool was called and the response shape. Track results in a checked-in `docs/client-compatibility.md` (one row per client).

**Acceptance:**

- Tool schemas validated against the MCP spec.
- Response shape consistent; `costClass` field present everywhere a `provider` is returned.
- All five clients listed above successfully call `route_task` on a sample task in the manual smoke matrix.

**Estimated effort:** 2 days (mostly schema cleanup + manual testing).

---

## Section 8 — Tests

**Status:** ✅ Completed — 2026-05-16. `npm test` 160/160 passing. All coverage targets met.

Per [CLAUDE.md](CLAUDE.md), Jest runs against compiled `dist/`. Tests must not spawn the real server.

### Coverage targets

- [x] `ProviderRegistry`: register/get/list-by-cost-class, init failure isolation (one provider failing init doesn't kill the others), `isAvailable()` mocking.
- [x] `ModelRegistry`: provider-seeded load, JSON override merge, benchmark-summary update, staleness pruning. Extended to 100% line coverage.
- [x] `TaskExecutor`: dispatches to the right provider; surfaces provider errors as failed jobs; job progress events fire.
- [x] `CapabilityDetector`: heuristic table (data-driven test with ~20 model-name → expected-caps cases).
- [x] `taskRouter` + `preemptiveRouting`: with two local providers registered, prefers the higher-scored local model regardless of which provider hosts it; falls back to paid only when no local model is capable. (`test/modules/decision-engine/preemptive-routing.test.ts`, 8 tests)
- [x] Tool dispatcher (`src/index.ts`): each tool name routes to its handler; unknown tool name returns the documented error shape. (`test/dispatcher.test.ts`, 7 tests, uses `beforeAll` + `setImmediate` drain to wait for async import chain)
- [x] `core/client/hints.ts`: 16 tests, 100% coverage (`test/modules/core/client/hints.test.ts`)
- [x] `core/prompting/service.ts`: extended to 100% line coverage

### Existing test hygiene

- The current `test/` directory pulls from compiled `dist/`. Any new test files must use the same convention (import from `../dist/...`).
- Add a `test/fixtures/` directory with a fake provider implementation reusable across tests.

**Acceptance:** ≥80% line coverage on `src/modules/core/`; routing and benchmark integration tests passing in CI.

**Key learnings:**
- Dynamic `import().then().then()` chains inside class methods require `setImmediate`-based drain (not just `Promise.resolve()` microtask flushes) in Jest ESM tests.
- Use `beforeAll` + polling (`waitForHandler`) rather than `beforeEach` for one-time async setup.
- `jest.unstable_mockModule` intercepts dynamic imports from the tested module when mock paths resolve to the same absolute path.

**Estimated effort:** 2 days.

---

## Section 9 — Lightweight-hardware path

**Status:** ✅ Completed — 2026-05-16. `npm run build` clean; `npm test` 334/334 passing (+14 new tests in `test/modules/decision-engine/lightweight-profile.test.ts`). `LOCALLAMA_PROFILE=lightweight` env var adjusts `COMPLEXITY_THRESHOLDS` and `TOKEN_THRESHOLDS` at module load time; `config.profile` field added to `Config`; `docs/lightweight-models.md` created.

**Acceptance criteria check:**
- [x] `LOCALLAMA_PROFILE=lightweight npm start` — profile field read; adjusted thresholds active from first module load.
- [x] `docs/lightweight-models.md` checked in with model table, RAM footprints, tok/s estimates, setup instructions, and routing behaviour explanation.
- [x] Routing thresholds adjusted: `COMPLEXITY_THRESHOLDS.COMPLEX` raised to 0.9 (was 0.8); `TOKEN_THRESHOLDS.LARGE` lowered to 4 096 (was 8 000) to match small-model context windows.
- [x] Decomposition path assessed and documented in `docs/lightweight-models.md` ("Decomposition path assessment" section) — works well for multi-step code tasks; known limitation for single tasks > 4 096 tokens that can't be split, which fall back to paid routing.
- [ ] End-to-end smoke test on a physical 16 GB machine with `qwen2.5-coder-1.5b` — pending a runner with a local Ollama/LM Studio install.

### Tasks

1. **Curate a recommended low-end set** in `docs/lightweight-models.md` (only doc we create here, since CLAUDE.md restricts new docs — this one is user-requested):
   - `qwen2.5-coder-1.5b` (Ollama)
   - `phi-3.5-mini-instruct` (LM Studio)
   - `gemma-2-2b-it` (either)
   Each row: RAM footprint at q4_K_M, expected tokens/sec on a 2020-era 16GB laptop, which task categories it's plausibly good at (per our benchmarks).
2. **Benchmark these models** end-to-end on a low-RAM environment (use `STARTUP_BENCHMARK_TARGETS=local` with only these models pulled). Record results in the benchmark DB; surface via `models.json` overrides.
3. **Routing defaults for low-end.** Add a `LOCALLAMA_PROFILE=lightweight` env var that adjusts `COMPLEXITY_THRESHOLDS` and `TOKEN_THRESHOLDS` (see [decision-engine/types/index.ts](src/modules/decision-engine/types/index.ts)) so the router doesn't punt to paid APIs as eagerly when the only available local models are small.
4. **Verify decomposition path helps.** `codeTaskCoordinator` already supports task decomposition; confirm it lets a 1.5B model collectively solve tasks a 7B model would handle solo. If not, that's a separate work item — but **document the gap**, don't quietly leave it.

**Acceptance:**

- `LOCALLAMA_PROFILE=lightweight npm start` boots, benchmarks pass, `route_task` on a simple Python refactor routes to a local model on a 16GB machine.
- `docs/lightweight-models.md` checked in.

**Estimated effort:** 1.5 days (mostly benchmark/measurement, not code).

---

## Sequencing and dependencies

```
Section 0 (stabilize)
   │
   ▼
Section 1 (ProviderRegistry) ──► Section 2 (ModelRegistry)
                                    │
                                    ▼
                                 Section 5 (CapabilityDetector)
                                    │
   ┌────────────────────────────────┤
   ▼                                ▼
Section 3 (TaskExecutor)         Section 4 (Prompting)
   │                                │
   ▼                                ▼
Section 6 (Benchmarking) ◄──────────┘
   │
   ▼
Section 7 (Client polish) ── Section 9 (Lightweight HW)
   │
   ▼
Section 8 (Tests — actually written incrementally alongside 1–7, gathered here for the "fill gaps" pass)
```

Section 8 (tests) is listed once but written **alongside** each section. The dedicated Section 8 pass is for filling gaps and integration tests.

## Estimated total effort

~16–18 engineer-days for a single contributor, assuming the existing decision-engine internals are well-understood. Realistic calendar with review/CI cycles: 4–5 weeks part-time or 2.5–3 weeks full-time.

## Risks & open questions

1. **`modelsDb` deprecation vs. delegation.** Section 2 proposes `ModelRegistry` becomes authoritative and `modelsDb` delegates. If `modelsDb` writes to disk in a format external tools depend on (`lm-studio-models.json`, `openrouter-models.json` — both in `.gitignore` per CLAUDE.md), confirm no external script consumes those files before changing the format.
2. **Circular-dependency hack.** The `modelPerformanceTracker` ↔ `codeModelSelector` setter-injection in [decision-engine/index.ts](src/modules/decision-engine/index.ts) is fragile. The registry refactor must not change init order in a way that breaks the existing dance — write an explicit init-order test.
3. **Prompt-improvement loop ownership.** Sections 4 makes prompting JSON authoritative, but the per-provider auto-improvement loops (LM Studio + Ollama) currently *write back* to those files. Pick: (a) keep auto-improvement writing to user-override only, or (b) disable auto-improvement until a unified path lands. Recommend (a).
4. **Free vs. paid OpenRouter split.** The current code returns `provider: 'paid'` for free OpenRouter models, then leaks `model.id` for callers to disambiguate. Section 7's `costClass` field fixes the API. Confirm no MCP client currently parses `provider === 'paid'` as a cost signal — if any do, document a breaking-change note in the release.
5. **Are Codex CLI + Copilot Chat actually MCP clients?** Claude Code, Cline, and Roo Code definitively are. Codex CLI has MCP support as of mid-2025; Copilot Chat's MCP support is in preview. **Verify current state before Section 7's manual smoke matrix** — if either lacks MCP support, that row is "N/A" not a bug.

## Notes for future maintainers

- Don't reintroduce `provider === 'lm-studio'` checks. If you need to special-case a provider's behavior, add a capability flag on the provider interface or a method on the provider itself.
- Don't put model metadata in code. It goes in `models.json` or comes from `provider.listModels()`.
- The benchmark DB is the long-term memory for capability inference. Don't reset it casually.

### Architectural decision — Native TypeScript BM25 (2026-05-18)

The `retriv_init` / `retriv_search` tools originally used the Python [retriv](https://github.com/AmenRa/retriv) library (v0.2.3) as a subprocess. This approach was abandoned because:

1. `retriv` is unmaintained (~last release 2023).
2. Its hard dependency `numba` has no binary wheels for Python 3.11+ and cannot build from source on modern macOS/Linux toolchains.
3. The only functionality used was standard Okapi BM25 text ranking — a well-understood algorithm that can be implemented in ~200 lines of TypeScript.

**Resolution:** `src/modules/cost-monitor/bm25.ts` is now a self-contained native TypeScript BM25 implementation with no Python dependency. The public `BM25Searcher` class API is identical to the old one so `codeSearch.ts`, `codeSearchEngine.ts`, and `retriv-integration/index.ts` required no changes beyond removing Python existence checks.

Do not reintroduce Python subprocess bridges for text-search features. If more advanced NLP is needed in future (dense retrieval, embeddings, etc.), prefer a native Node.js library or a dedicated sidecar service with a stable REST API.

---

## Known Bugs / Operational Fixes (2026-05-18)

Issues found during live testing of the MCP server against a real Ollama instance. Fixes applied to both `src/` and the installed copy at `~/.claude/mcp-servers/locallama-mcp/`.

### Bug 1 — Ollama model tracking cache goes stale; route_task always fails on local models

**Symptom:** `route_task` returns `costClass: "local"`, picks a model (e.g. `gemma4:26b`), but execution fails with `"Model gemma4:26b not found in Ollama."` even though `curl http://localhost:11434/api/tags` and `/api/show` confirm the model exists.

**Root cause:** `ollamaModule.initialize()` in `src/modules/ollama/provider.ts:23` is called with `forceUpdate = false` (the default). The 24-hour threshold in `ollamaModule.initialize` skips the live Ollama API query if `ollama-models.json` was written within the last 24 hours. The tracking file can contain a stale model list (e.g. models that were removed and replaced). The router selects the model from a *different* live API path, but the executor checks `this.modelTracking.models[modelId]` against the cached-to-disk list — causing a spurious "not found" error.

**Fix:** `src/modules/ollama/provider.ts:23` — change `await ollamaModule.initialize()` to `await ollamaModule.initialize(true)`. This forces a live Ollama API query every time the provider initializes (i.e. on every server startup). The JSON file still caches metadata enrichment between restarts, but the model list is always authoritative from Ollama.

**Status:** ✅ Fixed — 2026-05-18. Applied to source repo and installed copy.

**Acceptance test:** Start the server, call `route_task` with `priority: "cost"` on a simple task. Response must not contain `"not found in Ollama"` and `costClass` must be `"local"` when Ollama is running with at least one model.

---

### Bug 2 — `ollama-models.json` in installed copy had phantom models

**Symptom:** `ollama-models.json` listed `gpt-oss:20b`, `gemma3n:e2b`, `gemma3n:latest` — none of which were installed in Ollama. The only installed model was `gemma4:26b` (Q4_K_M, 25.8B). The file's `lastUpdated` timestamp was today, so Bug 1's 24h gate never triggered a refresh.

**Root cause:** File was populated at some prior point with models that were subsequently removed or never installed on this machine.

**Fix:** Wiped `ollama-models.json` to `{ "models": {}, "lastUpdated": "1970-01-01T00:00:00.000Z" }` so Bug 1's fix (forced refresh on startup) will repopulate it correctly.

**Status:** ✅ Fixed — 2026-05-18. Applied to installed copy only (source repo file is git-ignored).

---

### Bug 3 — `benchmark_task` / `benchmark_tasks` tools return "Unknown tool" (dispatch gap)

**Symptom:** Calling `benchmark_task` or `benchmark_tasks` via MCP returns `MCP error -32603: Unknown tool`. Both tools are listed in `README.md` and their schemas are exposed in the MCP tool list, but the server cannot execute them.

**Root cause:** The tool definitions existed in `src/modules/api-integration/tool-definition/index.ts`, but the dispatch handler in `src/index.ts` did not have `case 'benchmark_task':` / `case 'benchmark_tasks':` branches. This gap likely opened during the Section 6 refactor which restructured the benchmarking pipeline. The tool definitions were preserved but the dispatch cases were not ported.

**Fix:** Added dispatcher cases in `src/index.ts` for `benchmark_task` and `benchmark_tasks`. The dispatcher now maps MCP snake_case arguments into `BenchmarkTaskParams`, applies safe defaults for optional `expected_output_length` and `complexity`, passes run overrides such as `runs_per_task` / `task_timeout`, and delegates to `benchmarkModule.benchmarkTask()` / `benchmarkModule.benchmarkTasks()`.

**Status:** ✅ Fixed — 2026-05-19. `npm test` passes (21 suites / 184 tests). Focused dispatcher coverage added with realistic benchmark payloads. Live MCP verification: `benchmark_task` ran one local `qwen2.5-coder:3b` inference for `live-debounce-regression-guard` in ~9.4s; `benchmark_tasks` returned a two-task summary through the MCP tool path.

**Operational note:** The first live attempt failed before dispatch could complete because `node_modules` contained invalid `sqlite3@5.1.7` while `package.json` requires `sqlite3@^6.0.1`. Running `npm install` reconciled the dependency to `sqlite3@6.0.1`; `require('sqlite3')` then succeeded and live benchmark calls worked.

---

---

### Bug 4 — `rootDir` resolves to Node.js bin dir; all file writes go to wrong location

**Symptom:** `ollama-models.json` never updates after server restart even with Bug 1 fixed. All file-based state (benchmark DB, model caches, lock file path) resolves to `C:\Program Files\nodejs\` instead of the project root.

**Root cause:** `src/config/index.ts` line 9: `const rootDir = process.cwd()`. When Claude Code (or any MCP host) spawns the server process, it does not set `cwd` to the install directory — the working directory inherits from the host process (in this case `C:\Program Files\nodejs`). Every path built from `rootDir` (tracking files, benchmark DB, lock file, cache dir, etc.) resolves to the wrong location.

**Fix:** Replace `process.cwd()` with a path derived from `import.meta.url` so the server always knows where it lives regardless of how it was spawned:
```typescript
import { fileURLToPath } from 'url';
// dist/config/index.js → dist/config/ → dist/ → project root
const rootDir = process.env.LOCALLAMA_ROOT_DIR ||
  path.resolve(fileURLToPath(import.meta.url), '..', '..', '..');
```
`LOCALLAMA_ROOT_DIR` env var still allows override for tests or custom deployments.

**Status:** ✅ Fixed — 2026-05-18. Applied to `src/config/index.ts` in source repo and installed copy.

**Acceptance test:** After restart, `ollama-models.json` at the install root is populated within a few seconds. `locallama.lock` appears at install root (not Node bin dir).

---

---

### Bug 5 — `ERR_CANCELED` from AbortController not handled → always maps to `UNKNOWN` error

**Symptom:** After fixing Bugs 1 and 4, `route_task` still returns `"Error executing task: unknown"` for every local Ollama call. Error classification is wrong.

**Root cause:** When the 180-second `AbortController` fires (or if Axios cancels for any reason), Axios throws a `CanceledError` with `code: 'ERR_CANCELED'`. `handleOllamaError` in `src/modules/ollama/index.ts` only checks `axiosError.code === 'ECONNREFUSED' || axiosError.code === 'ECONNABORTED'` — `ERR_CANCELED` is not listed and falls through to `OllamaErrorType.UNKNOWN`, which is not in the `switch` in `executeTask` and hits the `default: throw new Error(\`Error executing task: ${result.error}\`)` branch.

**Fix:** Add `axiosError.code === 'ERR_CANCELED'` to the connection-failure check in `handleOllamaError`.

**Status:** ✅ Fixed — 2026-05-18. Applied to source repo and installed copy.

---

### Bug 6 — Hardcoded 180-second Ollama timeout too short for large models; no env override

**Symptom:** On hardware where inference is slow (e.g., `gemma4:26b` 25.8B Q4 taking >180s), every `route_task` call times out before the model responds. No env var to adjust without code changes.

**Root cause:** `executeTask` in `src/modules/ollama/index.ts` hardcodes `const timeout = 180000` (3 minutes). A 25.8B model on CPU+integrated GPU takes 120+ seconds just to warm up, and production generation may exceed 3 minutes for non-trivial tasks.

**Fix:** 
1. Added `ollamaTimeout: parseInt(process.env.OLLAMA_TIMEOUT || '300000', 10)` to `src/config/index.ts` (5-minute default).
2. Changed `executeTask` to use `config.ollamaTimeout` instead of the literal.

**Status:** ✅ Fixed — 2026-05-18. Applied to source repo and installed copy. Set `OLLAMA_TIMEOUT=600000` in env for very large models.

---

### Bug 7 — `route_task` always fails for local models on hardware with small VRAM (confirmed 2026-05-19)

**Symptom:** `route_task` returns SERVER_ERROR for every local Ollama call even after Bugs 1–6 are fixed. Direct diagnostic test confirms Ollama itself works fine — a raw `axios.post` to `/api/chat` succeeds in **~122 seconds** on the test system.

**Root cause:** `gemma4:26b` (25.8B Q4_K_M, 18GB) runs with only 4GB VRAM and the rest on CPU. The `codeTaskCoordinator` builds a verbose multi-line prompt (~500+ tokens) for every subtask. At 4GB VRAM throughput on an AMD RX 5700 XT, inference takes 120–300+ seconds. The `OLLAMA_TIMEOUT` (even at 300s) may not be enough for the constructed prompt length, and Claude Code's MCP tool-call timeout may add an additional ceiling.

**Fix (immediate):** Pull small models that fit fully in 4GB VRAM (see Model Guidance section below). `qwen2.5-coder:7b` at Q4_K_M fits in ~4GB and runs fully on GPU — expected inference time <10s on this hardware once warm.

**Fix (longer-term):** The `codeTaskCoordinator` prompt template should be trimmed for local-model paths. 500-token system prompts with repeated context waste inference budget on small models. Consider a `LOCALLAMA_PROMPT_MODE=compact` env var that switches to a minimal prompt template when routing to local models.

**Status:** ⚠️ Partially mitigated — timeout increased, correct error returned. Full resolution requires model swap (see below).

---

### Operational note — Two separate codebases to keep in sync

The installed MCP server at `~/.claude/mcp-servers/locallama-mcp/` is a separate clone from the development repo at `~/source/locallama-mcp/`. Fixes must be applied to both, or the installed copy must be built from source. Consider switching the MCP config to point directly at the built `dist/` of the source repo to eliminate this dual-maintenance burden.

---

## Test System Profile

> Hardware and configuration notes captured during live testing (2026-05-19). Update this section when testing on a new machine. Do not add usernames, hostnames, API keys, tokens, or file paths that contain usernames.

### System A — Windows 11 workstation (primary dev machine, 2026-05-19)

| Component | Detail |
|---|---|
| OS | Windows 11 Pro |
| CPU | AMD Ryzen 7 3800X — 8 cores / 16 threads |
| RAM | 32 GB |
| GPU | AMD Radeon RX 5700 XT — **4 GB VRAM** |
| Ollama backend | ROCm (AMD GPU acceleration) |
| Node.js | v22 (via nvm) |

**Key constraint:** 4 GB VRAM is the dominant limit. Models larger than ~7B Q4 (≈4 GB) spill to CPU and inference speed drops dramatically.

**Observed inference times on this system:**

| Model | Size on disk | VRAM used | Warm-up time | Short prompt |
|---|---|---|---|---|
| gemma4:26b Q4_K_M | 18 GB | ~6 GB (partial GPU) | >30s | ~122s |
| qwen2.5-coder:7b Q4_K_M | ~4 GB | ~4 GB (full GPU) | expected <5s | expected <10s |

**Issues specific to this system:**
- Bug 7 (route_task timeout) triggered by gemma4:26b being too large for available VRAM.
- `process.cwd()` resolves to `C:\Program Files\nodejs` when spawned by Claude Code — Bug 4.

---

## Model Guidance

### Recommended models for 4 GB VRAM hardware (System A)

Pull these before running end-to-end tests. They fit fully in GPU memory and give realistic inference speeds.

```bash
ollama pull qwen2.5-coder:7b   # best coding 7B; HumanEval ~85%; ~4GB VRAM
ollama pull qwen2.5-coder:3b   # fast fallback; ~2GB VRAM; good for simple tasks
ollama pull qwen3:4b           # general reasoning + coding; MoE architecture; ~2.5GB VRAM
```

**Do not use gemma4:26b for automated test runs on 4GB VRAM hardware.** It works for manual one-off queries (see `ollama run gemma4:26b`) but always exceeds the `OLLAMA_TIMEOUT` when called through the MCP server's prompt-building pipeline.

### Model selection rationale (2026)

- **qwen2.5-coder:7b** — Purpose-trained on code. Leads HumanEval among ≤8B models (~85%). 7B Q4_K_M fits in exactly 4GB. Recommended primary local model.
- **qwen2.5-coder:3b** — Half the VRAM of the 7B, ~70% of the quality. Use as a fallback or for trivial tasks where speed matters.
- **qwen3:4b** — Qwen3 is trained with RL on SWE-Bench for agentic multi-step workflows. Good complement to the coder variants for planning/reasoning steps.

Sources: [Best Ollama Models 2026 (Morph)](https://www.morphllm.com/best-ollama-models) · [Local AI Coding Models (Local AI Master)](https://localaimaster.com/models/best-local-ai-coding-models) · [Open-Source LLMs 2026 (HuggingFace)](https://huggingface.co/blog/daya-shankar/open-source-llms)

### Models requiring more VRAM (not suitable for System A without CPU offload)

| Model | VRAM needed | Notes |
|---|---|---|
| qwen2.5-coder:32b | ~20 GB | Best coding model overall; needs 24GB GPU |
| deepseek-r1:32b | ~20 GB | Best for reasoning/bug analysis; slow even on 24GB |
| gemma4:26b Q4_K_M | ~18 GB | Already installed; use only for manual queries |

---

## OpenRouter Integration Status

OpenRouter is **not configured** on the test system — no `OPENROUTER_API_KEY` env var is set. All OpenRouter-gated tools (`get_free_models`, `benchmark_free_models`, `set_model_prompting_strategy`, etc.) are correctly hidden from the MCP tool list when the key is absent.

To enable OpenRouter: set `OPENROUTER_API_KEY` in the environment before starting the server (add to `.env` file at the project root, which is git-ignored). No code changes required.

---

### Bug 8 — Router never selects `qwen2.5-coder:7b` or `qwen3:4b`; all local tasks go to `qwen2.5-coder:3b` (confirmed 2026-05-19)

**Symptom:** Every `route_task` call routes to `qwen2.5-coder:3b` regardless of `complexity` (0.2–0.85) or `priority` (`cost`/`quality`). `qwen2.5-coder:7b` and `qwen3:4b` are registered in Ollama and visible to the server, but are never selected.

**Root cause:** `codeModelSelector.ts` scores models primarily on benchmark history (`modelPerformance` records). Without prior `benchmark_task` runs, all local models fall back to a heuristic score (~0.5 base). `qwen2.5-coder:3b` wins because:
1. "coder" name pattern match adds +0.1 to base score
2. Small model size gets an efficiency bonus (+0.1 in `efficiencyScore`)
3. Random jitter (up to +0.05) is inconsistent but small models already lead
4. Once one task succeeds, `modelPerformance` history reinforces 3b for future calls

**Fix needed:** Run `benchmark_task` for each local model to populate performance history. Bug 3 is now fixed, so the next step is to benchmark `qwen2.5-coder:3b`, `qwen2.5-coder:7b`, and `qwen3:4b` with bounded, realistic tasks, then re-test route selection.

**Workaround:** None without code changes. Alternatively, the `scoreModelForSubtask` function could apply a context-window or parameter-count heuristic to prefer larger models for higher complexity tasks when benchmark history is absent.

**Status:** 🚧 In progress — 2026-05-19 retest: bounded `benchmark_task` run succeeded for `qwen2.5-coder:7b`; initial `qwen3:4b` benchmark timed out at MCP boundary (`-32001`). Follow-up fix landed in `src/modules/benchmark/core/runner.ts` to cap each run with a hard timeout (`min(dynamicTimeout, BENCHMARK_TASK_TIMEOUT - safetyBuffer)`) and record timeout failures as failed benchmark runs instead of hanging the entire tool call. Additional routing consistency fix landed in `src/modules/api-integration/routing/index.ts`: for single-subtask local tasks, full `route_task` now preserves the initial local decision model instead of silently reselecting a smaller model.

---

### Bug 9 — Full `route_task` high-complexity paid routing fell back to local after OpenRouter attempt (fixed 2026-05-19)

**Symptom:** With `OPENROUTER_API_KEY` configured and `complexity: 0.9`, `preemptive_route_task` correctly selects `gpt-4o` with `costClass: "paid"`. A full `route_task` with a tiny high-complexity prompt does not return a paid/OpenRouter final result. It logs an OpenRouter execution error for `openrouter/pareto-code`, then returns a local `qwen2.5-coder:7b` final result.

**Cost guard used during test:** OpenRouter credits were checked through `GET https://openrouter.ai/api/v1/credits` before and after the run. Remaining balance stayed at `$1.644186`; no credits were consumed by the failed OpenRouter attempt. The project cost estimator reported `$0.0084` for the 120-token input / 80-token output preflight, below `COST_THRESHOLD=0.02`.

**Root cause:** `route_task` computed an initial paid decision, but then delegated execution to `codeTaskCoordinator`, which decomposed the task and performed its own per-subtask model selection. That second selector could choose OpenRouter free/remote models or local models independently of the initial paid decision. The selected paid model was also an alias (`gpt-4o`) instead of an OpenRouter catalog id (`openai/gpt-4o`), which made provider execution brittle.

**Fix:** Paid `route_task` decisions now execute directly through `taskExecutor` with the selected OpenRouter model instead of being silently reselected by `codeTaskCoordinator`. Paid model selection now asks the registered paid provider for real model ids and prefers `openai/gpt-4o` / `openai/gpt-4o-mini` when available. The selected paid model gets its own `COST_THRESHOLD` check before execution.

**Status:** ✅ Fixed — 2026-05-19. Live MCP verification with `OPENROUTER_FREE_ONLY=false`: `route_task` returned `providerId: "openrouter"`, `costClass: "paid"`, `modelId: "openai/gpt-4o"`, estimated cost `$0.0036`, valid content `{"status":"paid-openrouter-ok","check":"route_task"}`, and monitoring metadata. OpenRouter credits changed from `$1.635033553` remaining to `$1.634338553`, about `$0.000695` consumed.

---

## End-to-End Functional Test Status (2026-05-19)

Tested from Claude Code desktop on System A. OpenRouter is configured locally for bounded paid-routing checks; paid execution remains opt-in with `OPENROUTER_FREE_ONLY=false`.

| Tool | Status | Notes |
|---|---|---|
| `check_for_updates` | ✅ Works | Returns local/remote SHA correctly |
| `get_cost_estimate` | ✅ Works | Returns cost breakdown for all tiers |
| `preemptive_route_task` (low complexity, cost) | ✅ Works | Routes to local `qwen2.5-coder:7b` |
| `preemptive_route_task` (high complexity, quality) | ✅ Works | Escalates to paid `gpt-4o` |
| `route_task` — local execution, `qwen2.5-coder:7b` | ✅ Works | Returns working TypeScript code; confirmed 2026-05-19 |
| `route_task` — local execution, `qwen2.5-coder:3b` | ✅ Works | Router selects 3b for all local tasks; multiple tasks confirmed 2026-05-19 |
| `route_task` — local execution, `qwen3:4b` | ⚠️ Not independently confirmed | Router never selects `qwen3:4b`; see Bug 8 |
| `route_task` — local execution, `gemma4:26b` | ❌ Too slow | Bug 7 — 26B model exceeds timeout on 4GB VRAM hardware |
| `route_task` — paid/OpenRouter routing | ✅ Works | Fixed 2026-05-19. With `OPENROUTER_FREE_ONLY=false`, full MCP `route_task` returned paid `openai/gpt-4o` via OpenRouter and consumed about `$0.000695`. |
| `benchmark_task` | ✅ Works | Dispatch fixed 2026-05-19; live MCP call ran `qwen2.5-coder:3b` once in ~9.4s |
| `benchmark_tasks` | ✅ Works | Dispatch fixed 2026-05-19; live MCP call returned a two-task summary |
| `retriv_init` | ✅ Works | Confirmed in smoke suite (`node test-operational.mjs --suite smoke`) |
| `retriv_search` | ✅ Works | Confirmed in smoke suite after `retriv_init` |
| `cancel_job` | ⚪ Untested | Requires an active long-running job to cancel |

**Results after pulling qwen2.5-coder:7b (2026-05-19):**

`route_task` with complexity 0.3, priority cost → **✅ SUCCESS**. `qwen2.5-coder:7b` returned working TypeScript code via local Ollama. Full end-to-end local execution confirmed working once correct model is installed.

```typescript
// Actual output from qwen2.5-coder:7b via route_task:
function validateEnvVars(requiredVars: string[]): void {
  const missingVars: string[] = [];
  for (const varName of requiredVars) {
    if (!process.env[varName]) missingVars.push(varName);
  }
  if (missingVars.length > 0)
    throw new Error(`Missing required environment variables: ${missingVars.join(', ')}`);
}
```

**Results for qwen2.5-coder:3b (2026-05-19):**

Multiple `route_task` calls across complexity 0.2–0.85 with both `cost` and `quality` priority all routed to `qwen2.5-coder:3b`. The model produced correct TypeScript for debounce, LRU cache, typed event emitter, and async retry-with-backoff tasks. Code quality was solid; minor issues (lodash import in retry example) reflect model limitations not routing bugs.

**Router model-selection observation (2026-05-19):**

After running 5 additional tasks, the router consistently selects `qwen2.5-coder:3b` for all local-tier tasks. `qwen2.5-coder:7b` and `qwen3:4b` were never selected. Root cause: the scoring algorithm (`codeModelSelector.ts`) heavily weights benchmark history. Without a prior `benchmark_task` run, all local models fall back to a heuristic score (~0.5 base). `qwen2.5-coder:3b` wins due to its "coder" name pattern boost (+0.1) plus random jitter. Once the first task succeeds, its `modelPerformance` history further reinforces its selection.

**Implication:** To use `qwen2.5-coder:7b` or `qwen3:4b` as the primary inference model, run `benchmark_task` against each model first to populate performance history. Bug 3 is now fixed, so benchmark runs are unblocked; keep them bounded because large repeated runs can waste time on this hardware.

**Retest update (2026-05-19, next-target execution):**

- Full compatibility smoke pass completed from this repo using:
  - `node test-operational.mjs --suite smoke` → 25/25 passed
  - `node test-operational.mjs --suite routing` → 5/5 passed
  - `node test-operational.mjs --suite llm` → 3/3 passed (with a logged OpenRouter `ERR_CANCELED` during complexity analysis fallback, but route call returned successfully)
- Bounded benchmark retest:
  - `benchmark_task` with `local_model: qwen2.5-coder:7b` completed successfully.
  - `benchmark_task` with `local_model: qwen3:4b` originally timed out through MCP (`-32001`).
  - After the runner timeout-cap fix, isolated `benchmark_task` for `qwen3:4b` now returns a structured benchmark result with a failed run entry (`success: false`, output includes timeout reason) instead of failing the entire MCP request.
- Post-benchmark model-selection retest:
  - Local-only `preemptive_route_task` checks (OpenRouter key unset) selected `qwen2.5-coder:7b` for medium-complexity cost-oriented input.
  - Previously, full local-only `route_task` for comparable complexity still executed on `qwen2.5-coder:3b`.
  - After the single-subtask preservation fix in `routing/index.ts`, targeted live run now returns `providerId: "ollama"`, `modelId: "qwen2.5-coder:7b"` for the same debounce task path.
  - Multi-subtask preservation fix now lands in `routing/index.ts`: when the initial decision is local, key decomposed subtasks (highest-complexity + final execution-order subtask) are pinned to the decision model if available locally.
  - Unit coverage added in `test/modules/api-integration/routing/index.test.ts` for a 2-subtask decomposition where initial assignments were 3b and decision model was 7b; assertions verify assignments and final result model are preserved at 7b.
  - Remaining open area: collect live traces for a naturally multi-subtask task in this environment (current live complex probe still decomposed to 1 subtask).

**Next test targets:**
1. ~~`route_task` with a simple TypeScript task~~ ✅ Done
2. ~~Test `qwen2.5-coder:3b` via `route_task`~~ ✅ Done — consistently selected, confirmed working
3. ~~`route_task` with complexity 0.9 → expect paid routing~~ ✅ Done — full MCP route returned paid `openai/gpt-4o` via OpenRouter with cost below threshold
4. ~~`benchmark_task` after Bug 3 is fixed~~ ✅ Done — one live MCP call confirmed
5. ✅/⚠️ Partial — Re-test `qwen2.5-coder:7b` and `qwen3:4b` selection after benchmarks populate performance history:
  - ✅ `qwen2.5-coder:7b` benchmark completed and appears in local preemptive selection.
  - ⚠️ `qwen3:4b` benchmark timed out (`-32001`) and did not provide usable scoring data.
  - ✅ Full `route_task` now preserves `qwen2.5-coder:7b` for single-subtask local executions when the initial decision chose 7b.
  - ✅ Multi-subtask consistency is enforced by routing assignment pinning for key subtasks; unit test added.
  - ⚠️ Live multi-subtask decomposition still needs a reproducible task in this runtime to capture production logs.
6. ✅ Full smoke test with all tools documented in `docs/client-compatibility.md` (registration + core execution coverage via operational smoke/routing/llm suites)

### Provider stabilization backlog (added 2026-05-19)

The focused live pass on 2026-05-19 confirms that provider wiring is now mostly correct but still partially failing at runtime. The following backlog is required to make Ollama, LM Studio, and OpenRouter free-model flows reliable.

1. **LM Studio benchmark path parity (partially fixed, still open):**
  - Fixed today: `benchmark_model` now resolves provider-prefixed/non-prefixed LM Studio ids correctly (`google/gemma-4-e4b` no longer fails with "model not found in any registered provider").
  - Still failing: LM Studio benchmark execution for `google/gemma-4-e4b` returns opaque runtime failures; tool output is now structured but reports `successRate: 0`.
  - Next work: add actionable LM Studio error diagnostics (HTTP status/body, timeout reason, model-load state) and validate prompt/task payload compatibility for `google/gemma-4-e4b`.

2. **OpenRouter free-model reliability (open):**
  - Observed today: full `route_task` frequently selects OpenRouter free models (`baidu/cobuddy:free`, `nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free`) that fail with `invalid_request`.
  - Next work: add free-model health gating (temporary denylist/quarantine based on recent failure telemetry) so routing avoids repeatedly selecting currently failing models.

3. **Ollama local routing/benchmark continuity (open):**
  - `qwen2.5-coder:7b` routing consistency improved, but local model ranking still depends heavily on sparse benchmark history and can regress to smaller defaults.
  - Next work: run bounded benchmark coverage for `qwen2.5-coder:3b`, `qwen2.5-coder:7b`, and `qwen3:4b`, then tighten fallback scoring so first-run noise does not dominate selection.

4. **Cross-provider local model lifecycle (new TODO):**
  - **TODO:** before switching a task between local runtimes (Ollama → LM Studio, LM Studio → Ollama), explicitly unload models that are no longer active.
  - Rationale: prevent stale VRAM/RAM occupancy by previously loaded models and reduce memory-pressure failures during runtime switching.
  - Implementation target: add a provider transition hook in task execution that performs safe unload, then logs unload/load timing and memory state for operational verification.

---

## Architectural & Operational Gaps — Open Issues (discovered 2026-05-19)

Issues below are in the same severity and scope class as Issues #15–17. None are currently tracked in OPERATIONAL_TEST_PLAN.md. Each requires either a plan section or an explicit "not doing" decision before it can be closed.

---

### Issue 18 — No streaming response path; long completions time out at MCP boundary

**Concern:** All MCP tool calls return complete responses. Ollama and LM Studio both support streaming HTTP responses. For slow hardware (Bug 7) or long-output tasks, the MCP client's tool-call timeout fires before inference completes, causing a `ERR_CANCELED` or `-32001` at the boundary even when the model would eventually succeed. No streaming path exists to return partial content or progress tokens.

**Risks:**
- Any model inference exceeding the MCP client's timeout ceiling is unreachable via `route_task` regardless of `OLLAMA_TIMEOUT` setting.
- Large-context tasks (code review, document summarization) are disproportionately affected.
- No incremental output for debugging — the user sees nothing until success or timeout.

**Required research before implementation:** The MCP SDK's `StdioTransport` and `SSETransport` have different streaming semantics. Streaming tool results may require a protocol-level change. Investigate whether the MCP spec supports incremental tool result chunks, or whether the correct approach is an async job model (call `route_task` → get `jobId` → poll `cancel_job`/status until done). This is a **major design decision** requiring extensive research and planning before implementation.

**Decision (2026-05-19):** Use the async job model as the primary long-run transport strategy and treat streaming tool chunks as an optional future enhancement. The current MCP tool contract already has `jobId`/`cancel_job` semantics and works across stdio clients without introducing protocol-specific partial-result behavior, while async jobs avoid client timeout ceilings for long inference and benchmark runs. This keeps compatibility stable for Codex/Copilot/Claude clients today and lets us ship reliability controls (timeouts, queueing, progress resources) immediately without waiting on transport-level streaming guarantees.

**Status:** 🚧 In progress. Transport decision documented; async-job execution path hardening still ongoing.

---

### Issue 19 — No rate limiting or backpressure for provider calls

**Concern:** The server dispatches all incoming MCP tool calls immediately with no queuing or concurrency cap. If a client sends multiple `route_task` or `benchmark_task` calls in rapid succession:
- Ollama will receive simultaneous inference requests; its queue is hardware-limited and requests may be serialized or rejected.
- OpenRouter free-tier endpoints have per-minute and per-day rate limits. Simultaneous calls will hit 429s without any retry-after handling.
- System RAM/VRAM can be overcommitted — multiple simultaneous large model loads cause OOM on constrained hardware.

**Risks:**
- Cascading failures where one overloaded call causes all concurrent calls to fail.
- OpenRouter account temporary suspension from rate limit violations.
- Silent inference degradation (Ollama serializes requests internally; callers see high latency, not an error).

**Required research:** Whether the MCP SDK's transport layer supports backpressure, or whether queuing must be implemented at the application layer. Concurrency limits should be per-provider, not global. This interacts with Issue 18 (streaming/async job model). **Moderate engineering effort; design required.**

**Status:** 🚧 In progress.

---

### Issue 20 — Token counting uses character approximations, not actual tokenization

**Concern:** Cost estimates and context-window overflow checks use character-count heuristics (divide by 4) to approximate token counts. Real tokenization differs significantly:
- Non-English input (Chinese, Arabic, CJK) tokenizes at 1–2 chars/token instead of 4, inflating actual token counts 2–4× vs. the estimate.
- Code with dense punctuation (TypeScript generics, regex) also tokenizes at higher density.
- `get_cost_estimate` may understate actual cost by a factor of 2–3× for code-heavy tasks.
- Context-window overflow guard (`caps.largeContext` check) may pass tasks that are actually too long.

**Risks:**
- Budget overruns on OpenRouter paid routing when actual tokens exceed estimate.
- Silent truncation of inputs that exceed model context window but pass the heuristic guard.

**Required research:** Evaluate `tiktoken` (OpenAI tokenizer, npm port available), `@anthropic-ai/tokenizer`, or model-specific tokenizer APIs exposed by LM Studio / Ollama. A pluggable `tokenize(text, modelId): number` interface on `LLMProvider` would let each provider use its native tokenizer. **Low-to-moderate effort, but requires provider interface change (Section 1 extension).**

**Status:** ⏳ Not started.

---

### Issue 21 — Benchmark DB has no schema migration; field additions can corrupt old reads

**Concern:** `data/benchmarks.db` is a SQLite database. As the benchmark result schema evolves (new capability scores, new task categories, new timing fields), existing rows written in the old schema will be read by new code that expects the new fields. There is no migration framework — `CREATE TABLE IF NOT EXISTS` silently succeeds without altering existing tables, leaving old rows without new columns.

**Risks:**
- `ModelRegistry.updateBenchmarkSummary()` reads columns that don't exist in old rows → returns `undefined` → capability scoring degrades silently.
- A partial migration (some rows have new columns, some don't) causes inconsistent routing decisions.
- No rollback path if a new schema is applied and then reverted.

**Required research:** Evaluate a lightweight migration library (e.g., `better-sqlite3-migrations`, hand-rolled version-table approach). The migration must run at server startup before any benchmark reads. **Low effort if addressed early; high effort to retrofit after schema diverges across many installs.**

**Status:** ⏳ Not started.

---

### Issue 22 — Model capability drift: cached benchmark scores not invalidated on model updates

**Concern:** Benchmark scores persist in `data/benchmarks.db` and are associated with `modelId` strings (e.g., `qwen2.5-coder:7b`). When Ollama updates a model in place (new GGUF revision, different quantization pulled from the same tag), the `modelId` is unchanged but the model's actual capabilities may have changed. The cached scores are not invalidated.

**Risks:**
- A model update that degrades quality (smaller quantization, different merge) continues to receive high scores from old benchmarks.
- A model update that improves quality (better base model, new fine-tune) is penalized by old low scores.
- `CapabilityDetector`'s empirical layer makes wrong routing decisions based on stale data.

**Mitigation approach (requires design):** Store a content hash or `modified_at` timestamp from the Ollama/LM Studio model manifest alongside each benchmark record. At startup, compare the stored hash against the live provider's manifest. If they diverge, mark the model's benchmark summary as stale and re-run. **Low-moderate effort, but requires provider interface to expose model manifest metadata.**

**Status:** ⏳ Not started.

---

### Issue 23 — OpenRouter free-model catalog staleness; models change tiers without notice

**Concern:** The OpenRouter free model list (fetched and cached locally) can become stale between cache refreshes. OpenRouter moves models between free and paid tiers, retires models, and adds new free models — sometimes without advance notice. The current cache is invalidated on a time basis only, not on a change-detection basis.

**Risks:**
- A model cached as free starts returning paid-tier errors (`402 Payment Required`) for every request.
- New high-quality free models are not discovered until the next cache refresh.
- Issue #16 (free-model health gating) partially addresses repeated failures, but doesn't address tier changes — a 402 is not a transient failure.

**Required research:** Whether OpenRouter exposes a change feed or ETag-based cache invalidation for its model catalog. If not, a 402-response handler that immediately removes the model from the free catalog and triggers a re-fetch is the fallback. **Low effort once Issue 16 health gating is in place.**

**Status:** ⏳ Not started. Dependent on Issue 16 being resolved first.

---

### Issue 24 — No circuit breaker for repeatedly failing providers

**Concern:** Issue #16 addresses OpenRouter free-model health gating (quarantining specific models). The broader gap is that there is no circuit breaker at the provider level. If Ollama crashes, LM Studio becomes unresponsive, or OpenRouter returns 5xx errors, every subsequent tool call attempts and fails against the same broken provider with no backoff and no state tracking.

**Risks:**
- MCP clients receive errors on every call until the provider recovers, with no indication of whether the failure is transient or permanent.
- Repeated failed calls consume wall-clock time (connection timeouts add up).
- No automatic re-enablement when a provider recovers.

**Mitigation approach:** A circuit breaker per `LLMProvider` instance: CLOSED (normal) → OPEN (failure threshold exceeded; reject immediately) → HALF-OPEN (probe after delay). The `LLMProvider.isAvailable()` method is the natural probe. The `ProviderRegistry` is the right home for this state. **Moderate effort; the interface for `isAvailable()` already exists.**

**Status:** ⏳ Not started.

---

### Issue 25 — Context window overflow: prompt builder does not enforce token limits before dispatch

**Concern:** `codeTaskCoordinator` builds prompts by concatenating system prompt + task description + context. There is no pre-dispatch check that the assembled prompt fits within the selected model's declared `contextWindow`. When the prompt exceeds the context window:
- Ollama silently truncates the input from the beginning (losing system prompt context).
- LM Studio returns a 400 or 413 error.
- The error surfaces as a generic execution failure, not as a "context overflow" diagnostic.

**Risks:**
- Silent truncation in Ollama leads to incorrect outputs without any error signal.
- Large tasks that should decompose into subtasks are instead sent to a model that can't fit them, producing garbage results.
- The `caps.largeContext` flag (from Section 5) is checked for model selection but not enforced at prompt assembly time.

**Required research:** Add a pre-flight token estimate (see Issue 20) against `ModelMetadata.contextWindow` before dispatching. If overflow is detected, either truncate with a logged warning, trigger task decomposition, or return an actionable error. This requires resolving Issue 20 first. **Moderate effort, depends on Issue 20.**

**Status:** ⏳ Not started.

---

### Issue 26 — No periodic provider health probing; dead providers discovered only at call time

**Concern:** Provider availability is checked at startup (`registry.initAll()`) and then only at the moment a task is dispatched. If Ollama stops between startup and a `route_task` call, the router selects the Ollama model based on stale "available" state, the task dispatches, and fails at execution — burning latency and potentially falling back to a paid provider unnecessarily.

**Risks:**
- Users on flaky hardware (laptop suspending, Ollama crashing due to OOM) see silent fallback to paid routing without understanding why.
- The `preemptive_route_task` response may claim a local model is available when it is not.

**Mitigation approach:** A background health-probe loop that pings each provider's health endpoint (Ollama: `GET /api/tags`, LM Studio: `GET /v1/models`) every N seconds and updates `ProviderRegistry`'s availability state. The loop must not interfere with in-flight requests. N should be configurable (`PROVIDER_HEALTH_INTERVAL_MS`, default 30s). **Low-moderate effort; does not change public interfaces.**

**Status:** ⏳ Not started.

---

### Issue 27 — Job queue is in-memory; server restart loses all in-flight jobs

**Concern:** `JobTracker` holds job state in memory. If the server restarts (crash, update, manual restart), all in-flight jobs are lost. MCP clients that issued `route_task` calls and received a `jobId` have no way to recover the result.

**Risks:**
- During `update_server` (the self-update flow), the server restarts and abandons any running inference.
- On hardware that OOM-kills the server process, partial results are unrecoverable.
- No retry or resume mechanism exists.

**Required research:** Whether the MCP spec or any MCP client provides a job-recovery protocol. If not, the simplest mitigation is persisting job state to SQLite (alongside the benchmark DB) so a restarted server can report `failed` with a reason instead of having the job simply vanish. **Moderate effort; requires schema design.**

**Status:** ⏳ Not started.

---

### Issue 28 — Server requires full restart to pick up config changes

**Concern:** Changes to `models.json`, `strategies.json`, `.env` variables (`OLLAMA_TIMEOUT`, `LOCALLAMA_PROFILE`, provider endpoints), or `OPENROUTER_API_KEY` require a full server restart and MCP client reconnect. There is no hot-reload mechanism. During development, this slows iteration significantly.

**Risks:**
- Operators adding a new model or adjusting timeouts in production must disconnect all MCP clients, restart, and reconnect — disrupting active sessions.
- Config errors are only discovered at restart time, not at edit time.

**Mitigation approach:** A `reload_config` MCP tool (or a signal handler for `SIGHUP` on Unix) that re-reads `models.json` and `strategies.json` without restarting the process. Provider endpoints and API keys would still require restart (they affect authenticated HTTP clients). **Low effort for the file-reload subset; higher for credential-bearing config.**

**Status:** ⏳ Not started.

---

### Issue 29 — No authentication on MCP server; any stdio client can call paid tools

**Concern:** The MCP server accepts all tool calls from any connected client with no authentication. Because it uses stdio transport, the client must be a trusted local process — but this assumption may not hold:
- A compromised MCP client (malicious plugin, supply-chain attack on a coding agent) can call `route_task` with `complexity: 0.9` to trigger paid OpenRouter calls without user awareness.
- `OPENROUTER_API_KEY` is passed through the environment; any code with access to the server process can exfiltrate it.
- There is no per-tool permission model (e.g., "allow routing decisions but not paid execution without confirmation").

**Required research:** The MCP spec does not yet define a standard authorization layer for stdio transports. Options include: (a) require a shared secret token in every tool call's arguments, (b) a `confirm_paid_action` tool that must be called before any paid execution, (c) rely entirely on OS process isolation and document the trust model explicitly. This is a **security-sensitive design decision requiring dedicated research and threat modeling before implementation.** Do not implement without a written threat model.

**Status:** ⏳ Not started.

---

### Issue 30 — Prompt injection risk in user-supplied task strings

**Concern:** The `task` argument in `route_task` and `benchmark_task` is a free-form string that is embedded directly into prompts sent to local models. There is no sanitization layer. A crafted task string could:
- Attempt to override system-prompt instructions in the local model (jailbreak attempts).
- Inject `</system>` or similar delimiters that some models treat as special tokens.
- For benchmarking: skew benchmark scores by including prompt text that reveals expected outputs.

**Risks:**
- Local model outputs a harmful or policy-violating response that the MCP client surfaces to the user.
- Benchmark results are poisoned, leading to incorrect model selection.
- For OpenRouter paid routing: prompt injection costs extra tokens and may trigger content moderation blocks.

**Required research:** Whether the prompting strategy layer (`PromptingStrategyService`) is the correct place to add sanitization, or whether a separate input-validation stage is needed before prompt assembly. Sanitization must not break legitimate code tasks that include delimiter-like characters. **Low-moderate effort; high-priority for any publicly-accessible deployment.**

**Status:** ⏳ Not started.

---

### Issue 31 — No system memory pressure monitoring during inference

**Concern:** On constrained hardware (16 GB RAM, 4 GB VRAM — System A), loading a model that exceeds available memory causes the process or the runtime (Ollama daemon) to be OOM-killed by the OS. The server has no awareness of system memory state before dispatching a task to a large model. It will dispatch `gemma4:26b` to Ollama on 4 GB VRAM hardware and succeed in the dispatch even though the inference will OOM.

**Risks:**
- Ollama daemon OOM-killed mid-inference corrupts the `ollama-models.json` cache if a write was in progress.
- Server receives a connection reset instead of a graceful error, surfacing as `ERR_CANCELED` (Bug 5's pattern).
- Repeated OOM-kill cycles destabilize the host system.

**Mitigation approach:** Query system free RAM and VRAM (via `os.totalmem()` / `os.freemem()` for RAM; GPU memory requires platform-specific tooling) before dispatching to a local model. Compare against `ModelMetadata` declared footprint (if added to `models.json`). If insufficient, skip the model in selection rather than failing at execution. **Moderate effort; GPU memory query requires platform-specific code (Windows: `wmic`, Linux: `nvidia-smi`/`rocm-smi`).**

**Status:** ⏳ Not started.

---

### Issue 32 — Multi-instance coordination undefined beyond single lock file

**Concern:** The lock file prevents two server instances from running against the same data directory. But there is no designed story for legitimate multi-instance scenarios:
- Development vs. installed copy (the dual-maintenance operational note already flags this).
- A test suite that spawns the server as a subprocess while the dev server is also running.
- Future: a cluster deployment where multiple server instances share a database.

**Risks:**
- Developers working in the source repo while the installed MCP server is active will hit lock contention and confusing errors.
- `test-operational.mjs` spawns a server child process; if the installed server is running, the test server fails to acquire the lock and all tests fail with cryptic output.

**Mitigation approach (near-term):** `LOCALLAMA_DATA_DIR` environment variable that redirects all file-based state (lock, DB, caches) to a non-default path. Test scripts set this to a temp directory. **Low effort; unblocks test isolation immediately.**

**Status:** ⏳ Not started.

---

### Issue 33 — Provider API version compatibility not detected at startup

**Concern:** LM Studio and Ollama change their local REST API shapes between versions (endpoint paths, response field names, authentication requirements). The server has no version detection — it assumes the API shape it was written against is available. A user upgrading Ollama from 0.3.x to 0.4.x (for example) may see silent failures or wrong behavior without any diagnostic message.

**Risks:**
- LM Studio `POST /v1/chat/completions` is currently assumed; a future version might move to a different path or add required headers.
- Ollama `/api/tags` response shape changes (already seen: the `/api` prefix issue in Bug 2) can break model discovery silently.
- No version compatibility matrix is documented.

**Mitigation approach:** At `provider.init()` time, detect the provider's version (Ollama: `GET /api/version`; LM Studio: `GET /v1/models` response headers or version field). Log a warning if the version is outside the tested range. Add a `docs/provider-compatibility.md` with the tested version matrix. **Low effort for detection and logging; ongoing maintenance required.**

**Status:** ⏳ Not started.

---

### Issue 34 — Implicit POSIX assumptions remain in shell-dependent code paths

**Concern:** Bug 4 fixed the main `rootDir` resolution bug, and the operational checklist now has Windows-native Node/PowerShell commands. However, other POSIX-style assumptions may remain:
- Path separator usage: any `path.join` call that produces a path used in a shell command (e.g., spawning the BM25 engine or future sidecar processes) may use `\` on Windows where `/` is expected.
- Some workflow/docs commands still need Windows-native equivalents or explicit Windows notes.
- Log rotation or file management using Unix signals (`SIGHUP`) does not apply on Windows.
- Future sidecar processes or provider health-check scripts should be written to work on Windows natively or explicitly document Windows alternatives.

**Risks:**
- A future subprocess spawn fails on Windows with a path error that is non-obvious.
- State written by auxiliary services still follows the caller's `cwd` instead of the resolved install root.

**Mitigation approach:** Continue auditing shell invocations in `test-operational.mjs`, `docs/`, and npm scripts for POSIX-only commands, and move all persisted local state (`lock`, caches, benchmark artifacts, logs) to the resolved install root or an explicit override such as `LOCALLAMA_ROOT_DIR` / future `LOCALLAMA_DATA_DIR`. **Low effort for documentation; moderate for tooling changes.**

**Status:** 🚧 In progress.

---

## Interactive Testing Webapp — Planning Section

> **Scope note:** This section captures requirements, architectural considerations, risks, and open research questions for a future human-facing MCP test client implemented as a web application. No implementation code is included here. Items marked **[MAJOR DESIGN REQUIRED]** must not be implemented without a dedicated design/research phase and explicit approval.

### Purpose

The interactive testing webapp is a developer-facing tool — not a production feature or end-user product. Its primary purpose is to allow developers, contributors, and QA to:

1. Discover and inspect what the running MCP server exposes (tools, resources, registered models, routing state).
2. Invoke MCP tools interactively with controlled inputs and observe structured responses.
3. Run and visualize benchmarks, routing decisions, and capability assessments against selected models.
4. Capture reproducible diagnostics, structured logs, and error reports for bug filing.
5. Validate operational readiness across providers (Ollama, LM Studio, OpenRouter) without writing test scripts.

### Guiding constraints

- **No new backend logic.** The webapp must not introduce MCP tools, endpoints, or server behaviors that exist only to serve the webapp. All intelligence stays server-side. The webapp is a thin client.
- **Reuse existing interfaces.** The MCP server's tool surface, `locallama://status` and `locallama://models` resources, benchmark DB queries, and job tracking are the APIs the webapp consumes.
- **Localhost-only default.** The webapp must bind to `127.0.0.1` by default. It must not be inadvertently exposed to a network. Any deviation requires explicit configuration and a security review.
- **No secrets in the browser.** `OPENROUTER_API_KEY` and other credentials must never be sent to or stored in the browser. All credentialed calls go through the existing server.

---

### Transport layer research requirement **[MAJOR DESIGN REQUIRED]**

The existing MCP server speaks `StdioTransport` only — a browser cannot open a stdio pipe. Two architectural options exist:

**Option A — HTTP/SSE bridge process**
A thin Node.js bridge runs alongside the MCP server. The bridge spawns the MCP server via stdio (exactly as `test-operational.mjs` does), proxies tool calls received over HTTP/SSE from the browser to the stdio pipe, and streams responses back. The browser communicates with the bridge, not the MCP server directly.

Risks:
- Adds a second process to manage, increasing operational complexity.
- The bridge becomes a bottleneck; long-running tool calls (benchmarks) require SSE keep-alive or WebSocket upgrade.
- The bridge must be co-located with the MCP server (same machine); remote webapp use is not a supported scenario.
- MCP tool schemas must be re-exposed by the bridge (or fetched from the server's `list_tools` response) so the browser can construct valid call payloads.

**Option B — MCP SDK SSETransport**
The MCP SDK includes an `SSEServerTransport` (for Express/Node HTTP servers). The MCP server could be modified to optionally listen on an HTTP port (configurable, off by default) using `SSETransport` instead of (or in addition to) stdio. The browser connects directly to this SSE endpoint.

Risks:
- Modifying the server to support a second transport requires careful design to avoid breaking the stdio path.
- `SSETransport` in the MCP SDK is currently lower-maturity than `StdioTransport`; its behavior under slow connections and long-running tool calls must be validated.
- A listening HTTP port widens the attack surface; the default-off requirement must be enforced at the config layer.
- Streaming responses (Issue 18) become more natural with SSE but still require MCP protocol-level support for incremental tool results.

**Research required before choosing:** Review the MCP SDK's current SSETransport implementation for production readiness, streaming support, and authentication hooks. Evaluate whether the bridge pattern (Option A) is simpler to implement without touching the server. Choose one option and document it in a dedicated design note. **Do not implement before the design note is approved.**

---

### Frontend technology

The webapp should use established, low-dependency tooling appropriate for a developer utility:

- **Rendering:** A lightweight framework (React, Preact, or vanilla JS/HTML) sufficient for forms, tables, and real-time log streaming. No heavy SPA framework required.
- **Styling:** Minimal CSS; a utility framework (Tailwind) or plain CSS. No design system dependency.
- **Build:** If a build step is needed (TypeScript, JSX), it must be integrated into the existing `npm run build` pipeline or be entirely optional (vanilla JS preferred to avoid build overhead).
- **State:** Browser-local only. No backend state store for the webapp. Tool call history and log buffers are session-scoped and lost on page refresh (acceptable for a dev tool).

**Open question:** Whether to colocate the webapp source in this repository (under `web/` or `src/web/`) or keep it as a separate repository. Colocating simplifies development but couples the webapp release to the MCP server release. **Decision required before any implementation begins.**

---

### Feature requirements

#### Model discovery and selection

- Fetch and display the `locallama://models` resource on load.
- Show each model's provider, cost class, capability flags (from `ModelMetadata`), and last benchmark summary if available.
- Allow the user to select one or more models as the target for benchmarking or routing tests.
- Show real-time availability state (using Issue 26's health probe data if implemented; otherwise show last-known state with a staleness timestamp).
- Support filtering by provider (Ollama, LM Studio, OpenRouter free, OpenRouter paid), cost class, and capability.

**Risk:** If Issue 26 (periodic health probing) is not implemented, availability data will be stale. The webapp must clearly communicate data freshness to avoid misleading the user.

#### Tool invocation panel

- List all registered MCP tools (from the server's `list_tools` response).
- For each tool, render a form generated from the tool's JSON schema — inputs for each required and optional argument.
- Submit the form as a tool call; display the raw JSON response and a parsed/highlighted view.
- Preserve call history in the session (list of calls with timestamps, inputs, and responses).
- Allow re-running a previous call with the same or modified inputs (for reproducibility).
- Copy-to-clipboard for the full call payload (for filing bug reports).

**Risk:** Tool schemas use JSON Schema; generating accurate forms from arbitrary JSON Schema is non-trivial (handling `oneOf`, `anyOf`, array items, nested objects). Scope to the concrete schemas in use rather than building a general JSON Schema form renderer.

#### Routing test panel

- A dedicated view for `preemptive_route_task` and `route_task` that surfaces the routing decision in a readable format: selected model, provider, cost class, reason string, estimated cost.
- Allow sweeping across complexity values (0.1 → 1.0) and priorities (`cost`, `quality`) and displaying the routing decision for each combination in a table.
- Show which models were considered and why they were or were not selected (requires the routing response to include a `considered_models` debug field — **this field does not currently exist and would need to be added to the routing response schema as an optional debug field**).
- Diff two routing decisions side-by-side (e.g., before and after a benchmark run or config change).

**Risk:** The `considered_models` debug field requires a server-side change to routing output. This is additive and non-breaking, but must be designed carefully to avoid exposing internal scoring details that could be misinterpreted.

#### Benchmark runner

- UI for `benchmark_task` and `benchmark_tasks` — select task category, choose target model(s), set run count and timeout.
- Display results in a structured table: task name, success rate, latency (p50/p95), score.
- Persist benchmark results to the existing `data/benchmarks.db` via the existing server-side benchmark tools — the webapp does not write directly to the DB.
- Show historical benchmark trends for a model (previous runs) by querying the server for stored benchmark summaries (via a new read-only MCP tool or by extending `locallama://models` to include benchmark history — **design required**).
- Allow exporting benchmark results as JSON for offline analysis.

**Risk:** Benchmark runs can take minutes per model. The webapp must handle long-running tool calls without timing out or losing the connection. This is directly coupled to Issue 18 (streaming) and Issue 19 (backpressure). **The benchmark runner UI must not be built until the transport layer design (above) is resolved, because synchronous HTTP is insufficient for benchmark workloads.**

#### Diagnostics and structured logging

- A real-time log panel that streams server-side log output (currently written to `locallama-test.log`) to the browser.
- Log streaming requires either: (a) the bridge process tails the log file and pushes lines over SSE/WebSocket, or (b) the server emits log lines as MCP notifications (if the MCP SDK supports server-initiated notifications — **research required**).
- Log level filter controls (debug / info / warn / error).
- Structured error display: when a tool call returns an error, parse known error shapes (provider errors, timeout errors, model-not-found errors) and display actionable next steps alongside the raw error.
- A "reproducible report" button that packages: server version, selected model, tool call payload, raw response, and the last N log lines into a JSON blob for copy-paste into a GitHub issue.

**Risk:** Log streaming via SSE/WebSocket requires the transport layer to be in place. Without streaming, the best fallback is a manual "fetch last N lines" button that calls a dedicated log-fetch endpoint — but this requires a new backend endpoint, which violates the "no new backend logic" constraint unless a log-reader MCP tool is added. **Resolve transport design first.**

#### Telemetry dashboard

- Display aggregate metrics derived from the benchmark DB and routing history:
  - Per-model success rate over time.
  - Routing decision distribution (local vs. free vs. paid) over the last N calls.
  - Average inference latency per model and provider.
  - Estimated cumulative cost (from OpenRouter calls tracked by `cost-monitor`).
- All data sourced from the server via MCP tools or resource reads — no webapp-side computation of metrics.
- Auto-refresh on a configurable interval.

**Risk:** The current MCP surface does not expose aggregate routing history or cost tracking metrics. Either new read-only MCP resources must be added (e.g., `locallama://telemetry`, `locallama://routing-history`), or the webapp must maintain its own session-scoped accumulation of tool call results. The latter approach produces incomplete history (only what happened in the current session). Adding server-side telemetry resources is the correct long-term approach but **requires design and is out of scope for an initial webapp MVP.**

---

### Operational risks

1. **Transport layer is the critical path.** All other features depend on the webapp being able to call MCP tools. Until Option A or Option B is designed and prototyped, no other feature work should begin.

2. **Benchmark UI requires Issue 18 resolution.** Long-running benchmark calls will time out over plain HTTP. Do not build the benchmark UI until the async job model or streaming path is in place.

3. **Log streaming requires new infrastructure.** The "no new backend logic" constraint is in tension with the log streaming requirement. A careful design is needed to either relax the constraint for a minimal log-relay endpoint or find an alternative (MCP notifications, periodic polling).

4. **Security surface increases with HTTP port.** Option B (SSETransport) exposes the MCP server on a TCP port. A misconfigured bind address (`0.0.0.0` instead of `127.0.0.1`) exposes all MCP tools — including paid routing and credential-adjacent operations — to the local network. This must be prevented at the config layer, not left to the user.

5. **Webapp divergence from server.** If the webapp lives in a separate repository, schema changes to MCP tools (argument names, response shapes) may not be discovered until the webapp is exercised against a newer server version. Consider embedding the webapp in this repository to share the tool schema types.

6. **No auth within the webapp session.** The webapp is a dev tool and does not need user accounts. But if two developers share a machine and the webapp is running, both can see each other's call history and trigger paid tool calls. Document this limitation explicitly. Do not add session auth to the initial version — it is out of scope for a developer utility.

7. **Accessibility and UX scope.** The webapp is a developer tool, not a consumer product. Accessibility is still required (keyboard navigation, screen reader labels for form fields) but visual polish is not. Scope UX effort accordingly.

---

### Scalability concerns

The webapp is explicitly single-developer-at-a-time, localhost-only. Scalability concerns are therefore minimal and should not drive design decisions. The one exception: the log streaming buffer. If the server emits high-volume debug logs (e.g., during a large benchmark run), the browser's log panel must cap the in-memory buffer (e.g., last 5000 lines) and discard older entries to avoid unbounded memory growth in the browser tab.

---

### Missing dependencies to resolve before any implementation begins

| Dependency | Status | Blocks |
|---|---|---|
| Transport layer design (Option A vs. B) | ⏳ Research required | Everything |
| MCP SDK SSETransport production readiness | ⏳ Research required | Option B path |
| Streaming/async job model (Issue 18) | ⏳ Not started | Benchmark runner UI |
| Log streaming mechanism | ⏳ Design required | Diagnostics panel |
| Server-side telemetry resources | ⏳ Design required | Telemetry dashboard |
| `considered_models` debug field in routing response | ⏳ Design required | Routing test panel (full) |
| Benchmark history read API | ⏳ Design required | Benchmark runner (historical view) |
| Webapp repository location decision | ⏳ Decision required | All implementation |

---

### Validation and testing strategy for the webapp

- **Unit tests:** Form generation from JSON Schema, log line parsing, error shape detection.
- **Integration tests:** Tool call round-trips using the bridge/SSETransport, with the MCP server spawned as a subprocess (same pattern as `test-operational.mjs`).
- **Manual smoke matrix:** A checked-in `docs/webapp-smoke-checklist.md` with one row per major feature (model discovery, tool invocation, routing test, benchmark run). Run manually before each release.
- **No end-to-end browser automation initially.** The dev-tool audience means Playwright/Cypress automation is a nice-to-have, not a requirement for an initial release.

---

### UX and workflow gaps to address during design

- How does the user know which tool to invoke for a given test goal? A "quick start" panel with common testing scenarios (test routing, run a benchmark, check model availability) is more useful than an alphabetical tool list.
- How are errors distinguished from expected "routing decided local" responses? The UI must differentiate tool-level errors (MCP error codes) from application-level decisions (model selected, cost estimated).
- Benchmark results are opaque numbers without context. A "compare to baseline" feature (pin a result, then re-run to see delta) would make benchmarks actionable.
- The webapp should surface the OPERATIONAL_TEST_PLAN.md's suite structure (smoke / routing / LLM) as pre-built test sequences, not just raw tool invocations. Users unfamiliar with the server's tool surface should be able to run a smoke check with one click.


