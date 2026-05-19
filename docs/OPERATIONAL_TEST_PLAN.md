# Operational Test Plan — LocalLama MCP Server

> **Purpose:** This document captures the intent, approach, and ongoing results of
> operational (live, end-to-end) testing of the LocalLama MCP server using real
> Ollama models. It is distinct from the unit/integration test suite in `test/`
> and from the PLAN.md implementation roadmap.
>
> Any AI agent or human developer can pick up this document cold and continue the
> testing work without losing context.

---

## Context & Motivation

The project's `test/` directory contains Jest unit tests. These verify internal
logic with mocks but cannot prove that the MCP server actually works when wired to
a real LLM. The PLAN.md audit (2026-05-14) flagged that several features were
marked "completed" but were never exercised end-to-end.

This plan defines an *operational* test approach: the MCP server runs as a real
process, a client connects via stdio using the official MCP SDK Client, and we call
real tools against real Ollama models. No mocks. No stubs.

---

## System Requirements (verified 2026-05-16)

| Component | Status | Notes |
|---|---|---|
| Node.js | ✅ | ES modules (`"type": "module"`) — must use `.mjs` scripts or `--experimental-vm-modules` |
| TypeScript build (`npm run build`) | ✅ | Zero `tsc` errors; `dist/` exists in worktree |
| Ollama daemon | ✅ Running on `http://localhost:11434` | |
| Ollama models | ✅ | `gpt-oss:20b` (13GB), `gemma3n:e2b` (5.6GB), `gemma3n:latest` (7.5GB) |
| LM Studio | ❓ | Not checked — not required for initial testing |
| OpenRouter API key | ✅ Present locally for bounded paid-routing tests | Keep paid calls opt-in; set `OPENROUTER_FREE_ONLY=false` only for explicit paid verification |

**Default test model:** `gemma3n:e2b` — smallest available, fastest for iteration.

---

## Test Client

**File:** [`test-operational.mjs`](test-operational.mjs)

The client is a self-contained Node.js ESM script that:
1. Spawns `node dist/index.js` as a child process.
2. Connects via `StdioClientTransport` from the MCP SDK.
3. Runs a structured suite of assertions against real tool calls.
4. Exits `0` on all-pass, `1` if any test fails.

### Running the suite

```bash
# Full suite (smoke + routing + LLM calls)
node test-operational.mjs

# Smoke only — fast, no LLM calls (~5s)
node test-operational.mjs --suite smoke

# Routing decisions only — no LLM calls (~5s)
node test-operational.mjs --suite routing

# LLM calls only — slow (~30-120s per call)
node test-operational.mjs --suite llm

# Verbose output (shows raw tool responses)
node test-operational.mjs --verbose

# Combine
node test-operational.mjs --suite smoke --verbose
```

### Environment

The server reads `.env` from the project root. The `.env` created here sets:

```
OLLAMA_ENDPOINT=http://localhost:11434
DEFAULT_LOCAL_MODEL=gemma3n:e2b
STARTUP_BENCHMARK_TARGETS=none   # don't benchmark on startup
LOG_LEVEL=debug
REMOVE_STALE_LOCK_FILES=true
```

---

## Test Suites

### Suite 1: Smoke (Server Startup + Discovery)
*No LLM calls. Verifies the server boots and exposes its declared surface area.*

| Test | What it checks | Expected |
|---|---|---|
| Connect | stdio handshake completes | Client connects without error |
| List tools | All 13 tools are registered | Exact tool names present |
| List resources | Resources are registered | `locallama://status`, `locallama://models` |
| Read `locallama://status` | Returns parseable content | JSON with `version`, `status`, or `server` fields |
| Read `locallama://models` | Returns model list | Array or `{models:[...]}` |

### Suite 2: Routing (Lightweight Decisions)
*No LLM calls. Verifies the decision engine responds with well-formed output.*

