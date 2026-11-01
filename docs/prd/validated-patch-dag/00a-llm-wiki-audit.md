# LLM Wiki Audit — Validated Patch DAG Planning Input

_Authored: 2026-06-05. Read-only audit. No wiki edits. No code changes._

---

## Purpose

Pre-flight check before writing implementation PRDs. Each wiki page is evaluated against current
source code. Findings are concise: accurate, stale, misleading, or absent — plus a ruling on how
future PRDs should use each section.

Methodology: grep-verified every symbol name and line number cited in the wiki against the
corresponding `.ts` source file. Line numbers are treated as approximate; symbol names are treated
as stable.

---

## Page-by-Page Findings

---

### `wiki/README.md` — System Map / Navigation Index

**Describes:** Top-level mental model + navigation table for all wiki pages.

**Source files:** `src/index.ts`, overall module layout.

**Accuracy:** Accurate. The one-paragraph mental model (MCP server → Task → Job → slot → poll) matches
actual `route_task` flow in `src/modules/api-integration/routing/index.ts`. Navigation table links
are all resolvable.

**Stale/missing:** Nothing materially wrong. The "LLM Wiki as navigation layer, not source of truth"
framing in the README is correct and important.

**PRD usage:** Use as starting-point orientation only. Do not treat any specific claim here as
verified — it delegates to per-page detail.

**Reuse opportunities:** Mental model paragraph is reusable verbatim in PRD summaries to establish
shared vocabulary.

---

### `wiki/01-architecture.md` — Architecture & Request Lifecycle

**Describes:** Five-layer diagram, route_task → Job → slot → poll lifecycle, restart survival.

**Source files:** `src/index.ts`, `src/modules/api-integration/routing/index.ts`,
`src/modules/job-store/`, `src/modules/decision-engine/services/jobTracker.ts`,
`src/modules/decision-engine/services/taskExecutor.ts`.

**Accuracy:** The lifecycle description (steps 1–9) is accurate and verified. Key symbols confirmed:
- `LocalLamaMcpServer` at `src/index.ts:156` ✓
- `CallToolRequestSchema` handler at `src/index.ts:283` ✓
- `routeTask` as a bound method of `Router` at `routing/index.ts:51` area ✓

**⚠️ Stale / misleading — `taskExecutor` naming:**
The wiki says "`taskExecutor.ts` pulls queued Jobs as slots free and runs them through the chosen
provider." The actual slot-aware executor is **`src/modules/api-integration/task-execution/index.ts`** —
this is what `routing/index.ts:7` imports as `taskExecutor`. The file
`src/modules/decision-engine/services/taskExecutor.ts` is a simple generic in-memory `Task[]`
queue class with no Job store or provider awareness and no callers from the routing path. The wiki
conflates two different files under the same "executor" label.

**⚠️ Absent:** The wiki does not mention `src/modules/api-integration/task-execution/index.ts`
(the real executor) at all. Searching the wiki for `task-execution` returns zero results.

**PRD usage:** The lifecycle steps 1–9 are reliable. Do not use the wiki's `taskExecutor.ts`
reference for the real executor — always check `api-integration/task-execution/index.ts` instead.
Any PRD that extends execution must call out this naming collision explicitly.

**Reuse opportunities:** The restart-survival design (Job recovery, Boot-time Alert) directly
applies to DAG node recovery.

---

### `wiki/02-mcp-surface.md` — MCP Tools & Resources

**Describes:** Full tool list with line numbers, resource URI list.

**Source files:** `src/modules/api-integration/tool-definition/index.ts`,
`src/modules/api-integration/resources.ts`.

**Accuracy:** Highly accurate. All tool `name:` declaration lines verified:

