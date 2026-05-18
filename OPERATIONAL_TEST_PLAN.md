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
| 2026-05-16 | all | 24 | 0 | 5 | Skips: 5 optional tools absent (no OpenRouter key, no Python/retriv) |

**Full suite command used:**
```bash
node test-operational.mjs --suite all
```

**Ollama model used for LLM inference:** `gpt-oss:20b` (router's choice given no small-model preference)

**Notable observations:**
- LM Studio is not running — connection-refused errors logged on startup (expected, non-fatal)
- Python venv at `.venv/bin/python` not found — retriv code-search init fails on startup (expected, non-fatal)
- `python` command not found (only `python3` available) — server uses `python` by default
- Router correctly chose `gpt-oss:20b` for the simple task via `preemptive_route_task`, then used it for `route_task`
- `route_task` produced valid JavaScript code from Ollama with correct `costClass: local`

---

## Known Issues & Investigation Queue

Track issues found during operational testing here. This is separate from PLAN.md
(which tracks implementation work) — these are *test findings*.

| # | Severity | Tool/Module | Symptom | Root cause | Status |
|---|---|---|---|---|---|
| 1 | P1 (fixed) | `ollama/index.ts` | Ollama models not discovered on fresh start | `lastUpdated` set to `now` when no tracking file found; `hoursSinceLastUpdate = 0 < 24` → `updateModels()` never called | **Fixed 2026-05-16**: init with `new Date(0)` to force first update |
| 2 | P1 (fixed) | `ollama/index.ts` | Wrong URL: `${endpoint}/api/tags` instead of `${endpoint}/tags` | Endpoint is expected to already include `/api`; double-appending `/api` caused 404 | **Fixed 2026-05-16**: changed to `${endpoint}/tags` and `${endpoint}/chat` |
| 3 | P1 (fixed) | `tool-definition/index.ts` | `v3Schema.safeParse is not a function` crash on server when `route_task` runs | `outputSchema` fields were plain JSON schema objects; MCP SDK calls `.safeParse()` on them expecting Zod schemas | **Fixed 2026-05-16**: removed `outputSchema` from `route_task` and `preemptive_route_task` |
| 4 | P2 (open) | `cost-monitor/api.ts` | Models resource shows "llama3" fallback even when Ollama responds | `getAvailableModels()` in cost-monitor uses `${endpoint}/tags` (correct), but Ollama tracking cache is not used — it re-queries directly | Investigate: is the fallback still triggered if Ollama responds? |
| 5 | P2 (open) | `preemptive_route_task` | Routes simple tasks to `gpt-oss:20b` (13GB) instead of `gemma3n:e2b` (5.6GB) | Model selection ignores model size / resource cost; `DEFAULT_LOCAL_MODEL` env var may not influence the router | Investigate: does `DEFAULT_LOCAL_MODEL=gemma3n:e2b` affect routing? |
| 6 | P3 (open) | `cost-monitor` | Startup log spam: Python venv not found (`ENOENT .venv/bin/python`) | Hard-coded `.venv` path; no fallback to `python3` | Investigate: add `python3` fallback; check `PYTHON_PATH` env var |

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
| `benchmark_task` | Makes LLM calls | Add to suite llm after basic routing passes |
| `benchmark_tasks` | Makes multiple LLM calls | After single benchmark passes |
| `benchmark_model` | Makes LLM calls | After benchmark_task passes |
| `benchmark_free_models` | Requires `OPENROUTER_API_KEY` | When OpenRouter key is available |
| `retriv_init` | Requires Python + retriv package | When Python env is set up |
| `retriv_search` | Requires retriv index | After retriv_init passes |
| `get_free_models` | Requires `OPENROUTER_API_KEY` | When OpenRouter key is available |
| `clear_openrouter_tracking` | Requires `OPENROUTER_API_KEY` | When OpenRouter key is available |
| `set_model_prompting_strategy` | Low risk; no LLM call | Add to routing suite next iteration |

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
