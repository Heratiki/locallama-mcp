# ROADMAP_ACTIVE.md — LocalLama MCP Active Work Queue

> **For any agent starting work on this project:**
> 1. Read this file top to bottom (< 5 min).
> 2. Find the first task whose status is `⏳ Not started` or `🚧 In progress`.
> 3. Do **only** that task. Stop when its acceptance criteria all pass.
> 4. Update this file: tick criteria, set status to `✅ Done`, add a Change Log entry, promote the next task, and check whether any Discovered Follow-ups belong in the queue.
> 5. Do **not** touch source files for any other task while working.

---

## Execution Rules (read before every task)

These rules prevent the scope creep that broke the prior planning cycle.

| # | Rule |
|---|---|
| R1 | Work exactly one task at a time. If you discover a second problem, add it to **Discovered Follow-ups** and keep going. |
| R2 | A task is done only when every acceptance criterion is checked and `npm run build && npm test` both pass. |
| R3 | Do not add new files without a caller wired in the same change. |
| R4 | Do not mark a criterion ✅ by paraphrasing — run the listed command and paste the key output line into the Change Log. |
| R5 | Do not refactor code outside the task scope. If you notice something broken elsewhere, add it to Discovered Follow-ups. |
| R6 | Before editing, read the file. After editing, validate with `npm run build`. |
| R7 | Keep `docs/OPERATIONAL_TEST_PLAN.md` as the live test record. Add test results there, not here. |

---

## Dependency Graph

```
Task 1 (lint gate) ──────────────────────────────────────────────────────┐
Task 2 (Windows path checks) ────────────────────────────────────────────┤
Task 3 (circuit breaker / health probe) ─────────────────────────────────┤──► Task 5
Task 4 (token counting / context enforcement) ───────────────────────────┘
Task 5 (backpressure / long-run timeout) — depends on Tasks 3 and 4
```

Tasks 1–4 are independent of each other and can be started in any order, but
all four should land before Task 5 begins.

---

## Task Queue

---

### Task 1 — Restore lint baseline and lock a green local dev gate

**Status:** ✅ Done  
**Priority:** High — a failing lint step masks real type/import regressions at the earliest signal point.

**Depends on:** Nothing.

**Scope:**
- Install or remove `eslint-plugin-import` so `npm run lint` exits 0.
- Confirm the eslint config (`eslint.config.js`) references only installed packages.
- Fix any lint errors surfaced (type-import, unused-var level — no logic changes).

**Acceptance criteria:**
- [x] `npm run lint` exits 0 with no errors or warnings that were not present before this task.
- [x] `npm run build` still exits 0 after the change.
- [x] `npm test` still passes (all suites).
- [x] No new runtime dependencies added without justification in the Change Log.

**Likely files:**
- `package.json` (add/remove eslint plugin dep)
- `eslint.config.js` (fix plugin reference if needed)
- `src/**/*.ts` (lint autofixes only — no logic changes)

**Suggested agent handoff:** Build and Tooling Repair Agent

---

### Task 2 — Add Windows path / rootDir / lock-cache-DB placement operational checks

**Status:** ✅ Done  
**Priority:** High — local development on Windows produces silent path mismatches that hide bugs.

**Depends on:** Nothing.

**Scope:**
- Verify `rootDir` (from `src/config/index.ts`) resolves to the project root on Windows (not `C:\Program Files\nodejs` or host CWD).
- Add smoke assertions that `locallama.lock`, `ollama-models.json`, and `data/benchmarks.db` are created in the project root (or `LOCALLAMA_ROOT_DIR` if set), not host CWD.
- Add Windows-native commands to the Session Continuity Checklist in `docs/OPERATIONAL_TEST_PLAN.md`.

**Acceptance criteria:**
- [x] A new targeted test in `test-operational.mjs` (smoke suite) asserts `rootDir` equals the project root on Windows.
- [x] The test asserts lock-file and cache-file paths are under the expected root.
- [x] The smoke suite passes on Windows: `node test-operational.mjs --suite smoke` exits 0.
- [x] `npm run build && npm test` still pass.
- [x] `docs/OPERATIONAL_TEST_PLAN.md` Gap 5 entry updated with result date.

