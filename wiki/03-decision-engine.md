# 03 — Decision engine (routing & model selection)

The decision engine answers one question: **given this Task, which provider and model should do
it, and why?** Its output is a **Routing Decision** (provider id, model id, cost class, reason).
The routing layer (`src/modules/api-integration/routing/`) is the public adapter; the
`src/modules/decision-engine/` services do the analysis.

## The two collaborating layers

- **`routing/index.ts`** — the `Router` class (`:51`) and its bound exports `routeTask`,
  `preemptiveRouteTask`, `cancelJob`, `getTaskStatus`, `cancelTask` (`:1463–1467`). This is the
  surface the MCP tools call. It owns enqueueing, the context-window guard, the validation loop,
  and status aggregation.
- **`decision-engine/services/`** — the brains:
  - `taskRouter.ts` (singleton `taskRouter` at `:809`) — ranks candidate providers/models.
  - `codeTaskAnalyzer.ts` — classifies the incoming Task (complexity, kind of code work).
  - `codeTaskCoordinator.ts` — decomposes a Task into subtasks → multiple Jobs.
  - `modelSelector.ts` / `codeModelSelector.ts` — pick the concrete model.
  - `codeEvaluationService.ts`, `codeValidator.ts`, `outputValidator.ts` — score/validate output.
  - `modelPerformance.ts`, `modelRating.ts`, `modelsDb.ts` — heuristic model performance store.
  - `speculativeDecoding.ts` — speculative-decoding support hooks.

## Routing is local-first

The cost-class preference order is **local → free → paid** (`CostClass` =
`'local' | 'free' | 'paid'`, `src/modules/core/provider/types.ts:10`). Ranking blends measured
cost, capability match, context capacity, latency, and benchmark history, then filters by current
provider availability (circuit breaker / rate limiter — see [04-providers](04-providers.md)). A
local model that is "good enough" wins over a paid model unless thresholds
(`TOKEN_THRESHOLD`, `COST_THRESHOLD`, `QUALITY_THRESHOLD`) or capability gaps force an escalation.

## ⚠️ The most important gotcha: two model data stores

There are **two separate** stores of model data, and they are **not** fully synced. This trips up
almost everyone. Authoritative note: `docs/AGENTS.md:92` and issue #49.

| Store | What it holds | Written by | Read by |
|-------|---------------|------------|---------|
| **`ModelRegistry` + `CapabilityDetector`** (`src/modules/core/model-registry.ts`, `core/capability-detector.ts`) | Benchmark-derived capability scores — the canonical source | `benchmark_model` | `taskRouter`, `codeModelSelector` (the **full routing path**) |
| **`modelsDbService`** (`decision-engine/services/modelsDb.ts`) | Heuristic performance data | seeded from `ModelRegistry` at startup via `seedModelRegistry()` | `preemptiveRouting()` via `getBestLocalModel()` |

The asymmetry to remember:
- `ModelRegistry → modelsDb` happens **once at startup** (`seedModelRegistry()`).
- `modelsDb → ModelRegistry` does **not** happen, and `benchmark_model → modelsDb` does **not**
  happen either.

So a fresh `benchmark_model` run updates the **full routing path** immediately, but
**`preemptive_route_task` keeps reading stale heuristics** until the next startup re-seed.
If preemptive and real routing disagree, this is almost always why.

## The validation loop & retry ladder

Background Job execution runs a **synchronous validation** step (wired into the routing path).
Output is scored; on a failing score the engine escalates deterministically along a retry ladder
`good → better → best` **without re-routing** (issue #115, `docs/PROJECT_STATE.md`). Callers can
bypass with `validate: false`, and the ladder is free-tier-budget-aware
(`VALIDATION_RETRY_BUDGET`, `MIN_VALIDATOR_SCORE`). Spec/PRD: `docs/PRD-validator-benchmarking.md`.

## See also
- How a ranked decision becomes a running Job → [01-architecture](01-architecture.md)
- Provider availability, slots, circuit breaker → [04-providers](04-providers.md)
- Where capability scores come from → [06-benchmarking](06-benchmarking.md)
- Validation/fixture policy → [`docs/fixture-promotion-policy.md`](../docs/fixture-promotion-policy.md)