| Tool | Wiki line | Actual line | Match |
|---|---|---|---|
| `route_task` | 33 | 33 | ✓ |
| `retriv_init` (×2) | 79 / 401 | 79 / 401 | ✓ |
| `cancel_job` | 115 | 115 | ✓ |
| `get_task_status` | 129 | 129 | ✓ |
| `cancel_task` | 144 | 144 | ✓ |
| `get_telemetry_summary` | 159 | 159 | ✓ |
| `get_system_state` | 178 | 178 | ✓ |
| `preemptive_route_task` | 203 | 203 | ✓ |
| `get_cost_estimate` | 240 | 240 | ✓ |
| `benchmark_task` | 265 | 265 | ✓ |
| `benchmark_tasks` | 307 | 307 | ✓ |
| `benchmark_model` | 367 | 367 | ✓ |
| `retriv_search` | 437 | 437 | ✓ |
| `get_free_models` | 460 | 460 | ✓ |
| `clear_openrouter_tracking` | 495 | 495 | ✓ |
| `benchmark_free_models` | 526 | 526 | ✓ |
| `set_model_prompting_strategy` | 586 | 586 | ✓ |
| `check_for_updates` | 628 | 628 | ✓ |
| `update_server` | 637 | 637 | ✓ |
| `rate_model` | 646 | 646 | ✓ |
| `ToolDefinitionProvider` export | 689 | 689 | ✓ |

Resource URIs at `resources.ts` also verified: `locallama://status:64`,
`locallama://jobs/active:76`, `locallama://memory-bank:87` — all correct.

**Stale/missing:** The `retriv_init` duplicate registration (lines 79 and 401) is documented and
confirmed. No missing tools found. The wiki note about `locallama://memory-bank` reading the root
`memory-bank/` directory live is confirmed at `resources.ts:83`.

**PRD usage:** This page is a reliable tool-surface reference. Use it to check what already exists
before proposing new MCP tools. New DAG tools (`submit_patch_dag`, `get_dag_status`, `cancel_dag`)
must be added here when defined.

**Reuse opportunities:** Pattern for non-blocking dispatch + return-`task_id` used by `route_task`
is directly reusable for `submit_patch_dag`.

---

### `wiki/03-decision-engine.md` — Decision Engine (Routing & Model Selection)

**Describes:** `Router` class, `taskRouter`, model selectors, validation loop, ranked trio,
two-store asymmetry.

**Source files:** `src/modules/api-integration/routing/index.ts`,
`src/modules/decision-engine/services/taskRouter.ts`,
`src/modules/decision-engine/services/codeModelSelector.ts`,
`src/modules/decision-engine/services/outputValidator.ts`.

**Accuracy:** Good overall. Verified:
- `Router` class at `routing/index.ts:51` area ✓
- `ranked_trio` built by `buildRankedTrio()` and stored in `JobTracker` ✓ (lines 471, 905)
- `validate !== false` gate at `routing/index.ts:542` ✓
- `OutputValidator.validate()` called at `routing/index.ts:627, 680` ✓

**⚠️ Stale — `speculativeDecoding.ts` description:**
Wiki lists `speculativeDecoding.ts` as "speculative-decoding support hooks" under decision engine
services. The file is only imported by `benchmarkService.ts` (legacy path) and `openrouter/index.ts`.
It has zero imports from the active routing path (`taskRouter.ts`, `codeModelSelector.ts`,
`routing/index.ts`). It is an active but peripheral module — not a "hook" in the routing path. The
wiki description implies more routing integration than actually exists.

**⚠️ Stale — two-store asymmetry status:**
Wiki documents the `ModelRegistry` vs `modelsDb` asymmetry as a known "gotcha" but frames it as
an ongoing architectural fact. Issue #50 (unify telemetry routing reads from `ModelRegistry`) is
still open as of 2026-06-05. PRDs must not assume this is resolved.

**⚠️ PRD-validator-benchmarking.md vs source discrepancy:**
The PRD states `OutputValidator` has "no dependency on the job store, routing, or benchmark
infrastructure — only `providerRegistry.executeTask`." Source code at `outputValidator.ts:4` imports
`modelsDbService` from `modelsDb.ts` for reputation updates. The "no dependency" constraint from
the PRD is not fully enforced. Note for hardening but not a blocker.

**PRD usage:** The validation loop and ranked-trio sections are accurate and describe what DAG
patch-validation should extend. Two-store asymmetry section is accurate and is a real constraint —
DAG PRDs must use full `route_task` path, not preemptive, until #50 closes.

**Reuse opportunities:** Ranked-trio `good → better → best` retry ladder reusable for DAG
patch-generation retries. `OutputValidator` reusable directly for patch validation judgements.

---

### `wiki/04-providers.md` — Providers, Cost Classes & Slots

**Describes:** `ProviderRegistry`, cost classes, slot model, circuit breaker, rate limiter, llama.cpp modes.

**Source files:** `src/modules/core/provider/registry.ts`, `types.ts`, `circuit-breaker.ts`,
`rate-limiter.ts`, `local-runtime-lifecycle.ts`.