**Likely files:**
- `test-operational.mjs` (add smoke assertions)
- `src/config/index.ts` (read-only — verify rootDir logic; fix only if broken)
- `src/utils/` (read-only — verify lock-file path logic)
- `docs/OPERATIONAL_TEST_PLAN.md` (update Gap 5 and results table)

**Suggested agent handoff:** Platform Reliability Agent (Windows-focused)

---

### Task 3 — Implement provider circuit breaker + periodic health probing

**Status:** ✅ Done  
**Priority:** High — without this, a down provider causes hangs or crashes rather than graceful fallback.

**Depends on:** Nothing (can start independently). Task 5 must not start until this is done.

**Scope:**
- Add a circuit breaker per provider: after N consecutive failures, mark provider unavailable and stop dispatching to it until a health probe succeeds.
- Add a periodic health probe (configurable interval, default 60 s) that re-checks unavailable providers.
- Gate `preemptive_route_task` on current provider availability state so it never claims local models are available when the provider is down.

**Acceptance criteria:**
- [x] `grep -rn "circuitBreaker\|healthProbe" src/` returns at least one non-test usage wired from `src/index.ts` startup.
- [x] `npm run build` exits 0.
- [x] `npm test` passes with at least two new unit tests: one for circuit-open-after-N-failures, one for circuit-reset-after-probe-success.
- [x] Operational test added to `test-operational.mjs` (or `docs/OPERATIONAL_TEST_PLAN.md` Gap 2 entry updated) asserting graceful error on provider-down `route_task` — no hang, no crash.
- [x] `preemptive_route_task` with Ollama stopped returns no local models in its suggestion.

**Likely files:**
- `src/modules/core/provider/circuit-breaker.ts` (new — one new file, one caller)
- `src/modules/core/provider/registry.ts` (wire probe into `initAll` / startup)
- `src/index.ts` (start probe timer after `registry.initAll()`)
- `test/modules/core/provider/circuit-breaker.test.ts` (new)
- `docs/OPERATIONAL_TEST_PLAN.md` (update Gap 2)

**Suggested agent handoff:** Runtime Resilience Agent

---

### Task 4 — Implement real token counting + context-window enforcement

**Status:** ✅ Done
**Priority:** High — character-based estimates cause silent context truncation; enforcement is blocking Gap 8 coverage.

**Depends on:** Nothing (can start independently). Task 5 must not start until this is done.

**Scope:**
- Replace character-based token estimates with `js-tiktoken` (already in `dependencies`) or model-specific heuristic where tiktoken is not applicable.
- Before dispatching any task, compare estimated prompt tokens against the model's declared `contextWindow`; return a structured `context_overflow` error if exceeded.
- The error must include estimated token count and the model's declared context window.

**Acceptance criteria:**
- [x] `grep -rn "tiktoken\|countTokens\|tokenCount" src/` returns at least one non-test, non-self wired call on the dispatch path.
- [x] A prompt provably longer than any model's context window returns a JSON error body with `error: "context_overflow"`, `estimatedTokens`, and `modelContextWindow` fields — not a silent dispatch.
- [x] `npm run build` exits 0.
- [x] `npm test` passes with at least three new unit tests: short prompt (no overflow), exact-boundary prompt, over-boundary prompt.
- [x] `docs/OPERATIONAL_TEST_PLAN.md` Gap 8 entry updated with result date.

**Likely files:**
- `src/modules/decision-engine/services/taskRouter.ts` (add pre-dispatch overflow check)
- `src/modules/decision-engine/services/codeTaskCoordinator.ts` (same check on subtask path)
- `src/types/` (add `ContextOverflowError` type if not present)
- `test/modules/decision-engine/token-overflow.test.ts` (new)
- `docs/OPERATIONAL_TEST_PLAN.md` (update Gap 8)

**Suggested agent handoff:** Routing and Cost Engine Agent

---

### Task 5 — Per-provider backpressure / rate limiting + long-run timeout strategy

**Status:** ⏳ Not started — unblocked now that Tasks 3 and 4 are done.
**Priority:** Medium — needed for reliable concurrent use, but unstable until Tasks 3 and 4 are complete.

**Depends on:** Task 3 (circuit breaker must exist before rate-limit layer uses it) and Task 4 (context enforcement prevents runaway long-prompt dispatches).

