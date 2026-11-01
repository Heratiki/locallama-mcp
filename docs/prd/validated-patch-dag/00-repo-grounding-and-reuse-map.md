# Validated Patch DAG / Scratch-Patch Execution — Repo Grounding & Reuse Map

_Authored: 2026-06-05. Purpose: repo-grounded planning foundation only. No implementation, no tickets._

---

## 0. How to Read This Document

This document maps **what already exists** against the capabilities a Validated Patch DAG architecture
requires. It is the mandatory pre-read before any implementation PRD. Every claim is anchored to a
concrete file or wiki page; treat symbol names as stable and line numbers as approximate.

Terminology follows `CONTEXT.md` and `wiki/10-glossary.md` exactly. New terms introduced here are
clearly marked.

---

## 1. Existing Repo Capabilities Relevant to This Architecture

### 1.1 Job / Session Tracking

| Capability | Where |
|---|---|
| Persistent Job queue (SQLite) | `src/modules/job-store/db.ts` — `initJobStore()`, `insertJob()`, `updateJob()`, `getJobsByTaskId()` |
| Job lifecycle state machine | `src/modules/job-store/types.ts` — `JobStatus`, `PersistedJob`, `PersistedTask` |
| In-memory Job coordinator (EventEmitter) | `src/modules/decision-engine/services/jobTracker.ts` — `JobTracker` class, `getJobTracker()` |
| Task aggregate tracking | `src/modules/job-store/db.ts` — `insertTask()`, `updateTask()`, `getTask()` |
| Boot-time alert on failed Jobs | `src/modules/job-store/alert.ts` — `refreshAlertState()`, `buildQueueAlert()` |
| Job recovery on restart | `src/modules/job-store/recovery.ts` — `recoverInProgressJobs()` |
| Queue position (computed at read time) | `src/modules/job-store/db.ts` — `getQueuePositionForJob()` (ADR-0002) |
| Job cancellation (single + task-level) | `src/modules/job-store/db.ts` — `cancelJobsForTask()` |
| `validation` column on `PersistedJob` | `src/modules/job-store/types.ts:22` — `validation?: string | null` (JSON blob) |

### 1.2 Execution Infrastructure

| Capability | Where |
|---|---|
| Provider-dispatched task execution | `src/modules/api-integration/task-execution/index.ts` — `taskExecutor.executeTask()` |
| Provider registry + slot enforcement | `src/modules/core/provider/registry.ts` — `ProviderRegistry`, `getProviderRegistry()` |
| Circuit breaker per provider | `src/modules/core/provider/circuit-breaker.ts` |
| Rate limiter (slot caps) | `src/modules/core/provider/rate-limiter.ts` |
| Local runtime lifecycle (VRAM unload hooks) | `src/modules/core/provider/local-runtime-lifecycle.ts` |
| Context-window guard (pre-dispatch) | `src/modules/utils/contextWindow.ts` — `assertPromptWithinContextWindow()` |
| Inference timeout | `src/modules/utils/inferenceTimeout.ts` — `InferenceTimeoutError` |
| Process spawn (llama.cpp) | `src/modules/llama-cpp/manager.ts` — `spawn()` |
| Process exec (updater) | `src/modules/updater/index.ts` — `execSync()`, `execFile()` |
| Build runner | `src/modules/updater/index.ts` — runs `npm run build` via `execFile` |

### 1.3 Output Validation Loop (already implemented)

| Capability | Where |
|---|---|
| `OutputValidator` (YES/NO model-graded verdict) | `src/modules/decision-engine/services/outputValidator.ts` |
| Self-validation + external validation path | `src/modules/api-integration/routing/index.ts:542–700` |
| Ranked-trio retry ladder (`good → better → best`) | `src/modules/api-integration/routing/index.ts` — `buildRankedTrio()`, `RankedTrio` type |
| Validator reputation EMA update | `outputValidator.ts` — `OutputValidator.updateReputation()` |
| `validate: false` bypass | `routing/index.ts:542` |

### 1.4 Model Routing and Selection