**Accuracy:** Accurate. Verified:
- `ProviderRegistry` at `registry.ts:18`, singleton `getProviderRegistry()` at `:297` ✓ (approx)
- `PROVIDER_MAX_CONCURRENT_LOCAL` at `registry.ts:29`, `PROVIDER_MAX_CONCURRENT_REMOTE` at `:30` ✓ (approx)
- `CostClass = 'local' | 'free' | 'paid'` at `types.ts:10` ✓

**⚠️ Slightly imprecise — `local-runtime-lifecycle.ts` description:**
Wiki says it "manages local process reachability." The file actually manages VRAM lifecycle hooks
(before/after-execution model load/unload) — process spawn/kill is in `llama-cpp/manager.ts`.
"Reachability" is not the right word; "model load/unload hooks" is more accurate.

**⚠️ Open risk — Issue #53 (VRAM unload):**
Wiki accurately describes the slot model but does not note that Issue #53 (same-provider model
switching without unload) is still open. DAG PRDs that sequence multiple local Jobs across different
models must flag this risk.

**PRD usage:** Slot model and registry abstraction descriptions are accurate and mandatory reading
before any execution-path changes. `local-runtime-lifecycle.ts` before/after hook pattern is the
right model for scratch workspace lifecycle hooks.

**Reuse opportunities:** `local-runtime-lifecycle.ts` hook pattern → scratch workspace
create/cleanup. `ProviderRegistry.listByCostClass()` → DAG validator model selection (prefer
local-first).

---

### `wiki/05-job-store-execution.md` — Job Store, Execution & Recovery

**Describes:** `PersistedJob`/`PersistedTask`, `JobTracker`, lifecycle, queue position, recovery,
boot-time alerts.

**Source files:** `src/modules/job-store/types.ts`, `db.ts`, `recovery.ts`, `alert.ts`,
`src/modules/decision-engine/services/jobTracker.ts`.

**Accuracy:** The lifecycle diagram and alert subsystem description are accurate. Queue position
computed-at-read-time is verified (`db.ts:350`, `getQueuePositionForJob()`). Recovery "one
auto-retry" rule confirmed in `recovery.ts`.

**⚠️ Stale — `taskExecutor.ts` reference (same issue as wiki/01):**
"`taskExecutor.ts` pulls queued Jobs as slots free." This is wrong — see wiki/01 finding. The
actual executor is `api-integration/task-execution/index.ts`. This page repeats the same stale
claim.

**⚠️ Absent — silent schema migration risk:**
Wiki does not document that `db.ts` runs schema migrations via try/catch `ALTER TABLE` at startup.
Old DBs missing the `is_local` or `validation` columns are silently upgraded. If a DAG topology
migration uses the same pattern (adding `parent_job_ids`, `dag_execution_id`), this is safe but
must be deliberate. An entirely missing column fails with `SQLITE_ERROR` on the `CREATE INDEX`
block (as noted in `PROJECT_STATE.md`) — another undocumented risk.

**⚠️ Absent — `validation` column:**
The `validation TEXT` column on `PersistedJob` is not mentioned in this wiki page despite being
the persistence mechanism for the validation loop result. Wiki is incomplete here.

**PRD usage:** Job lifecycle states are canonical here. Queue position, recovery semantics, and
alert subsystem are all accurately described and are mandatory design constraints for DAG topology.

**Reuse opportunities:** `insertJob`/`updateJob` partial-update pattern → DAG topology columns
follow the same dynamic SET clause pattern. Alert subsystem → add DAG-blocked alert condition.
`recovery.ts` → extend for DAG-aware parent-failure propagation.

---

### `wiki/06-benchmarking.md` — Benchmarking & Capability Detection

**Describes:** Modular benchmark engine, registry split, benchmark MCP tools, validator benchmarking,
CLI entrypoint.

**Source files:** `src/modules/benchmark/`, `src/modules/core/model-registry.ts`,
`src/modules/core/capability-detector.ts`.

**Accuracy:** Good overall. Registry split (benchmark writes `ModelRegistry`, not `modelsDb`)
accurately described and critical. Modular engine structure confirmed.

**⚠️ Stale — simulation adapter:**
Wiki says "Replacing the simulated path with real adapters is an explicit modernization priority."
`benchmark/api/simulation.ts` and its use in `benchmark/core/runner.ts:173` (fallback to
`simulateGenericApi`) confirm the simulation path is **still active today**. Wiki accurately
flagged this as a priority but PRDs should not assume it is resolved.

