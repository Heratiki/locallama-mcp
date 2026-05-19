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
| OpenRouter API key | ✅ Intentionally absent | Forces Ollama-only routing |

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
| 12 | P2 (open) | `route_task` / `codeTaskCoordinator` | High-complexity full `route_task` does not preserve the paid routing decision | Initial decision engine selected paid `gpt-4o`, but full execution delegates to `codeTaskCoordinator`, which reselects per-subtask models independently. Observed OpenRouter attempt to `openrouter/pareto-code` failed, then final result came from local `qwen2.5-coder:7b`. | **Open 2026-05-19**: no credits consumed. Next step is code-path investigation, not repeated paid runs. |
| 13 | P2 (fixed) | `cost-monitor/api.ts` | OpenRouter credit usage check hits stale `/api/v1/auth/credits` endpoint and receives 404 HTML | OpenRouter now exposes credits at `/api/v1/credits` with `{ data: { total_credits, total_usage } }` | **Fixed 2026-05-19**: updated endpoint/response parsing and added unit coverage. |

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

## Session Continuity Checklist

If you are an AI agent picking this up in a new session, run these checks first:

```bash
# 1. Verify Ollama is running
curl -s http://localhost:11434/api/tags | python3 -c "import sys,json; [print(m['name']) for m in json.load(sys.stdin)['models']]"

# 2. Verify the build is current
npm run build 2>&1 | tail -5

# 3. Quick smoke test
node test-operational.mjs --suite smoke --verbose

# 4. Check for lock file remnants
ls locallama.lock 2>/dev/null && echo "LOCK EXISTS — delete if no server running"
```

If smoke passes, continue from the "Known Issues" section above or extend the suite
for whichever tool is being developed.