| Capability | Where |
|---|---|
| Primary router | `src/modules/api-integration/routing/index.ts` — `Router` class |
| Task-level model selection | `src/modules/decision-engine/services/taskRouter.ts` |
| Code model selector | `src/modules/decision-engine/services/codeModelSelector.ts` |
| Model registry (canonical benchmark-derived scores) | `src/modules/core/model-registry.ts`, `src/modules/core/capability-detector.ts` |
| Heuristic model data (preemptive path) | `src/modules/decision-engine/services/modelsDb.ts` |
| `rate_model` feedback tool | wired in `routing/index.ts`; score writes in `src/modules/decision-engine/services/modelRating.ts` |

### 1.5 Retrieval / Search / BM25

| Capability | Where |
|---|---|
| Native TypeScript BM25 engine | `src/modules/cost-monitor/bm25.ts` — `BM25Searcher` |
| Workspace-aware code indexer | `src/modules/cost-monitor/codeSearch.ts` — `workspaceRoot` param |
| Code search engine facade | `src/modules/cost-monitor/codeSearchEngine.ts` |
| `retriv_init` / `retriv_search` MCP tools | `src/modules/api-integration/retriv-integration/index.ts` |

### 1.6 SQLite Persistence

| DB file | Schema | Module |
|---|---|---|
| `data/jobs.db` | `jobs`, `tasks` tables | `src/modules/job-store/db.ts` |
| `data/benchmarks.db` | benchmark results, summaries | `src/modules/benchmark/storage/benchmarkDb.ts` |
| Path anchoring via `config.rootDir` | both DBs | `src/config/index.ts` |

### 1.7 Telemetry and Results Storage

| Capability | Where |
|---|---|
| OpenTelemetry-style spans | `src/modules/telemetry/index.ts` — `getTracer()`, `withSpan<T>()` |
| Span file export | `src/modules/telemetry/file-exporter.ts` |
| Telemetry analytics | `src/modules/telemetry/analytics.ts` |
| `get_telemetry_summary` MCP tool | `src/modules/api-integration/tool-definition/index.ts` |
| Benchmark result persistence | `src/modules/benchmark/storage/results.ts` |

### 1.8 WebSocket / Dashboard Monitoring

| Capability | Where |
|---|---|
| WebSocket side channel (Job progress) | `src/modules/websocket-server/ws-server.ts` — `broadcastJobs()` |
| Dashboard UI | `ui.html` (root) |
| Ambient monitoring metadata on responses | `routing/index.ts` — `monitoring.websocketUrl`, etc. |

---

## 2. Existing Docs and Wiki Pages Relevant to This Architecture