**⚠️ Absent — `benchmarkService.ts` legacy path:**
The wiki describes the modular benchmark engine but does not clearly call out that the legacy
`decision-engine/services/benchmarkService.ts` still exists and bypasses the modular engine.
Issue #51 (consolidate legacy benchmark service) is still open. The two paths coexist. PRDs that
add new benchmark task categories must target the modular engine, not `benchmarkService.ts`.

**PRD usage:** "Prefer executable scoring over heuristic quality scoring" (`ARCHITECTURAL_TRUTHS.md`,
echoed here) is the mandate for patch-execution signals. New `patch_execution` benchmark task
category belongs in the modular engine. Do not touch `benchmarkService.ts`.

**Reuse opportunities:** `benchmarkDb.ts` + `results.ts` storage path → store patch execution
results (test pass/fail, typecheck) via the same schema. `evaluation/metrics.ts` type extensions
are the right extension point for patch-specific signals.

---

### `wiki/07-cost-and-search.md` — Cost Accounting, Context Guard & Code Search

**Describes:** `costMonitor`, `tokenManager`, tiktoken context guard, BM25/retriv code search.

**Source files:** `src/modules/cost-monitor/`, `src/modules/utils/tokenCount.ts`,
`src/modules/utils/contextWindow.ts`, `src/modules/api-integration/retriv-integration/`.

**Accuracy:** Accurate. Tiktoken context guard at `contextWindow.ts` confirmed wired into
`task-execution/index.ts`. BM25 engine at `bm25.ts` is native TypeScript with no Python dependency
confirmed.

**⚠️ Slightly misleading — Python/retriv reference:**
The page notes Python env vars (`PYTHON_PATH`, `PYTHON_VENV_PATH`, `RETRIV_PYTHON_PATH`,
`PYTHON_DETECT_VENV`) as config in wiki/09. These vars are **not present** in the current
`src/config/index.ts`. They appear to have been removed or never implemented at the config layer.
The "no Python dependency" statement is correct but the env-var reference in wiki/09 is stale.

**⚠️ Absent — workspace root concept:**
`codeSearch.ts` takes a `workspaceRoot: string` constructor parameter and exposes
`workspaceRoot` as a property. This is the natural anchor point for a scratch workspace search
index, but the wiki page does not describe this parameter or the workspace-scoping capability.

**PRD usage:** BM25 search is reliable and reusable for patch context retrieval. `codeSearch.ts`'s
`workspaceRoot` pattern directly supports per-DAG-execution scratch workspace indexing. Context
guard at `contextWindow.ts` is inherited automatically by all Jobs.

**Reuse opportunities:** `codeSearch.ts` (workspace-scoped indexer) → per-scratch-workspace BM25
index. `BM25Searcher` → find relevant code chunks for patch generation prompt. `tokenCount.ts` →
pre-dispatch context budget check for patch prompts.

---

### `wiki/08-telemetry-monitoring.md` — Telemetry, Monitoring & System State

**Describes:** OpenTelemetry-style spans, WebSocket side channel, dashboard, `get_system_state`,
server reminder.

**Source files:** `src/modules/telemetry/`, `src/modules/websocket-server/`,
`src/modules/api-integration/system-state/`, `src/modules/server-reminder/`.

**Accuracy:** Accurate. `withSpan<T>()` at `telemetry/index.ts:25` confirmed. WebSocket
`broadcastJobs()` at `ws-server.ts:44` area confirmed. `get_system_state` data sources (rate
limiter, job store, circuit breaker) accurately described.

**⚠️ Absent — condition codes not listed:**
Wiki names the four valid `reasons` codes (`local_slot_benchmark_contention`, `benchmark_queued`,
`provider_unavailable`, `provider_unreachable`) but does not note that the enum is closed. DAG
PRDs that add new system health conditions (e.g. `dag_node_blocked`, `scratch_workspace_full`)
must evaluate whether these belong in `get_system_state` or in a separate ambient field.

**PRD usage:** `withSpan<T>()` wrapping pattern is the correct instrumentation approach for DAG
execution phases. WebSocket broadcast path is the right channel for DAG node progress events —
no new side channel needed. `get_system_state` `reasons` array is a closed enum; new DAG-specific
conditions need ADR-level justification before being added.

