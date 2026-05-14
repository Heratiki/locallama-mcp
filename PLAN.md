# Plan: Make LocaLLama MCP Provider-Agnostic and Local-First

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

**Status:** ⏳ Not started.

**Tasks:**

1. **Decide fate of dual `TaskExecutor`.** Delete the class declaration inside [src/modules/api-integration/task-execution/types.ts:13-28](src/modules/api-integration/task-execution/types.ts#L13-L28) (it's a phantom). Keep only `ITaskExecutor`, `TaskExecutionOptions`, `TaskExecutionResult` interfaces in that file. The real implementation lives in [task-execution/index.ts](src/modules/api-integration/task-execution/index.ts).
2. **Fix [task-execution/index.ts](src/modules/api-integration/task-execution/index.ts).** Lines 9, 14, 15 reference symbols that don't exist (`ProviderRegistry`, `OpenRouterProvider`, `LocalModelProvider`). Either revert to the pre-refactor implementation or land Section 1 atomically with this file. **Recommendation:** revert this file to its pre-refactor state on a stabilization branch first, then do Section 1 as a single atomic PR that includes the new files *and* the rewrite of this file.
3. **Remove dead `CapabilityDetector` / `ModelRegistry` instances in [benchmark/index.ts:25-29, 67-84](src/modules/benchmark/index.ts#L25-L29).** They're unused; their presence implies functionality that doesn't exist. Delete them on the stabilization branch; reintroduce purposefully in Sections 5–6.
4. **Verify build green.** `npm run build && npm test` must pass on the stabilization branch before Section 1 begins.

**Acceptance:** `npm run build` succeeds; `npm test` passes; no unused `core/*` symbols.

**Estimated effort:** 0.5 day.

---

## Section 1 — Real ProviderRegistry abstraction

**Status:** ⏳ Not started. (Prior stub is broken; treat as un-done.)

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

### Migration of the 45 hardcoded conditionals

Replace each `model.provider === 'local' || model.provider === 'lm-studio' || model.provider === 'ollama'` with `registry.get(model.provider)?.isLocal ?? false`. Replace `provider === 'paid'` with `registry.get(model.provider)?.costClass !== 'local'`. Files to touch (from the audit):

- [src/modules/decision-engine/services/taskRouter.ts:126, 489-491, 703-705](src/modules/decision-engine/services/taskRouter.ts#L126)
- [src/modules/decision-engine/services/modelSelector.ts:54, 108](src/modules/decision-engine/services/modelSelector.ts#L54)
- [src/modules/decision-engine/services/modelPerformance.ts:300-302, 546-548](src/modules/decision-engine/services/modelPerformance.ts#L300)
- [src/modules/decision-engine/index.ts:521](src/modules/decision-engine/index.ts#L521)
- [src/modules/benchmark/core/runner.ts:81, 93, 245-246, 264](src/modules/benchmark/core/runner.ts#L81)
- [src/modules/fallback-handler/index.ts:65, 85, 201](src/modules/fallback-handler/index.ts#L65)

Total: 45 sites (per `grep -c`). Plan to do these as a single mechanical PR after the registry is in place and has unit tests.

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

**Status:** ⏳ Not started. (Stub at [src/modules/core/model-registry.ts](src/modules/core/model-registry.ts) does not load data; delete and replace.)

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

**Status:** ⏳ Not started. (Two stub classes exist; both will be deleted in Section 0.)

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

**Status:** ⚠️ Half-done and inconsistent. The file [src/config/prompting-strategies.json](src/config/prompting-strategies.json) exists with 3 toy entries; only [lm-studio/index.ts:23](src/modules/lm-studio/index.ts#L23) imports it. Ollama and OpenRouter each maintain separate runtime strategy files.

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

**Status:** ⏳ Not started. (Current stub at [src/modules/core/capability-detector.ts](src/modules/core/capability-detector.ts) just returns the metadata it was given and throws if absent.)

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

**Status:** ⏳ Not started. (Current `benchmarkModel()` at [benchmark/index.ts:67-84](src/modules/benchmark/index.ts#L67-L84) is `console.log` placeholders, no caller.)

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

**Status:** ⏳ Not started.

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

**Status:** ⏳ Not started.

Per [CLAUDE.md](CLAUDE.md), Jest runs against compiled `dist/`. Tests must not spawn the real server.

### Coverage targets

- `ProviderRegistry`: register/get/list-by-cost-class, init failure isolation (one provider failing init doesn't kill the others), `isAvailable()` mocking.
- `ModelRegistry`: provider-seeded load, JSON override merge, benchmark-summary update, staleness pruning.
- `TaskExecutor`: dispatches to the right provider; surfaces provider errors as failed jobs; job progress events fire.
- `CapabilityDetector`: heuristic table (data-driven test with ~20 model-name → expected-caps cases).
- `taskRouter` + `preemptiveRouting`: with two local providers registered, prefers the higher-scored local model regardless of which provider hosts it; falls back to paid only when no local model is capable.
- Tool dispatcher (`src/index.ts`): each tool name routes to its handler; unknown tool name returns the documented error shape.

### Existing test hygiene

- The current `test/` directory pulls from compiled `dist/`. Any new test files must use the same convention (import from `../dist/...`).
- Add a `test/fixtures/` directory with a fake provider implementation reusable across tests.

**Acceptance:** ≥80% line coverage on `src/modules/core/`; routing and benchmark integration tests passing in CI.

**Estimated effort:** 2 days.

---

## Section 9 — Lightweight-hardware path

**Status:** ⏳ Not started.

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