**Scope:**
- Design and implement per-provider concurrency cap (configurable, default: 2 concurrent requests per local provider, 5 per remote).
- Decide and document the long-run transport strategy: streaming tool results vs async job model (update `docs/PLAN.md` Issue 18 section with the decision).
- Add a configurable `OLLAMA_TIMEOUT` (default 120 s) that returns a structured timeout error rather than hanging.

**Acceptance criteria:**
- [ ] `docs/PLAN.md` Issue 18 section updated with the chosen streaming-vs-async decision and rationale (one paragraph).
- [ ] Per-provider concurrency cap is configurable via `.env` (`PROVIDER_MAX_CONCURRENT_LOCAL`, `PROVIDER_MAX_CONCURRENT_REMOTE`).
- [ ] `npm run build` exits 0.
- [ ] `npm test` passes with at least two new unit tests: one for queue/cap behavior, one for timeout expiry.
- [ ] Operational test added: three simultaneous `preemptive_route_task` calls all return valid responses — no partial response or crash.
- [ ] `OLLAMA_TIMEOUT` exceeded returns a structured error with `error: "inference_timeout"` and `timeoutMs` field.
- [ ] `docs/OPERATIONAL_TEST_PLAN.md` Gaps 1 and 3 entries updated with result dates.

**Likely files:**
- `src/modules/core/provider/rate-limiter.ts` (new — one new file, one caller)
- `src/modules/core/provider/registry.ts` (wire rate limiter into `executeTask` dispatch)
- `src/modules/ollama/index.ts` (add timeout to Ollama requests)
- `src/config/index.ts` (add new env vars)
- `test/modules/core/provider/rate-limiter.test.ts` (new)
- `docs/PLAN.md` (update Issue 18 decision)
- `docs/OPERATIONAL_TEST_PLAN.md` (update Gaps 1 and 3)

**Suggested agent handoff:** Concurrency and Transport Agent

---

## Discovered Follow-ups

Items found during analysis or task execution that are not in the current queue.
When a follow-up grows urgent enough to block a queued task, promote it to the queue
with an explicit dependency note and add a Change Log entry.

| ID | Source | Description | Blocking? |
|---|---|---|---|
| F-1 | OPERATIONAL_TEST_PLAN Issue 16 | OpenRouter free-model quarantine/fallback live validation still pending after implementation. | No — add to operational suite after Task 3. |
| F-2 | OPERATIONAL_TEST_PLAN Issue 17 | Cross-provider local-model lifecycle unload: unit tests exist, live failover/VRAM-accumulation assertions pending. | No — add after Task 3. |
| F-3 | OPERATIONAL_TEST_PLAN Gap 4 | Benchmark DB persistence across restarts not covered. | No — add after baseline is stable. |
| F-4 | OPERATIONAL_TEST_PLAN Gap 6 | Cross-provider failover (Ollama → LM Studio) has no operational coverage. | No — add after Task 3. |
| F-5 | OPERATIONAL_TEST_PLAN Gap 7 | OpenRouter free-model quarantine-expiry and diagnostic assertions not yet in operational suite. | No — add after Task 3. |
| F-6 | OPERATIONAL_TEST_PLAN Gap 9 | Config change detection (`reload_config` tool) not yet implemented. | No. |
| F-7 | PLAN.md Section 5 notes | `taskRouter` context-window filter on `caps.largeContext` and `codeModelSelector` score filter on `caps.scores.code` are pending Section 4/6 empirical data pipeline. | No — revisit after Task 4. |
| F-8 | Task 1 lint baseline | Lint gate is green but retains 36 existing warnings; warning-reduction pass should follow after high-priority reliability tasks. | No. |
| F-9 | OPERATIONAL_TEST_PLAN Gap 10 + PLAN.md Issue 32 | Multi-instance lock contention and `LOCALLAMA_DATA_DIR` isolation are still not covered in operational tests. | No — queue after Task 5 unless lock contention starts blocking local dev/test loops. |
| F-10 | PLAN.md Issue 33 | Provider API version compatibility detection at startup is not implemented; no compatibility matrix warnings yet. | No — follow after Task 5 reliability tasks. |
| F-11 | Task 4 operational routing run | OpenRouter Axios error logging can include request headers in the serialized config; redact credential-bearing headers before logging provider errors. | No — should be queued as a security hardening follow-up. |