**Reuse opportunities:** `withSpan<T>()` → instrument patch apply, validation command run, DAG
node dispatch. `broadcastJobs()` → DAG node Jobs appear in WebSocket feed automatically by
inheriting existing Job tracking.

---

### `wiki/09-config-and-env.md` — Configuration & Environment

**Describes:** `Config` interface, config singleton, hot-reload vs restart split, env var reference.

**Source files:** `src/config/index.ts`.

**Accuracy:** Core structure verified:
- `Config` interface at `config/index.ts:37` ✓
- `HOT_RELOADABLE_CONFIG_FIELDS` at `:120` ✓
- `RESTART_REQUIRED_CONFIG_FIELDS` at `:152` ✓
- `buildConfigFromEnv` at `:234` ✓
- `config` singleton at `:398` ✓
- `validateConfig` at `:403` ✓
- `reloadConfig` at `:504` ✓
- `reliableBenchmarkCount`, `minValidatorScore`, `validationRetryBudget` all confirmed at `:280–282` ✓

**⚠️ Stale — Python/retriv env vars:**
Wiki lists `PYTHON_PATH`, `PYTHON_VENV_PATH`, `PYTHON_DETECT_VENV`, `RETRIV_PYTHON_PATH` under
"Python / retriv (optional)". Grepping `config/index.ts` for these names returns zero results.
These variables are **not implemented** in the current config. The code search module dropped its
Python dependency; the config vars were apparently never added or were removed. Any PRD that
follows wiki/09's Python config section will find nothing to configure.

**⚠️ Absent — `JOB_DB_PATH` override:**
`db.ts:15` shows `process.env.JOB_DB_PATH` used to override the DB path in tests. This is not
documented in wiki/09's env var reference. Not a PRD blocker but relevant to test isolation
strategy.

**PRD usage:** The hot-reload vs restart classification is critical. New DAG env vars
(`SCRATCH_DIR`, `PATCH_TIMEOUT_MS`, `VALIDATION_COMMANDS`) must be added to `config/index.ts` and
explicitly classified into `HOT_RELOADABLE_CONFIG_FIELDS` or `RESTART_REQUIRED_CONFIG_FIELDS`.
Do not use scattered `process.env` reads.

**Reuse opportunities:** `buildConfigFromEnv` pattern → follow for adding DAG-specific config vars.
`JOB_DB_PATH` test-override pattern → analogous `SCRATCH_DIR` env override for test isolation.

---

### `wiki/10-glossary.md` — Glossary

**Describes:** Condensed domain terms. Defers to `CONTEXT.md` for canonical definitions.

**Source files:** `CONTEXT.md` (primary), all modules (secondary).

**Accuracy:** All terms verified against `CONTEXT.md`. Glossary faithfully condenses the canonical
definitions.

**⚠️ Absent — terms needed for DAG architecture:**
The following terms do not yet exist in the glossary or `CONTEXT.md` and must be added before
writing implementation PRDs:
- **Patch** — a unified diff payload targeting specific files in a scratch workspace
- **Scratch Workspace** — an isolated directory per DAG execution where patches are applied and validated before touching real files
- **DAG Node** — a Job whose execution depends on one or more parent Jobs completing first
- **DAG Execution** — the aggregate of all Jobs in one directed acyclic patch plan
- **Patch Execution Result** — the structured output of applying a patch and running validation commands (exit codes, excerpts, durations)
- **Validation Command Runner** — deterministic subprocess that runs tsc/eslint/jest in a scratch workspace

**PRD usage:** All existing terms are usable as defined. New terms must land in `CONTEXT.md` + this
glossary before their first implementation PRD ships. Do not define terms in PRDs — define them
here first.

**Reuse opportunities:** "Routing Decision" definition is stable and extensible — a DAG node's
routing decision is a Routing Decision in the existing sense.

---

### `wiki/11-doc-map.md` — Doc Map & Maintenance

**Describes:** Which docs are authoritative vs strategic vs archived. Maintenance contract.

**Source files:** (meta-doc, no source files to verify)

**Accuracy:** Accurate meta-description. Archive list verified against `docs/archive/` directory.
`memory-bank/` retention rationale verified against `resources.ts:83`.

**Stale/missing:** Nothing materially wrong. The "don't fork CONTEXT.md or ADRs" rule is critical
and must be followed.