| Test | Input | Expected fields |
|---|---|---|
| `preemptive_route_task` (simple) | Short TypeScript task | `costClass`, `modelId` or `providerId`, `reason` |
| `preemptive_route_task` (complex) | Multi-feature OAuth2 server | Same fields; likely `costClass: paid` or note about complexity |
| `get_cost_estimate` | Hello-world Python | `estimatedCost` / `cost` / `totalCost` |

### Suite 3: LLM (Real Inference via Ollama)
*Makes real LLM calls. Slow (30–120s per call). Tests end-to-end routing.*

| Test | Input | Expected |
|---|---|---|
| `route_task` tiny prompt | "Write a JS `add` function" | Code in response; model identified; costClass present |

---

## Current Results

| Date | Suite | Passed | Failed | Skipped | Notes |
|---|---|---|---|---|---|
| 2026-05-16 | all | 24 | 0 | 5 | Skips: 5 optional tools absent (no OpenRouter key) |
| 2026-05-18 | smoke | 13 | 0 | 5 | After Issues #4, #5, #6 fixes. Models: `gpt-oss:20b`, `gemma3n:e2b` (no llama3 fallback) |
| 2026-05-18 | routing | 5 | 0 | 0 | Simple task → `gemma3n:e2b`; complex task → `gpt-4o` (paid). Issue #5 verified fixed |
| 2026-05-18 | all | 25 | 0 | 4 | Smoke 17, Routing 5, LLM 3. LLM inference blocked by agent sandbox (EPERM on localhost:11434) — route_task returned graceful error content; structural assertions passed. route_task chose `gpt-oss:20b` for simple task (vs `gemma3n:e2b` from preemptive); full routing engine uses different selection path than preemptive. |
| 2026-05-18 | all | 25 | 0 | 4 | After Issue #9 fix. `route_task` now correctly selects `gemma3n:e2b` for simple tasks. All routing paths (preemptive + full) consistently prefer the smallest available model for low-complexity tasks. |
| 2026-05-18 | all | 29 | 0 | 4 | After Issue #10 fix. Added `retriv_init` + `retriv_search` dispatcher cases and functional test coverage. Smoke 21, Routing 5, LLM 3. Both routing paths consistently choose `gemma3n:e2b` for simple tasks. |
| 2026-05-19 | targeted live MCP | 2 | 0 | 0 | Verified `benchmark_task` and `benchmark_tasks` dispatcher fixes through the MCP stdio path. `benchmark_task` ran one `qwen2.5-coder:3b` inference for a debounce regression task in ~9.4s. `benchmark_tasks` returned a two-task summary using cached recent 3b benchmark data. |
| 2026-05-19 | targeted paid-routing MCP | 2 | 0 | 0 | Checked OpenRouter credits (`$1.644186` remaining), then ran `get_cost_estimate` + `preemptive_route_task` for complexity 0.9. Preemptive selected paid `gpt-4o`; estimate was `$0.0084`. Full `route_task` attempted OpenRouter (`openrouter/pareto-code`) but returned local `qwen2.5-coder:7b`; balance unchanged afterward. |
| 2026-05-19 | targeted paid-routing MCP | 2 | 0 | 0 | After Issue #12 fix, ran `get_cost_estimate` and full `route_task` with `OPENROUTER_FREE_ONLY=false`. Full route returned `providerId: openrouter`, `costClass: paid`, `modelId: openai/gpt-4o`, estimated cost `$0.0036`, valid JSON content, and monitoring metadata. OpenRouter remaining credits changed from `$1.635033553` to `$1.634338553` (~`$0.000695`). |
| 2026-05-19 | focused lm-studio/openrouter-free validation | 3 | 0 | 0 | `benchmark_model` for LM Studio `google/gemma-4-e4b` no longer fails provider resolution; now returns structured result with `providerId: lm-studio` and `categoryResults.code`. Runtime execution still fails (`successRate: 0`). In same pass, `route_task` selected OpenRouter free models that failed with `invalid_request` (`baidu/cobuddy:free`, `nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free`). |