| Document | Relevance |
|---|---|
| `wiki/01-architecture.md` | End-to-end lifecycle (route → Job → slot → poll). The DAG architecture extends this lifecycle. |
| `wiki/03-decision-engine.md` | Two model data stores, validation loop, ranked trio. Critical context for DAG generator/validator model selection. |
| `wiki/04-providers.md` | Slot model, circuit breaker, rate limiter. DAG concurrent execution must respect these. |
| `wiki/05-job-store-execution.md` | Job persistence, recovery, alert subsystem. DAG node-Jobs live here. |
| `wiki/06-benchmarking.md` | Benchmark engine, executable scoring philosophy. Patch-execution scoring belongs in this lineage. |
| `wiki/07-cost-and-search.md` | BM25 code search, token counting, cost estimation. DAG patch planning reuses code search. |
| `wiki/08-telemetry-monitoring.md` | Telemetry spans, WebSocket. DAG execution telemetry extends this. |
| `wiki/10-glossary.md` | Canonical terms. DAG PRDs must use these terms + define new ones cleanly. |
| `CONTEXT.md` | Authoritative domain language. DAG terms (Patch, Scratch Workspace, DAG Node) must be added here before first implementation PRD. |
| `docs/PRD-validator-benchmarking.md` | Ranked-trio routing, output validation loop, `OutputValidator`. This PRD's validation infrastructure is the direct predecessor to patch-level validation. |
| `docs/fixture-promotion-policy.md` | Fixture review gate. Patch execution test fixtures follow this policy. |
| `docs/audits/ARCHITECTURAL_TRUTHS.md` | Benchmark must influence routing. Executable patch scoring is the highest-confidence signal. |
| `docs/adr/0001-non-blocking-route-task-with-persistent-job-queue.md` | Non-blocking dispatch + restart-survivable queue. DAG dispatch inherits this constraint. |
| `docs/adr/0002-dynamic-per-slot-queue-position.md` | Read-time queue position computation. Multi-node DAG queues must not add stored positions. |
| `docs/adr/0003-get-system-state-tool-design.md` | System health snapshot. DAG adds new condition codes to this surface. |
| `docs/audits/operational_issue_backlog.md` | Active open issues (#50 telemetry sync, #52 registry bypass, #53 VRAM unload) that affect DAG execution reliability. |
| `docs/AGENTS.md` | Coding guidelines, safety rules, reading order. **MCP tools must not mutate files without user approval paths.** |
| `docs/architecture/provider-registry.md` | Registry design. DAG does not bypass the registry. |

---

## 3. Existing Files / Modules That Should Be Reused or Extended

| Module | How to Reuse |
|---|---|
| `src/modules/job-store/db.ts` | Add new columns or a new table for DAG topology (parent/child job edges). Prefer schema migration via `ALTER TABLE` (existing pattern). |
| `src/modules/job-store/types.ts` | Extend `PersistedJob` with `parent_job_ids`, `patch_id`, `workspace_id` nullable fields. |
| `src/modules/job-store/recovery.ts` | DAG-aware recovery must clear dependent (child) Jobs when a parent permanently fails. Extend, don't replace. |
| `src/modules/job-store/alert.ts` | Add DAG-specific alert conditions (DAG partially blocked, no root nodes available). |
| `src/modules/decision-engine/services/jobTracker.ts` | Add DAG topology events to the existing EventEmitter surface. |
| `src/modules/api-integration/task-execution/index.ts` | Extend `taskExecutor.executeTask()` to carry `patchId` and `workspaceId` through execution. |
| `src/modules/decision-engine/services/outputValidator.ts` | `OutputValidator.validate()` is the YES/NO model judge. Patch validation uses this directly. |
| `src/modules/api-integration/routing/index.ts` | DAG-level routing decisions are Routing Decisions in the existing sense. Do not fork; extend `Router`. |
| `src/modules/core/provider/registry.ts` | All patch execution Jobs dispatch through `ProviderRegistry`. No bypass. |
| `src/modules/cost-monitor/bm25.ts` + `codeSearch.ts` | Code context retrieval for patch generation prompts. Already workspace-aware. |
| `src/modules/telemetry/index.ts` | Wrap DAG execution phases in `withSpan<T>()` spans. No new telemetry system. |
| `src/modules/benchmark/storage/benchmarkDb.ts` | Patch execution results (test pass/fail, typecheck, lint) are benchmark-quality signals. Store in `benchmarks.db`. |
| `src/modules/benchmark/evaluation/metrics.ts` | Extend metric types to include `patch_applied`, `tests_passed`, `typecheck_passed`, `lint_passed` signals. |
| `src/modules/updater/index.ts` | `execFile` pattern for subprocess launch. Reuse for test/typecheck/lint runner. |
| `src/modules/core/provider/local-runtime-lifecycle.ts` | Scratch workspace lifecycle (create/cleanup) follows the same before/after-execution hook pattern. |
| `src/config/index.ts` | Add `SCRATCH_DIR`, `PATCH_TIMEOUT_MS`, `VALIDATION_RUNNER` env vars here. |
| `CONTEXT.md` | Add new canonical terms: **Patch**, **Scratch Workspace**, **DAG Node**, **Patch Execution Result**. |

---

## 4. Existing Files / Modules That Should Not Be Touched Unless Necessary

| Module | Reason |
|---|---|
| `src/modules/job-store/db.ts` — DDL schema | Schema migration must be additive (nullable columns only, `ALTER TABLE` pattern). Breaking the `jobs` or `tasks` table schema breaks Job recovery on existing deployments. |
| `src/modules/decision-engine/services/taskRouter.ts` | Complex ranking logic. DAG does not change how a single node gets routed; it only adds topology on top. |
| `src/modules/core/provider/circuit-breaker.ts` | Already tested. DAG execution inherits its behavior without modification. |
| `src/modules/core/provider/rate-limiter.ts` | Slot accounting must not be forked. DAG Jobs enter the same slots as regular Jobs. |
| `src/modules/benchmark/core/runner.ts` | ~730 LOC, complex. Extend by adding `patch_execution` as a new benchmark task category rather than modifying the runner core. |
| `memory-bank/` (root) | Read live by `locallama://memory-bank` MCP resource (`src/modules/api-integration/resources.ts:83`). Moving or modifying structure breaks that resource. |
| `src/modules/new-module/` | Appears to be an unused scaffold (generic `NewModule`/`NewComponent` with no callers). Do not repurpose without audit — it may have been intentionally stubbed for a future feature. |
| `ui.html` | Dashboard UI. DAG monitoring should extend via the WebSocket channel already wired to the dashboard, not by patching the HTML directly. |
| `docs/adr/` | ADRs are append-only. New DAG architectural decisions get their own ADR (0004+). |
| `CONTEXT.md` | Additive only — add new terms, never rewrite existing ones. |

---

## 5. Gaps That Require New Code

The following capabilities do **not** exist and must be built from scratch (though following existing patterns):

### Gap 1 — Scratch Workspace Manager

No module manages ephemeral working directories for patch application. Required:

- Create isolated scratch directory per DAG execution (under `config.rootDir/scratch/<job_id>/`)
- Copy or clone target files into the scratch space before patch application
- Clean up on Job completion/failure
- Expose lifecycle hooks compatible with `local-runtime-lifecycle.ts` pattern

### Gap 2 — Diff / Patch Application

No module applies unified diffs or structured patches to files. Required:

- Accept a patch payload (unified diff string or structured JSON diff)
- Apply to files in the scratch workspace
- Detect and surface apply conflicts as structured errors (not swallowed)
- No dependency on `git apply` (must work in environments without git on PATH; use a pure-JS diff library or implement minimal unified diff parser)

### Gap 3 — Validation Command Runner

No module runs `tsc --noEmit`, `eslint`, or `npm test` as a subprocess and captures structured results. Required:

- Configurable command list (env var: `VALIDATION_COMMANDS`)
- Timeout per command (reuse `InferenceTimeoutError` pattern)
- Structured result: `{ command, exit_code, stdout_excerpt, stderr_excerpt, duration_ms }`
- Runs inside the scratch workspace (not the live project root)
- Follows `execFile` pattern from `src/modules/updater/index.ts`

### Gap 4 — DAG Topology in Job Store

`PersistedJob` has no parent/child relationship fields. Required:

- `parent_job_ids TEXT` (JSON array of job IDs that must complete before this Job is eligible)
- `dag_execution_id TEXT` (groups all Jobs in one DAG run; equivalent to `task_id` but for DAG-level grouping)
- DAG-aware dispatch loop: a Job is only eligible to run when all parent Jobs are `completed`
- DAG failure propagation: if a parent permanently fails, mark dependent children `cancelled` (not `failed`)

### Gap 5 — Patch Storage

No schema or storage module for patch payloads. Required:

- A `patches` table in `jobs.db` (or a new `patches.db`): `{ id, dag_execution_id, diff_text, target_files, applied_at, apply_result }`
- Patches are keyed to a DAG execution, not a single Job
- Patch content must survive server restart (DAG recovery requires re-applying the same patch)

### Gap 6 — DAG-Aware Job Recovery

`recovery.ts` currently retries any `in_progress` Job once. DAG recovery is more complex:

- A Job whose parents are not `completed` must not be retried — it must wait
- A `permanently_failed` parent must propagate cancellation to children (not retry them)
- Recovery must reconstruct DAG topology from the stored `parent_job_ids`

### Gap 7 — MCP Tool Surface for DAG Operations

No existing MCP tools for:

- `submit_patch_dag` — submit a DAG of patch Jobs (returns `dag_execution_id`)
- `get_dag_status` — aggregate status across all DAG nodes
- `cancel_dag` — cancel remaining eligible Jobs in a DAG execution
- These must follow existing tool patterns: non-blocking dispatch, ambient monitoring metadata, `_queue_alert` propagation

---

## 6. Places Where the LLM Wiki Agrees With Source Code

| Claim | Wiki Source | Code Verification |
|---|---|---|
| `route_task` returns `task_id` immediately, does not block | `wiki/01-architecture.md` | Confirmed: `routing/index.ts` creates Job, returns `task_id` before executor runs |
| Queue position computed at read time, not stored | `wiki/05-job-store-execution.md` | Confirmed: `db.ts:350` — `getQueuePositionForJob()` runs a COUNT query |
| One shared local slot, one slot per remote provider | `wiki/04-providers.md` | Confirmed: `registry.ts:29-30` — `PROVIDER_MAX_CONCURRENT_LOCAL`, `PROVIDER_MAX_CONCURRENT_REMOTE` |
| `benchmark_model` writes to `ModelRegistry`, not `modelsDb` | `wiki/03-decision-engine.md`, `wiki/06-benchmarking.md` | Confirmed: `outputValidator.ts` and `modelRating.ts` write to registry; `modelsDb.ts` seeded only at startup |
| Ranked trio (`good/better/best`) wired in routing | `wiki/03-decision-engine.md` | Confirmed: `routing/index.ts:471` — `buildRankedTrio()`, `RankedTrio` type |
| `validation` column exists on `jobs` table | `wiki/05-job-store-execution.md` (implicit via validation loop) | Confirmed: `db.ts:81` — `ALTER TABLE jobs ADD COLUMN validation TEXT`; `types.ts:22` |
| Job lifecycle: `queued → in_progress → completed \| failed \| permanently_failed \| cancelled` | `wiki/05-job-store-execution.md` | Confirmed: `types.ts:1` |
| BM25 engine has no Python runtime dependency | `wiki/07-cost-and-search.md` | Confirmed: `bm25.ts` is pure TypeScript |
| `telemetry/` uses OpenTelemetry-style spans | `wiki/08-telemetry-monitoring.md` | Confirmed: `telemetry/index.ts` — `getTracer()`, `withSpan<T>()` |
| `rootDir` anchoring for DB paths | `wiki/09-config-and-env.md` | Confirmed: `benchmarkDb.ts` and `db.ts` both use `path.join(config.rootDir, 'data', ...)` |
| `OutputValidator` has no dependency on job store or routing | `docs/PRD-validator-benchmarking.md:155` | Confirmed: `outputValidator.ts:1-4` imports only `core/provider`, `core/model`, `logger`, `modelsDb` |

---

## 7. Places Where the LLM Wiki Appears Stale, Incomplete, or Conflicts With Source Code

| Discrepancy | Wiki Claim | Actual Code | Action |
|---|---|---|---|
| **`taskExecutor.ts` identity** | `wiki/05-job-store-execution.md` and `wiki/01-architecture.md` describe `taskExecutor.ts` as pulling queued Jobs and dispatching them through the provider registry | `src/modules/decision-engine/services/taskExecutor.ts` is a simple generic in-memory `Task[]` queue class with no Job store or provider awareness. The _real_ executor is `src/modules/api-integration/task-execution/index.ts` | Wiki should clarify: `task-execution/index.ts` = execution engine; `decision-engine/services/taskExecutor.ts` = legacy/internal simple queue |
| **`new-module/` not in wiki** | Not mentioned anywhere in the wiki | `src/modules/new-module/newModule.ts` and `newComponent.ts` exist — unused scaffold with no callers | Minor gap; wiki should note this is an inert stub |
| **Two-store asymmetry still present** | `wiki/03-decision-engine.md` documents the `ModelRegistry` vs `modelsDb` asymmetry as a known "gotcha" | Issue #50 (unify telemetry routing reads) is still open as of 2026-06-05. The asymmetry has not been resolved. | Wiki is accurate about the _problem_ but does not indicate resolution ETA. DAG PRDs must not assume #50 is closed. |
| **`OutputValidator` imports `modelsDb`** | `docs/PRD-validator-benchmarking.md:155` says "No dependency on the job store, routing, or benchmark infrastructure — only `providerRegistry.executeTask`" | `outputValidator.ts:4` imports `modelsDbService` from `modelsDb.ts` for reputation updates | PRD's stated dependency constraint is partially wrong. Note for future hardening. |
| **`local-runtime-lifecycle.ts` purpose** | `wiki/04-providers.md` names it as managing "local process reachability" | File manages before/after execution VRAM hooks, not process spawn/kill. Process lifecycle is in `llama-cpp/manager.ts` | Wiki description is slightly imprecise. |
| **`validation` column schema migration** | Not covered in wiki | `db.ts:81` does `ALTER TABLE ADD COLUMN validation TEXT` on startup — stale DBs get migrated silently | The silent migration pattern (multiple `ALTER TABLE` at init) is a risk pattern not documented in the wiki. |

---

## 8. Risks From Current Architecture

### R1 — Open Issue #50 (telemetry-routing disconnect) blocks reliable DAG model selection

`preemptive_route_task` reads from `modelsDb` (heuristics), not `ModelRegistry` (benchmark-derived). Until #50 is resolved, DAG node model selection via the preemptive path returns stale/wrong models. Patch DAG PRDs must use the full `route_task` path (not preemptive) until #50 closes.

### R2 — Open Issue #52 (registry bypass) threatens DAG execution reliability

`codeEvaluationService`, `benchmarkService`, and `fallback-handler` bypass `ProviderRegistry` directly. If DAG execution triggers these code paths, circuit breakers and slot limits are evaded. DAG implementation must not call these services directly; it must go through `ProviderRegistry`.

### R3 — Open Issue #53 (VRAM unload) threatens multi-node local DAG runs

A DAG that sequences multiple local Jobs with different models will leave earlier models resident in VRAM. On 16GB hardware this causes OOM before the DAG completes. DAG PRDs must treat local multi-model DAGs as a configuration risk until #53 is resolved.

### R4 — Single-file DDL schema block in `db.ts`

`db.ts:38` runs the entire DDL as one `db.exec()` block. A partial schema (e.g. `task_id` column missing from an old `jobs.db`) causes a silent init failure (see `PROJECT_STATE.md` stale jobs.db note). Adding new DAG columns via the same block risks re-triggering this bug. Always use separate `ALTER TABLE` migrations for additive columns.

### R5 — MCP safety constraint: tools must not mutate files without approval

`docs/AGENTS.md` "Safety" section: MCP tools are model-controlled surfaces; file mutation requires clear user/client approval paths. A Validated Patch DAG _must_ write files to a scratch workspace. The approval path (explicit user opt-in, confirmation prompt, or operator-configured flag) must be designed before the first implementation PRD.

### R6 — No process isolation / sandboxing

The existing command runner in `updater/index.ts` runs in the server process's CWD, not in a sandbox. A patch that introduces a malicious or crashing command in tests would affect the server process. The scratch workspace concept must include explicit process isolation (separate CWD, controlled env vars, timeout, output capture).

### R7 — `taskExecutor.ts` naming collision

`src/modules/decision-engine/services/taskExecutor.ts` and `src/modules/api-integration/task-execution/index.ts` both use "task executor" terminology but are different things. Future developers searching for the executor are likely to find the wrong file first. Resolve before DAG adds a third "executor" concept.

### R8 — In-memory ranked trio not persisted

`buildRankedTrio()` stores the trio in the in-memory `JobTracker` map, not in `jobs.db`. If the server restarts mid-DAG-execution, the trio for surviving Jobs is lost. Currently this causes a recover-as-failed; for a DAG architecture, a restart mid-DAG must not cause the entire DAG to reset. Trio persistence (or re-computation on recovery) must be addressed.

---

## 9. Suggested Phased PRD Sequence

The following sequence ensures each PRD has all dependencies from prior PRDs before it starts.

```
PRD-01: DAG Schema & Topology Extension
  — Add parent_job_ids, dag_execution_id to PersistedJob
  — Add patches table to jobs.db
  — DAG-aware dispatch eligibility check
  — DAG-aware recovery (parent failure → children cancelled)
  Prereq: none. Must close before PRD-02.

PRD-02: Scratch Workspace Manager
  — Isolated directory per DAG execution
  — Copy/clone target files into scratch
  — Lifecycle hooks (create on start, cleanup on complete/fail)
  — Env var: SCRATCH_DIR
  Prereq: PRD-01 (needs dag_execution_id to key workspace).

PRD-03: Diff/Patch Application Module
  — Accept unified diff or structured JSON patch
  — Apply to scratch workspace files
  — Structured conflict/error return
  — No git dependency
  Prereq: PRD-02 (needs scratch workspace to apply into).

PRD-04: Validation Command Runner
  — Configurable command list (tsc, eslint, jest)
  — Runs in scratch workspace CWD
  — Timeout + structured result capture
  — Reuse execFile pattern from updater
  Prereq: PRD-02 (needs scratch workspace), PRD-03 (patch must be applied before validation).

PRD-05: DAG MCP Tool Surface
  — submit_patch_dag, get_dag_status, cancel_dag tools
  — Non-blocking dispatch returning dag_execution_id
  — Ambient monitoring metadata
  — _queue_alert propagation for DAG failures
  Prereq: PRD-01, PRD-02, PRD-03, PRD-04.

PRD-06: Executable Patch Scoring → Benchmark Integration
  — patch_applied / tests_passed / typecheck_passed / lint_passed signals
  — Extend benchmark/evaluation/metrics.ts
  — Write to benchmarks.db via benchmarkDb
  — Feed back to ModelRegistry (same path as benchmark_model)
  Prereq: PRD-04, open issue #50 resolved (reliable ModelRegistry writes).
```

Each PRD must follow the Reuse-First Rulebook (§10) and the Wiki-Grounding Rulebook (§11) before proposing new files.

---

## 10. Reuse-First Rulebook

Rules that every future PRD in this sequence must satisfy before proposing new code.

| Rule | Constraint |
|---|---|
| **R-1 Check existing modules first** | Before proposing a new file, enumerate every existing module that covers ≥50% of the required functionality. Justify the gap. |
| **R-2 Prefer extension over fork** | A new module that duplicates an existing module's interface is a fork. Forks require ADR-level justification. |
| **R-3 Schema changes are additive** | New columns on `jobs` or `tasks` must be nullable, added via `ALTER TABLE`, following the `is_local` / `validation` column precedent in `db.ts`. |
| **R-4 All Jobs through ProviderRegistry** | No patch execution Job bypasses `ProviderRegistry`. Issues #52 and ARCHITECTURAL_TRUTHS mandate this. |
| **R-5 Slot accounting is inherited** | DAG Jobs consume the same local/remote slots as regular Jobs. No new slot type without an ADR. |
| **R-6 Executable signals > heuristic signals** | Patch test execution results are the highest-confidence signal. Heuristic output scoring (existing `codeEvaluationService`) is secondary metadata only (`ARCHITECTURAL_TRUTHS.md`). |
| **R-7 BM25 code search before context expansion** | Use `BM25Searcher` + `codeSearch.ts` to select patch context. Do not pass entire repositories to models. |
| **R-8 No new DB until existing DBs are insufficient** | `jobs.db` and `benchmarks.db` cover persistence. A `patches.db` is only justified if the patch schema creates contention on `jobs.db` (e.g. large BLOB pressure). Prefer a `patches` table in `jobs.db` first. |
| **R-9 Telemetry wraps, not replaces** | Wrap DAG execution phases with `withSpan<T>()` from `telemetry/index.ts`. Do not introduce a second metrics system. |
| **R-10 Config goes in `config/index.ts`** | All new env vars (`SCRATCH_DIR`, `PATCH_TIMEOUT_MS`, etc.) are added to `src/config/index.ts` following existing patterns. No scattered `process.env` reads. |

---

## 11. Wiki-Grounding Rulebook

Rules that every future PRD in this sequence must satisfy regarding the LLM Wiki.

| Rule | Constraint |
|---|---|
| **W-1 Wiki as navigation layer, not truth layer** | Use wiki pages to identify subsystem boundaries, data flows, and likely reuse points. Confirm claims against actual source before writing implementation prose. |
| **W-2 Symbol names over line numbers** | Wiki cites `file:line`. Trust the symbol name; verify the line with a grep before citing it in a PRD. Lines drift; symbols are stable until renamed. |
| **W-3 Code wins on "what it does"** | When wiki description conflicts with what the code actually does, the code wins. Flag the discrepancy in the PRD and note it for wiki correction. Do not implement against stale wiki. |
| **W-4 Authoritative docs win on "intent"** | When wiki intent conflicts with `CONTEXT.md`, `docs/adr/`, or `docs/audits/ARCHITECTURAL_TRUTHS.md`, the authoritative doc wins. Do not implement against wiki-only claims about design philosophy. |
| **W-5 New subsystems get a wiki page** | Every PRD that ships a new subsystem (e.g. Scratch Workspace Manager, DAG Topology) must include a wiki page update (or new page) in the same change. The maintenance contract in `wiki/11-doc-map.md` applies. |
| **W-6 New terms go in `CONTEXT.md` first** | Before writing a PRD that introduces new domain terms (Patch, DAG Node, Scratch Workspace), add them to `CONTEXT.md` with `_Avoid_` notes. PRDs then use those canonical definitions. |
| **W-7 Glossary sync** | When `CONTEXT.md` gains new terms, `wiki/10-glossary.md` gets condensed entries pointing back to `CONTEXT.md`. Never duplicate full definitions. |
| **W-8 Stale wiki is a blocker** | If a discrepancy from §7 of this document affects a PRD's implementation path, correct the wiki page before merging the PRD. Stale claims in wiki pages create compounding errors in downstream PRDs. |
| **W-9 ADRs for structural choices** | Any structural decision that changes the shape of the Job store, provider interface, or execution model requires an ADR (`docs/adr/000N-...md`) with the standard format. PRDs may propose an ADR draft; the ADR is merged with the first implementing PR. |
| **W-10 No wiki rewrites** | Do not reorganize or rewrite existing wiki pages. Add new sections or correct specific stale claims via targeted edits. This avoids git conflicts and preserves historical intent. |

---

## Appendix A — Module Quick-Reference for DAG Architecture

```
src/
  modules/
    job-store/
      db.ts              ← SQLite CRUD; extend for DAG topology
      types.ts           ← PersistedJob / PersistedTask; add DAG fields
      recovery.ts        ← extend for DAG-aware recovery
      alert.ts           ← extend for DAG alert conditions
    decision-engine/
      services/
        jobTracker.ts    ← in-memory coordinator; add DAG topology events
        outputValidator.ts ← reuse YES/NO model judge for patch validation
        taskExecutor.ts  ← CAUTION: this is a legacy simple queue, NOT the main executor
    api-integration/
      task-execution/
        index.ts         ← real task executor; extend for patch/workspace params
      routing/
        index.ts         ← Router class; extend for DAG dispatch
      tool-definition/
        index.ts         ← add submit_patch_dag, get_dag_status, cancel_dag
    core/
      provider/
        registry.ts      ← all Jobs must pass through here
        circuit-breaker.ts ← inherited, do not touch
        rate-limiter.ts  ← inherited, do not touch
        local-runtime-lifecycle.ts ← model for scratch workspace lifecycle hooks
    cost-monitor/
      bm25.ts            ← reuse for code context retrieval
      codeSearch.ts      ← reuse for workspace-aware indexing
    benchmark/
      evaluation/
        metrics.ts       ← extend for patch execution signals
      storage/
        benchmarkDb.ts   ← store patch execution results here
    telemetry/
      index.ts           ← wrap DAG phases with withSpan<T>()
    updater/
      index.ts           ← execFile pattern for validation command runner
    utils/
      contextWindow.ts   ← pre-dispatch token guard; DAG nodes inherit this
      inferenceTimeout.ts ← InferenceTimeoutError; reuse for command runner timeout

  config/
    index.ts             ← add SCRATCH_DIR, PATCH_TIMEOUT_MS, VALIDATION_COMMANDS

NEW (gap-filling only):
  modules/
    scratch-workspace/
      index.ts           ← lifecycle: create / copy / cleanup per dag_execution_id
    patch-application/
      index.ts           ← apply unified diff to scratch files; structured errors
    validation-runner/
      index.ts           ← run tsc/eslint/jest in scratch CWD; structured results
```