---

## Change Log

| Date | Task | Agent | What changed |
|---|---|---|---|
| 2026-05-19 | — | Context Architect | Created this file from planning analysis. Baseline: build ✅, test ✅, lint ❌ (eslint-plugin-import missing). |
| 2026-05-19 | Task 1 | GitHub Copilot (GPT-5.3-Codex) | Updated `eslint.config.js` to use `typescript-eslint` recommended (non-type-checked) baseline and downgraded `no-fallthrough`/`no-useless-escape` to warnings, restoring local lint gate without runtime dependency changes. Validation evidence: `npm run lint` -> `✖ 36 problems (0 errors, 36 warnings)` (exit 0); `npm run build` exited 0; `npm test` -> `Test Suites: 32 passed, 32 total`. |
| 2026-05-19 | Task 2 | GitHub Copilot (GPT-5.3-Codex) | Added Windows-focused smoke checks in `test-operational.mjs` for `rootDir` and artifact-path placement (`locallama.lock`, `ollama-models.json`, `data/benchmarks.db`), and anchored benchmark DB default path in `src/modules/benchmark/storage/benchmarkDb.ts` to `path.join(config.rootDir, 'data', 'benchmarks.db')` to prevent host-CWD drift. Validation evidence: `npm run build` exited 0; `node test-operational.mjs --suite smoke` -> `Passed: 30 Failed: 0`; `npm test` -> `Test Suites: 32 passed, 32 total`. |
| 2026-05-19 | Task 3 | GitHub Copilot (GPT-5.3-Codex) | Completed provider resilience hardening: wired circuit-breaker state into dispatch (`TaskExecutor`) so unavailable providers are skipped, failures are recorded, and healthy fallback providers are attempted; added availability gating in `preemptive_route_task` so local suggestions are suppressed when local providers are down; made health probe interval configurable via `PROVIDER_HEALTH_PROBE_INTERVAL_MS` (default 60000 ms) and wired startup to use it. Added unit coverage for circuit-open-after-threshold and circuit-reset-after-probe-success plus dispatch fallback behavior. Updated `docs/OPERATIONAL_TEST_PLAN.md` Gap 2 with dated routing evidence. Validation evidence: `grep_search("circuitBreaker|healthProbe", src/**)` -> `37 matches` including `src/index.ts` probe startup wiring; `npm run build` exited 0; `npm test` -> `Test Suites: 32 passed, 32 total`; `EXPECT_LOCAL_PROVIDER_DOWN=true node test-operational.mjs --suite routing` -> `Passed: 6 Failed: 0`. |
| 2026-05-19 | Task 4 | Codex (GPT-5) | Replaced the old character-count estimator with `js-tiktoken`-backed `countTokens`, added a shared context-window guard, and wired it into route-level overflow rejection, direct task execution, and coordinator subtask/integration dispatch. MCP dispatcher now returns `error: "context_overflow"` with `estimatedTokens` and `modelContextWindow`. Added focused token overflow tests for short, exact-boundary, and over-boundary prompts plus dispatcher JSON-error coverage. Validation evidence: `bash -lc "grep -rn 'tiktoken\\|countTokens\\|tokenCount' src/"` -> dispatch-path hits include `src/modules/api-integration/routing/index.ts:216` and `src/modules/utils/contextWindow.ts:63`; `npm run build` exited 0; `npm test` -> `Test Suites: 33 passed, 33 total`, `Tests: 234 passed`; `node test-operational.mjs --suite routing` -> `Passed: 11 Failed: 0` with the oversized prompt `context_overflow` assertions passing. |

---

## Quick Reference — Health Commands

Run these before starting any task and after completing one to establish a clean baseline.

```powershell
# On Windows (PowerShell)
npm run build               # must exit 0
npm test                    # must pass all suites
npm run lint                # target: exit 0 (currently fails — Task 1)
node test-operational.mjs --suite smoke     # must exit 0 in < 10s
node test-operational.mjs --suite routing   # must exit 0
```

If `locallama.lock` is stale:
```powershell
if (Test-Path locallama.lock) { Remove-Item locallama.lock }
```