**Full suite command used:**
```bash
node test-operational.mjs --suite all
```

**Ollama model used for LLM inference:** `gpt-oss:20b` (router's choice given no small-model preference)

**Notable observations (2026-05-16):**
- LM Studio is not running — connection-refused errors logged on startup (expected, non-fatal)
- `retriv_init` and `retriv_search` are always registered (native TypeScript BM25, no Python needed)
- Router correctly chose `gpt-oss:20b` for the simple task via `preemptive_route_task`, then used it for `route_task`
- `route_task` produced valid JavaScript code from Ollama with correct `costClass: local`

**Notable observations (2026-05-18, after fixes):**
- `locallama://models` now correctly lists `gpt-oss:20b` and `gemma3n:e2b` (Issue #4 fixed)
- `preemptive_route_task` simple task now routes to `gemma3n:e2b` instead of `gpt-oss:20b` (Issue #5 fixed)
- `set_model_prompting_strategy` tool schema and dispatcher case were corrected (wrong fields → correct fields matching `updatePromptingStrategy` API)
- Unit tests: 174/174 pass; Jest teardown ReferenceErrors eliminated by adding missing mocks in `test/index.test.ts`

---

## Known Issues & Investigation Queue

Track issues found during operational testing here. This is separate from PLAN.md
(which tracks implementation work) — these are *test findings*.

| # | Severity | Tool/Module | Symptom | Root cause | Status |
|---|---|---|---|---|---|
| 1 | P1 (fixed) | `ollama/index.ts` | Ollama models not discovered on fresh start | `lastUpdated` set to `now` when no tracking file found; `hoursSinceLastUpdate = 0 < 24` → `updateModels()` never called | **Fixed 2026-05-16**: init with `new Date(0)` to force first update |
| 2 | P1 (fixed) | `ollama/index.ts` | Wrong URL: `${endpoint}/api/tags` instead of `${endpoint}/tags` | Endpoint is expected to already include `/api`; double-appending `/api` caused 404 | **Fixed 2026-05-16**: changed to `${endpoint}/tags` and `${endpoint}/chat` |
| 3 | P1 (fixed) | `tool-definition/index.ts` | `v3Schema.safeParse is not a function` crash on server when `route_task` runs | `outputSchema` fields were plain JSON schema objects; MCP SDK calls `.safeParse()` on them expecting Zod schemas | **Fixed 2026-05-16**: removed `outputSchema` from `route_task` and `preemptive_route_task` |
| 4 | P2 (fixed) | `cost-monitor/api.ts` | Models resource shows "llama3" fallback even when Ollama responds | `getAvailableModels()` concat'd LM Studio models into `confirmedModels` then pushed that back — duplicating LM Studio entries — and the `batchError` catch block never pushed basic Ollama models, triggering the fallback | **Fixed 2026-05-18**: replaced `models.concat(detailedModels)` with direct `models.push(...detailedModels)`; added basic Ollama fallback in `batchError` handler. Verified: `locallama://models` now returns `gpt-oss:20b` and `gemma3n:e2b` |
| 5 | P2 (fixed) | `decision-engine/services/modelSelector.ts` | Routes simple tasks to `gpt-oss:20b` (13GB) instead of `gemma3n:e2b` (5.6GB) | Gemma's `e2b`/`e4b` naming convention not recognized; `e2b` scored same as unknown (0.1) for all task complexities | **Fixed 2026-05-18**: added `normalizedId` regex that converts `e2b`→`2b` and `e4b`→`4b`; extended size scoring to include 2b/4b/20b/27b/32b. Verified: `preemptive_route_task` on simple task now returns `gemma3n:e2b` |
| 6 | P3 (fixed) | `cost-monitor` | Startup log spam: Python venv not found (`ENOENT .venv/bin/python`) | Hard-coded `.venv` path | **Now moot**: Python subprocess bridge fully removed; native TypeScript BM25 engine has no Python dependency |
| 7 | P2 (fixed) | `cost-monitor/api.ts` | `getAvailableModels()` fell back to hardcoded `llama3` in offline/sandboxed environments | Function bypassed `ModelRegistry` and failed with `EPERM`; catch block returned hardcoded fallback | **Fixed 2026-05-18**: added `ModelRegistry` as intermediate fallback before hardcoded value |
| 8 | P2 (resolved, arch decision) | `cost-monitor/bm25.ts` | Python `retriv` v0.2.3 unmaintainable; `numba` dependency cannot build on Python 3.11–3.14 | `retriv` is unmaintained (~2023); `numba` wheels absent for modern Python | **Resolved**: replaced entire Python subprocess bridge with native TypeScript Okapi BM25 implementation (`bm25.ts`). No Python required. `retriv_bridge.py` kept as historical reference only. `retriv_init` and `retriv_search` now always available. |
| 9 | P2 (fixed) | `decision-engine/services/codeModelSelector.ts` | `route_task` routes simple tasks to `gpt-oss:20b` (13GB) instead of `gemma3n:e2b` (5.6GB) | Same root cause as Issue #5 but in `codeModelSelector.ts` (used by `route_task` via `codeTaskCoordinator`). `calculateComplexityMatchScore` regex for small models (`1\.5b|1b|3b|mini|tiny`) didn't include `2b`/`4b` and had no `e2b`→`2b` normalization. Both fallback and main scoring paths had the gap. | **Fixed 2026-05-18**: added `normalizedId` regex (`e2b`→`2b`, `e4b`→`4b`) and extended size regexes to `2b|3b|4b` (small), `9b|12b|14b` (medium), `20b|27b|32b|65b` (large) in both scoring paths. Verified: `route_task` on simple JS task now returns `ollama:gemma3n:e2b`. |
| 10 | P2 (fixed) | `src/index.ts` `setupToolCallHandler` | `retriv_init` and `retriv_search` listed as registered tools but return `Unknown tool` when called | Dispatcher `switch` statement had no `case` blocks for `retriv_init` or `retriv_search` — tools were defined in schema but not wired to `RetrivIntegration` | **Fixed 2026-05-18**: added `case 'retriv_init'` and `case 'retriv_search'` to the dispatcher, mapping snake_case args to `RetrivIntegration.initializeRetriv()` and `.search()`. Added functional test coverage to the smoke suite. Verified: `retriv_init` indexes `src/config/` and `retriv_search` returns a result array. |
| 11 | P1 (fixed) | `src/index.ts` `setupToolCallHandler` | `benchmark_task` and `benchmark_tasks` listed as tools but returned `Unknown tool` | Dispatcher `switch` statement had no cases for the two legacy benchmark tools after the Section 6 benchmark refactor | **Fixed 2026-05-19**: added dispatcher cases, snake_case→camelCase argument normalization, and realistic dispatcher tests. Verified with targeted live MCP calls against Ollama `qwen2.5-coder:3b`. First live attempt exposed stale native dependency state (`sqlite3@5.1.7` invalid for Node 22); `npm install` reconciled to `sqlite3@6.0.1`. |
| 12 | P2 (fixed) | `route_task` / `codeTaskCoordinator` | High-complexity full `route_task` did not preserve the paid routing decision | Initial decision engine selected paid `gpt-4o`, but full execution delegated to `codeTaskCoordinator`, which reselected per-subtask models independently. Paid model selection also returned aliases instead of OpenRouter catalog ids. | **Fixed 2026-05-19**: paid decisions now execute directly through `taskExecutor`, paid model selection returns real OpenRouter ids (`openai/gpt-4o` / `openai/gpt-4o-mini`), and selected-model cost is checked before execution. Live MCP route returned paid `openai/gpt-4o` and consumed ~`$0.000695`. |
| 13 | P2 (fixed) | `cost-monitor/api.ts` | OpenRouter credit usage check hits stale `/api/v1/auth/credits` endpoint and receives 404 HTML | OpenRouter now exposes credits at `/api/v1/credits` with `{ data: { total_credits, total_usage } }` | **Fixed 2026-05-19**: updated endpoint/response parsing and added unit coverage. |
| 14 | P1 (fixed) | `benchmark_model` provider resolution | `benchmark_model` rejected valid LM Studio model ids from `locallama://models` as "not found in any registered provider" | ID format mismatch: call path used unprefixed ids (for example `google/gemma-4-e4b`) while LM Studio provider support checks/listing could require provider-prefixed variants | **Fixed 2026-05-19**: benchmark path now resolves prefixed/non-prefixed id variants and executes with provider-native id. Verified in focused live pass: tool now resolves to `providerId: lm-studio` instead of failing resolution. |
| 15 | P2 (open) | `lm-studio` runtime execution | LM Studio benchmark runs return structured results but all task executions fail (`successRate: 0`, empty output/error detail) | Runtime failure reason is currently opaque in logs/tool output; missing actionable diagnostics (transport/model-load/payload compatibility) | **Open (2026-05-19):** add execution diagnostics and reproduce with direct LM Studio provider calls to isolate timeout vs payload vs model-state failures. |
| 16 | P2 (open) | OpenRouter free-model routing | `route_task` can choose OpenRouter free models that repeatedly fail with `invalid_request` | Free-model selection lacks live health filtering; selection can choose catalog entries that are currently unusable for given payload/profile | **Open (2026-05-19):** add free-model health gating (failure-aware denylist/quarantine) and fallback to next healthy free model before returning tool error content. |
| 17 | P2 (open) | Cross-provider local runtime lifecycle | Switching local tasks between Ollama and LM Studio can leave previously loaded models resident in memory | No explicit unload handoff when local provider changes; stale model residency can waste VRAM/RAM and increase failure risk under memory pressure | **Open (new TODO, 2026-05-19):** before cross-provider local dispatch, unload inactive local models and verify with operational telemetry (memory usage + unload/load timing). |

### Severity legend
- **P0** — Server crashes or hangs; all tests blocked
- **P1** — Tool returns error or malformed response on valid input
- **P2** — Tool returns valid response but wrong/unexpected content
- **P3** — Minor formatting or field naming issues

---

## Extending the Suite

When you add a new MCP tool to the server, add a test case here:

1. Identify what inputs the tool accepts (read `src/modules/api-integration/` for its schema).
2. Choose the lightest input that exercises the tool's real logic.
3. Define the expected response shape.
4. Add a `runTest()` block in `test-operational.mjs` under the appropriate suite.
5. Run the suite and record results above.

### Tools not yet covered

| Tool | Reason not covered | When to add |
|---|---|---|
| `cancel_job` | Requires a running job ID | After `route_task` async flow is verified |
| `benchmark_task` | ~~Makes LLM calls~~ | ✅ Targeted live MCP check passed 2026-05-19. Add to automated llm suite only with an opt-in flag to avoid slow routine runs. |
| `benchmark_tasks` | ~~Makes multiple LLM calls~~ | ✅ Targeted live MCP check passed 2026-05-19 using cached recent 3b benchmark data. Add to automated llm suite only with an opt-in flag. |
| `benchmark_model` | Makes LLM calls | After benchmark_task passes |
| `benchmark_free_models` | Requires `OPENROUTER_API_KEY` | When OpenRouter key is available |
| `retriv_init` | ~~Always available (native TS BM25)~~ | ✅ Added to smoke suite 2026-05-18 — indexes `src/config/`, verifies `success` and `summary` fields |
| `retriv_search` | ~~Always available (native TS BM25)~~ | ✅ Added to smoke suite 2026-05-18 — queries after init, verifies array response |
| `get_free_models` | Requires `OPENROUTER_API_KEY` | When OpenRouter key is available |
| `clear_openrouter_tracking` | Requires `OPENROUTER_API_KEY` | When OpenRouter key is available |
| `set_model_prompting_strategy` | Requires `OPENROUTER_API_KEY` (tool only registers with key) | Schema and dispatcher fixed 2026-05-18; add live test when OpenRouter key is available |

---

## Immediate provider hardening TODOs (added 2026-05-19)

1. Add a focused LM Studio execution test path that logs transport status, provider error payloads, and model-load state when `benchmark_model` task execution fails.
2. Add OpenRouter free-model health checks so repeatedly failing free models are temporarily excluded from routing.
3. Add benchmark seeding checks for Ollama local models (`qwen2.5-coder:3b`, `qwen2.5-coder:7b`, `qwen3:4b`) to reduce first-run routing bias.
4. Add explicit local-model unload behavior before cross-provider local handoff (Ollama ↔ LM Studio) to prevent stale VRAM/RAM usage.

---

## Development Workflow

When developing a new feature, use this loop:

```
1.  Edit src/...
2.  npm run build
3.  node test-operational.mjs --suite smoke        # fast sanity check
4.  node test-operational.mjs --suite routing      # decision engine check
5.  node test-operational.mjs --suite llm          # full end-to-end (only when needed)
6.  npm test                                        # unit tests
7.  Update PLAN.md section status if criteria met
```

The smoke suite should run in under 10 seconds. Run it after every build.

### Lock file issues

If a previous test run didn't clean up:

```bash
rm -f locallama.lock
```

The `.env` sets `REMOVE_STALE_LOCK_FILES=true` which auto-removes stale locks on
startup.

### Viewing server logs

Logs go to `./locallama-test.log` (set in `.env`). To tail while testing:

```bash
tail -f locallama-test.log
```

---

## Ollama Configuration Notes

The Ollama API base URL in LocalLama is configured via `OLLAMA_ENDPOINT`.

**Critical:** The Ollama provider in this project may append `/api` to the endpoint
or may expect the base URL without `/api`. Check
`src/modules/ollama/` for the actual path construction. If models aren't discovered,
try toggling between:

```
OLLAMA_ENDPOINT=http://localhost:11434
OLLAMA_ENDPOINT=http://localhost:11434/api
```

The Ollama REST API serves:
- `GET  /api/tags`       — list models
- `POST /api/generate`   — text generation
- `POST /api/chat`       — chat completion (OpenAI-compatible)

Models available on this system:
- `gemma3n:e2b`    — 5.6 GB  ← **use for fast iteration**
- `gemma3n:latest` — 7.5 GB
- `gpt-oss:20b`    — 13 GB   ← only when accuracy matters

---

## Testing Gaps and Coverage Debt (added 2026-05-19)

The following operational test scenarios are not covered by any existing suite. Add them to the appropriate suite when the underlying feature or fix is ready.

### Gap 1 — Timeout boundary tests (Issue 18 / Bug 6 / Bug 7)

No test verifies what happens at the MCP tool-call timeout boundary. Currently, the suite relies on tool calls completing within the MCP client's default timeout. A dedicated timeout-boundary suite is needed:

- Invoke `route_task` against a model that is known to be too large for available hardware and assert that the response is a structured error (not a hang or a connection reset).
- Verify that `ERR_CANCELED` from Ollama maps to a user-readable error message, not `"Error executing task: unknown"`.
- Assert that `OLLAMA_TIMEOUT` is respected: a task that would take longer than the configured timeout returns a timeout error within `OLLAMA_TIMEOUT + 5s`.

**Blocker:** Requires a controllable slow-model fixture. On System A, `gemma4:26b` can serve this role for slow-inference tests, but it must be used in isolation (not in the standard suite) to avoid slowing every CI run.

---

### Gap 2 — Provider health failure injection (Issue 24 / Issue 26)

No test verifies server behavior when a provider becomes unavailable after startup:

- Start the server with Ollama running, then stop Ollama, then call `route_task`. Assert that the response either falls back gracefully to another provider or returns a clear "no local provider available" error — not a hang or a crash.
- Start the server with Ollama unavailable. Assert that `preemptive_route_task` does not claim local models are available.
- Verify that the periodic health probe (Issue 26, when implemented) updates provider availability state and that subsequent `preemptive_route_task` calls reflect the updated state.

**Blocker:** Issue 26 (periodic health probe) must be implemented before the last bullet. The first two bullets can be added now.

---

### Gap 3 — Rate limiting and concurrent call behavior (Issue 19)

No test verifies server behavior under concurrent tool calls:

- Send 3–5 simultaneous `preemptive_route_task` calls and assert that all return well-formed responses (not partial responses or crashes from shared mutable state in the routing engine).
- Send 2 simultaneous `route_task` calls that both select the same Ollama model. Assert that both eventually complete or one gracefully queues/fails with a clear error, and that neither leaves the server in a broken state.

**Blocker:** Issue 19 (rate limiting/backpressure) must be designed before a concurrency test can assert correct behavior. Currently, the expected behavior is undefined.

---

### Gap 4 — Benchmark DB integrity after restart (Issue 21)

No test verifies that benchmark results written in one server session are correctly read in the next:

- Run `benchmark_task` against a model. Stop the server. Restart the server. Call `preemptive_route_task` and assert that the newly started server's routing decision reflects the benchmark data from the previous session (i.e., the DB was read correctly at startup).
- Add a test that writes a row in the old benchmark schema (if schema is ever migrated) and verifies the migration runs without data loss.

**Blocker:** Issue 21 (schema migration framework) must be in place before the migration test. The restart/persistence test can be added now.

---

### Gap 5 — Windows path correctness (Issue 34 / Bug 4)

No test verifies path resolution on Windows. The Session Continuity Checklist uses `curl` and `python3`, which are not guaranteed on Windows. Additionally:

- Add a check that `rootDir` (from `src/config/index.ts`) resolves to the project root, not `C:\Program Files\nodejs` or any other host-process CWD.
- Replace the `curl` and `python3` commands in the Checklist below with PowerShell/Node equivalents that work on Windows natively.
- Add a smoke test assertion that `locallama.lock`, `ollama-models.json`, and `data/benchmarks.db` are created in the expected directory (project root or `LOCALLAMA_ROOT_DIR` if set), not in the host CWD.

**Blocker:** None. These can be added immediately.

---

### Gap 6 — Cross-provider failover (Issue 17)

Issue 17 (cross-provider local model lifecycle) has no test coverage:

- Simulate a task flow where the initial local decision is Ollama, but Ollama becomes unavailable at execution time. Assert that the server either retries with LM Studio or returns a clear error — not a crash.
- Assert that after a cross-provider switch, the previously loaded model in the prior provider is explicitly unloaded (when Issue 17's unload hook is implemented).
- Assert that VRAM/RAM usage does not accumulate across multiple provider switches (requires the memory monitoring from Issue 31 to be in place for a quantitative assertion).

**Blocker:** Issue 17 (unload hook) and Issue 31 (memory monitoring) must be implemented. Failover assertion can be added now (asserts error shape, not resource cleanup).

---

### Gap 7 — OpenRouter free-model health gating (Issue 16)

Issue 16 (free-model health gating) has no test coverage beyond the live observation that currently-failing models are re-selected:

- Mock an OpenRouter free model to return `invalid_request` on every call. Assert that after N failures (configurable threshold), the model is quarantined and no longer selected by `route_task`.
- Assert that after the quarantine window expires, the model becomes eligible again.
- Assert that a quarantined model appears in diagnostic output (tool response or log) so the developer knows why routing avoided it.

**Blocker:** Issue 16 must be implemented before these tests are meaningful.

---

### Gap 8 — Token overflow detection (Issue 25)

No test verifies that a prompt exceeding a model's context window is handled gracefully:

- Construct a task string that is provably longer than `contextWindow` for the selected model.
- Assert that the server returns a `context_overflow` error (or similar structured error) rather than dispatching and receiving a silent truncation.
- Assert that the error message includes the estimated token count and the model's declared context window, so the developer can act on it.

**Blocker:** Issues 20 (token counting) and 25 (context-window enforcement) must be implemented.

---

### Gap 9 — Config change detection (Issue 28)

No test verifies that config changes are (or are not) picked up at runtime:

- Change `models.json` to add a new model entry. Assert that the model does NOT appear in `locallama://models` without a restart (documenting current behavior: restart required).
- Once Issue 28's `reload_config` tool is implemented: trigger `reload_config`, then assert the new model appears without a restart.

**Blocker:** Issue 28 must be implemented for the second assertion.

---

### Gap 10 — Multi-instance lock contention (Issue 32)

No test verifies server behavior when two instances attempt to start against the same data directory:

- Start one server instance. Attempt to start a second instance pointing at the same root directory. Assert that the second instance either exits with a clear "lock file held" error or (if `REMOVE_STALE_LOCK_FILES=true`) detects the other instance is live and refuses to steal the lock.
- Assert that `LOCALLAMA_DATA_DIR` correctly redirects all file-based state, allowing two instances with different data dirs to run simultaneously without conflict.

**Blocker:** Issue 32 (`LOCALLAMA_DATA_DIR` env var) must be implemented for the second assertion. The first assertion can be added now.

---

## Interactive Webapp Test Client — Planning Reference

See the **Interactive Testing Webapp — Planning Section** added to `PLAN.md` (2026-05-19) for the full requirements, architectural options, risks, and dependency chain.

**Key operational testing implications for the webapp:**

- The webapp's test client must be validated against the same test suites defined in this document (smoke, routing, LLM). The webapp is not a replacement for `test-operational.mjs` — it is an interactive companion.
- A `docs/webapp-smoke-checklist.md` manual test matrix must be created when the webapp reaches initial implementation. It should mirror the structure of Suite 1 (Smoke) and Suite 2 (Routing) above.
- Any tool invoked via the webapp must produce identical responses to the same tool invoked via `test-operational.mjs`. If they differ, the transport layer (bridge or SSETransport) has a bug.
- The webapp's log panel must be validated against the log output from `locallama-test.log` — spot-check that the same lines appear in both, in the same order.
- Benchmark results triggered via the webapp must be queryable via `test-operational.mjs` in the same session (verifying DB write-through, not webapp-local state).

---

## Session Continuity Checklist

If you are an AI agent picking this up in a new session, run these checks first:

> **Windows note (Issue 34):** The commands below use `curl` and `python3`, which may not be available on Windows without WSL. Use the PowerShell equivalents listed in parentheses where noted. See Gap 5 in the Testing Gaps section above for the tracking item.

```bash
# 1. Verify Ollama is running
# Unix:
curl -s http://localhost:11434/api/tags | python3 -c "import sys,json; [print(m['name']) for m in json.load(sys.stdin)['models']]"
# Windows PowerShell equivalent:
# (Invoke-RestMethod http://localhost:11434/api/tags).models | ForEach-Object { $_.name }

# 2. Verify the build is current
npm run build 2>&1 | tail -5
# Windows PowerShell: npm run build | Select-Object -Last 5

# 3. Quick smoke test
node test-operational.mjs --suite smoke --verbose

# 4. Check for lock file remnants
ls locallama.lock 2>/dev/null && echo "LOCK EXISTS — delete if no server running"
# Windows PowerShell: if (Test-Path locallama.lock) { Write-Host "LOCK EXISTS — delete if no server running" }
```

If smoke passes, continue from the "Known Issues" section above or extend the suite
for whichever tool is being developed.