**PRD usage:** Mandatory before creating any new docs. New DAG PRDs go in `docs/prd/` (new
directory), not in `docs/archive/`, `docs/adr/`, or wiki pages. ADRs for structural DAG choices go
in `docs/adr/000N-...md` following existing numbering.

**Reuse opportunities:** ADR format (0001–0003) is the template for DAG ADRs (0004+).

---

## Cross-Cutting Findings Summary

### Verified Accurate (trust in PRDs)

| Wiki claim | Verified at |
|---|---|
| `route_task` non-blocking, returns `task_id` immediately | `routing/index.ts` dispatch path |
| Queue position computed at read time | `db.ts:350` `getQueuePositionForJob()` |
| One shared local slot, one slot per remote provider | `registry.ts:29-30` |
| Two-store asymmetry (`ModelRegistry` vs `modelsDb`) | `modelRating.ts`, `modelsDb.ts` startup seed |
| Ranked trio (`good/better/best`) wired in routing | `routing/index.ts:471, 897, 1195` |
| `OutputValidator` YES/NO judge | `outputValidator.ts:61` |
| BM25 engine no Python dependency | `bm25.ts` (pure TS) |
| `withSpan<T>()` telemetry wrapper | `telemetry/index.ts:25` |
| All tool name:line declarations in `tool-definition/index.ts` | Full table above — all ✓ |
| `config/index.ts` structure and hot-reload/restart classification | Lines 37, 120, 152, 398, 504 |

### Stale or Misleading (do not trust blindly)

| Issue | Severity | Pages affected |
|---|---|---|
| `taskExecutor.ts` identity: wiki points to legacy simple queue, not real executor (`task-execution/index.ts`) | **High** — wrong file, wrong module | wiki/01, wiki/05 |
| Python config vars (`PYTHON_PATH` etc.) listed in wiki/09 — not in `config/index.ts` | Medium — dead reference | wiki/09 |
| `speculativeDecoding.ts` described as routing hook — it is only used by legacy `benchmarkService.ts` and `openrouter/index.ts` | Low — imprecise framing | wiki/03 |
| Benchmark simulation adapter still active — wiki/06 notes it as a priority to remove but it persists | Low — known debt | wiki/06 |
| `local-runtime-lifecycle.ts` described as "process reachability" — actually VRAM lifecycle hooks | Low — imprecise | wiki/04 |
| `validation` column on `PersistedJob` not mentioned | Low — missing detail | wiki/05 |
| `JOB_DB_PATH` test override env var not in wiki/09 | Low — missing detail | wiki/09 |
| `OutputValidator` claimed "no dep on modelsDb" in PRD — actually imports `modelsDbService` | Medium — PRD constraint not enforced | docs/PRD-validator-benchmarking.md |

### Absent from Wiki (gaps that matter for DAG PRDs)

| Gap | Where it should be documented |
|---|---|
| `src/modules/api-integration/task-execution/index.ts` — the real executor | wiki/01, wiki/05 |
| `src/modules/new-module/` — unused scaffold, no callers | wiki/11 or a note in wiki/01 |
| Silent `ALTER TABLE` migration pattern in `db.ts` | wiki/05 |
| `codeSearch.ts` `workspaceRoot` constructor param | wiki/07 |
| `JOB_DB_PATH` test env override | wiki/09 |
| DAG-relevant terms (Patch, Scratch Workspace, DAG Node, etc.) | wiki/10, `CONTEXT.md` |

---

## Ruling for PRD Authors

| Rule | Rationale |
|---|---|
| Never use wiki/01 or wiki/05's `taskExecutor.ts` reference. Use `task-execution/index.ts`. | Stale — verified wrong file |
| Never add Python config vars. They don't exist in `config/index.ts`. | Stale — dead reference |
| Always verify symbol+line before citing in a PRD. | Line numbers drift; symbol names are stable |
| New domain terms → `CONTEXT.md` + wiki/10 before first implementation PRD | Glossary is a pre-req, not a post-amble |
| Treat issue #50 (two-store asymmetry) as still open | Verified open 2026-06-05 |
| Treat issue #52 (registry bypass) as still open | Verified open 2026-06-05 |
| Treat issue #53 (VRAM unload) as still open | Verified open 2026-06-05 |
| Use wiki pages to find module boundaries and intent. Grep source to confirm. | Core methodology |
