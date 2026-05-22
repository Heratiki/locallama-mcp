# LocalLama MCP — Live Real-World Testing Log

> **Purpose:** Append-only record of live end-to-end MCP testing performed by humans and agents against a running server. Distinct from `docs/OPERATIONAL_TEST_PLAN.md` (which tracks the structured test suite) and `test/` (unit tests with mocks).
>
> **Rule:** Add dated entries. Do not rewrite prior results. If a bug is fixed, add a new entry confirming the fix — do not delete the original finding.
>
> **Any agent or human can add to this document.** See [Setup](#setup--server-launch) below for platform-agnostic instructions.

---

## Table of Contents

- [Current Project State](#current-project-state-vs-intended-use)
- [Setup & Server Launch](#setup--server-launch)
- [MCP Client Configuration by Platform](#mcp-client-configuration-by-platform)
- [How to Add a Test Entry](#how-to-add-a-test-entry)
- [Open Issues from Live Testing](#open-issues-from-live-testing)
- [Tests Not Yet Performed](#tests-not-yet-performed)
- [Test Log](#test-log)

---

## Current Project State vs Intended Use

*Last updated: 2026-05-21*

### Intended Use

Provider-neutral MCP server for coding-agent workflows. Routes coding tasks across:
- Local models (Ollama, LM Studio, llama.cpp)
- Free remote models (OpenRouter free tier)
- Paid frontier models (OpenRouter paid)

Selection driven by measured cost, latency, quality, context capacity, and task fit. Exposes async task queue with persistent SQLite job store, benchmark tooling, and a web dashboard.

### Actual State (2026-05-21)

| Capability | Intended | Actual |
|---|---|---|
| Async `route_task` with `task_id` | ✅ Designed | ✅ Works — returns immediately |
| `get_task_status` polling | ✅ Designed | ⚠️ Stale: reports `in_progress` after job completes in SQLite (P1 — [#83](https://github.com/Heratiki/locallama-mcp/issues/83)) |
| Single-slot local FIFO queue | ✅ Designed (Issue #30) | ❌ Broken — concurrent calls all dispatch simultaneously (P1 — [#86](https://github.com/Heratiki/locallama-mcp/issues/86)) |
| `cancel_task` | ✅ Designed | ✅ Works correctly for all 3 states (in_progress/completed/not_found) |
| Capability-filtered routing | ✅ Designed (Issues #28, #49, #50) | ⚠️ Only fires when `task_categories` passed — omitting = heuristic-only |
| Background benchmark visibility | ✅ Needed | ❌ No MCP surface — callers blind to benchmark VRAM/slot contention ([#84](https://github.com/Heratiki/locallama-mcp/issues/84), [#85](https://github.com/Heratiki/locallama-mcp/issues/85)) |
| System state monitoring | ✅ Needed | ❌ WebSocket is server-local only; no `get_system_state` tool ([#85](https://github.com/Heratiki/locallama-mcp/issues/85)) |
| llama.cpp provider | ✅ Just shipped (Issue #64) | ⚠️ Untested — 3 unresolved design questions, no operational test history |
| `serverReminder` metadata | ✅ Just shipped (Issues #66–#74) | ⚠️ Wraps ALL responses; raw content parsers may break |
| OpenRouter free-model quarantine | ✅ Designed (Issue #16) | ⚠️ Implemented, zero live validation |
| Code quality of generated output | Quality goal | ❌ Multiple compile errors observed in TS and Go output |

**Summary:** Core async routing mechanics work. Two P1 bugs block reliable use as a production routing layer. Background benchmarking competes silently for the local execution slot, making VRAM pressure and paid-model escalation unpredictable.

---

## Setup & Server Launch

These instructions work on any platform. They do not assume Claude Code or any specific MCP client.

### Prerequisites

| Requirement | Minimum | Notes |
|---|---|---|
| Node.js | 20+ (22 recommended) | Must support ES modules (`"type": "module"`) |
| npm | 9+ | |
| At least one local provider | Ollama OR LM Studio OR llama-server | All optional; server starts without them |
| OpenRouter API key | Optional | Required for free/paid remote routing |

### 1. Clone and Build

```bash
git clone https://github.com/Heratiki/locallama-mcp.git
cd locallama-mcp
npm install
npm run build
```

`npm run build` compiles TypeScript to `dist/` and copies the lock-file helper. Must be re-run after any source change.

### 2. Configure Environment

Copy `.env.example` to `.env` (or create `.env` from scratch):

```bash
# Provider endpoints — all optional
OLLAMA_ENDPOINT=http://localhost:11434
LM_STUDIO_ENDPOINT=http://localhost:1234
LLAMA_CPP_ENDPOINT=http://127.0.0.1:8080

# OpenRouter
OPENROUTER_API_KEY=sk-or-...          # required for remote routing
OPENROUTER_FREE_ONLY=true             # set false to allow paid calls

# Routing behaviour
DEFAULT_LOCAL_MODEL=gemma3n:e2b       # fallback when no benchmark data
STARTUP_BENCHMARK_TARGETS=none        # 'none' skips auto-benchmark on start

# Logging
LOG_LEVEL=debug                       # error | warn | info | debug
# LOG_FILE=./locallama.log            # uncomment to write logs to a file

# Lock / data paths
REMOVE_STALE_LOCK_FILES=true
# LOCALLAMA_ROOT_DIR=./               # override root for lock + data files

# Concurrency
PROVIDER_MAX_CONCURRENT_LOCAL=1       # local slot cap (Issue #30 — currently broken, see #86)
PROVIDER_MAX_CONCURRENT_REMOTE=1      # per-remote-provider cap
```

> **Note:** Without `LOG_FILE`, all logs go to `stderr`. This is correct for MCP stdio transport — `stdout` is reserved for JSON-RPC. If you need to capture logs for debugging, add `LOG_FILE=./locallama-debug.log` to `.env`.

### 3. Verify Providers

```bash
# Ollama
curl http://localhost:11434/api/tags

# LM Studio (OpenAI-compatible)
curl http://localhost:1234/v1/models

# llama-server
curl http://127.0.0.1:8080/v1/models
```

### 4. Start the Server (stdio transport)

```bash
node dist/index.js
```

The server speaks MCP over stdio. It is not an HTTP server — your MCP client spawns it as a child process.

### 5. Verify Server is Running

The server writes a lock file on start:

```bash
# Default location
cat locallama.lock          # or: Get-Content locallama.lock (PowerShell)
```

If the lock file already exists and no server is running (stale lock from a crash), delete it:

```bash
rm locallama.lock           # or: Remove-Item locallama.lock (PowerShell)
```

Then restart. The `REMOVE_STALE_LOCK_FILES=true` env var handles this automatically on startup.

### 6. Quick Smoke Test (no MCP client needed)

```bash
node test-operational.mjs --suite smoke --verbose
```

Expected: all smoke assertions pass in under 10 seconds. If this fails, check provider connectivity and the lock file.

---

## MCP Client Configuration by Platform

The server entry point is always `node dist/index.js` with the project root as working directory.

### Claude Code (project-scoped)

`.claude/settings.json` in the repo root:

```json
{
  "mcpServers": {
    "locallama-dev": {
      "command": "node",
      "args": ["dist/index.js"],
      "cwd": "/absolute/path/to/locallama-mcp"
    }
  }
}
```

Verify with `/mcp` in Claude Code. If the server is missing, check for a stale lock file at the `cwd` path.

### Claude Desktop

`~/Library/Application Support/Claude/claude_desktop_config.json` (macOS) or `%APPDATA%\Claude\claude_desktop_config.json` (Windows):

```json
{
  "mcpServers": {
    "locallama-dev": {
      "command": "node",
      "args": ["/absolute/path/to/locallama-mcp/dist/index.js"]
    }
  }
}
```

### Cursor / Windsurf / Cline / Roo Code

These editors use a `mcp.json` or `mcp_config.json` typically at the project root or user config directory. The pattern is the same:

```json
{
  "servers": {
    "locallama-dev": {
      "command": "node",
      "args": ["dist/index.js"],
      "cwd": "/absolute/path/to/locallama-mcp"
    }
  }
}
```

Consult the editor's MCP documentation for the exact file location.

### Codex / OpenAI Agents (HTTP bridge)

Codex agents expect an HTTP MCP endpoint, not a stdio process. Options:

1. Use `@modelcontextprotocol/server-stdio-to-http` bridge to wrap the stdio server:
   ```bash
   npx @modelcontextprotocol/server-stdio-to-http --port 3100 -- node dist/index.js
   ```
   Then point Codex at `http://localhost:3100`.

2. Wait for the planned SSE/HTTP transport (tracked in Issue #58).

### Generic MCP Client (SDK)

```javascript
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const transport = new StdioClientTransport({
  command: "node",
  args: ["dist/index.js"],
  cwd: "/absolute/path/to/locallama-mcp",
});

const client = new Client({ name: "test-client", version: "1.0.0" });
await client.connect(transport);

// List tools
const { tools } = await client.listTools();
console.log(tools.map(t => t.name));
```

See `test-operational.mjs` in the repo root for a complete working example.

### Querying the SQLite DB for Ground Truth

When `get_task_status` reports stale state (see Issue #83), query the DB directly:

```bash
# Node.js (cross-platform, uses the project's sqlite3 dep)
node -e "
const sqlite3 = require('./node_modules/sqlite3');
const db = new sqlite3.Database('./data/jobs.db', sqlite3.OPEN_READONLY);
db.all('SELECT id, status, provider_id, model_id, progress_pct, started_at, completed_at FROM jobs ORDER BY created_at DESC LIMIT 10', (e,r) => { r.forEach(x=>console.log(JSON.stringify(x))); db.close(); });
"
```

If the server is installed separately (not run from source), replace `./node_modules/sqlite3` with the installed path and `./data/jobs.db` with `<install-dir>/data/jobs.db`.

---

## How to Add a Test Entry

1. Add a dated `###` section under [Test Log](#test-log).
2. Record: tool called, inputs used, routing decision observed, result quality (compile the output if possible), any DB findings.
3. If a new bug is found: file a GitHub Issue first, then reference the issue number here.
4. If a previously reported bug is confirmed fixed: add a `✅ Fixed` note to the original entry and the issue table.
5. Update [Tests Not Yet Performed](#tests-not-yet-performed) — remove entries you covered, add new gaps you discovered.
6. Update the [Current Project State](#current-project-state-vs-intended-use) table if the status of a capability changed.

---

## Open Issues from Live Testing

> Check this table before filing new issues to avoid duplicates.

| Issue | Title | Severity | Status |
|---|---|---|---|
| [#83](https://github.com/Heratiki/locallama-mcp/issues/83) | `get_task_status` returns stale `in_progress` after job completes in SQLite | P1 | Open |
| [#84](https://github.com/Heratiki/locallama-mcp/issues/84) | Background benchmarking monopolizes local provider VRAM/slot with no signal to callers | P2 | Open |
| [#85](https://github.com/Heratiki/locallama-mcp/issues/85) | No MCP-native system state surface — callers cannot monitor benchmarks, VRAM, or queue | P2 | Open |
| [#86](https://github.com/Heratiki/locallama-mcp/issues/86) | Local provider single-slot concurrency cap broken — concurrent submissions bypass FIFO | P1 | Open |
| [#87](https://github.com/Heratiki/locallama-mcp/issues/87) | `benchmark_model` provider mismatch when `provider_id` is specified | P1 | Open |
| [#88](https://github.com/Heratiki/locallama-mcp/issues/88) | Concurrent `route_task` returns `queue_position: 1` for multiple queued tasks | P1 | Open |

---

## Tests Not Yet Performed

Priority order for next session. Remove entries as they are covered; add new gaps discovered during testing.

| Tool / Scenario | Why important | Priority |
|---|---|---|
| `preemptive_route_task` with low-scored model | Verify Issues #49/#50 fix actually excludes benchmarked-bad models | High |
| OpenRouter free-model quarantine | Issue #16 implemented, live validation still blocked when OpenRouter free models are unavailable in test context | High |
| Concurrent `route_task` after #86 fix | Verify FIFO serialization works post-fix | High |
| `cancel_job` (individual job ID, not task) | Backwards-compat path per Issue #32 AC; untested | Medium |
| `reload_config` | Added to smoke suite 2026-05-20; verify post-Issue #57 `.env` path fix | Medium |
| `retriv_init` / `retriv_search` | Covered in smoke suite; not tested against real codebase content at scale | Low |
| `check_for_updates` | Updater module — no operational test record | Low |
| llama.cpp provider | Requires `llama-server` running; 3 unresolved design questions at Issue #64 close | Blocked |
| `get_system_state` | Does not exist yet — proposed in Issue #85 | N/A |

---

## Test Log

---

### 2026-05-21 — Claude Sonnet 4.6 via Claude Code MCP integration

**Tester:** Claude Sonnet 4.6 (automated, no happy path)  
**Server version:** main branch, commit `afef6fd` (v1.16.0)  
**Environment:**
- Windows 11 Pro
- Server installed at `C:\Users\herat\locallama-dev\` (separate from source)
- Ollama: `gemma3n:e2b`, `gemma3n:latest`, `gpt-oss:20b`
- LM Studio: `google/gemma-4-e4b`, `gemma3-4b-64k:latest`, `qwen/qwen3.5-9b`
- llama-server: NOT running
- OpenRouter API key: present
- No `LOG_FILE` configured — logs to stderr only

---

#### Test 1 — `route_task`, no `task_categories`, `priority: quality`

**Inputs:**
```json
{
  "task": "Write a TypeScript LRU cache with TTL, mutex, JSDoc, Vitest tests",
  "context_length": 120,
  "priority": "quality"
}
```

**Routing decision:** `openrouter / openai/gpt-4o-mini`

Bypassed local Ollama/LM Studio despite local models available. No `task_categories` supplied → no capability filtering → heuristic-only routing selected paid remote over local for `quality` priority.

**Async behavior:**
- `route_task` returned `task_id` immediately ✅
- 5 consecutive `get_task_status` polls: `in_progress, progress_pct: 1` ❌
- Direct SQLite query during same window: `status: completed, progress_pct: 100` ✅
- 6th poll: `completed` with inline result ✅
- **→ Bug filed: [#83](https://github.com/Heratiki/locallama-mcp/issues/83)**

**Result quality issues:**
- `class LRUCache<T>` declared twice → TypeScript compile error ❌
- Test calls `cache.set(key, value, ttl)` but implementation `set(key, value)` has no `ttl` param ❌
- "Final integration step performed by model similar to: N/A" — sub-task result copied verbatim, no actual integration ⚠️

**DB findings:**
- `queue_position` and `poll_again_after_ms` not nulled on completion (added to #83 AC) ⚠️
- Sub-task job row has `provider_id: null` despite executing on Ollama ⚠️

---

#### Test 2 — Concurrent `route_task` x3, `priority: cost`

**Inputs:** Three simultaneous MCP calls:
```
Task A: Python CSV parser   context_length: 60
Task B: JS debounce         context_length: 50
Task C: Go config reader    context_length: 70
```

**Routing decisions:** All 3 → `local / gemma3-4b-64k:latest` (LM Studio) ✅

**Queue behavior:**
- Queue positions returned: 1, 2, 3 ✅
- All 3 returned distinct `task_id`s immediately ✅ (no dedup bug)
- SQLite `started_at` timestamps: Task A T+0, Task B T+1.1s, Task C T+2.2s ❌
- Task A completed at T+19s — Task B should not have started until T+19s; it started at T+1.1s ❌
- 6 total concurrent local jobs (3 top-level + 3 sub-tasks) dispatched simultaneously ❌
- **→ Bug filed: [#86](https://github.com/Heratiki/locallama-mcp/issues/86)**
- **→ Observation filed: [#84](https://github.com/Heratiki/locallama-mcp/issues/84)** (VRAM contention with no signal)

**Staleness (#83) confirmed under concurrency:**
- Tasks A and B showed `in_progress` via `get_task_status` while SQLite showed `completed`

**Result quality (Go config reader):**
- `fmt.ReadFile()` does not exist → should be `os.ReadFile()` ❌
- `buffer := make([]byte, 0)` declared and unused → Go compile error ❌
- Required field validation not implemented despite task spec ❌

---

#### Test 3 — `cancel_task` state matrix

| State | Input | `success` | `status` | `cancelled_count` | Notes |
|---|---|---|---|---|---|
| `in_progress` | New red-black tree task | `true` | `cancelled` | 1 | Immediate, no staleness ✅ |
| `completed` | LRU cache task (Test 1) | `false` | `completed` | 0 | Correct no-op ✅ |
| `not_found` | `00000000-0000-0000-0000-000000000000` | `false` | `not_found` | 0 | Structured error ✅ |

**Notable positive:** Cancel updates in-memory Map synchronously — no staleness. This confirms #83's root cause: completion path is async, cancel path is not.

**DB gaps on cancel:**
- `queue_position` not nulled on cancel ⚠️
- `completed_at` reused for cancel timestamp — no dedicated `cancelled_at` field ⚠️
- `progress_pct` not zeroed on cancel ⚠️
- `error: null` — no cancel reason stored ⚠️

---

#### Observations Not Yet Filed as Issues

- `_server_reminder` present as a top-level key in raw JSON responses — raw content parsers that iterate response keys will encounter this unexpected field. All clients parsing `task_id` at root level need to handle unknown keys defensively.
- Background benchmarking may have been active during testing (elevated VRAM observed on host), which could explain `openrouter/gpt-4o-mini` selection despite local models available — local slot may have been occupied by benchmark. No MCP surface to confirm this. See [#84](https://github.com/Heratiki/locallama-mcp/issues/84) and [#85](https://github.com/Heratiki/locallama-mcp/issues/85).

---

### 2026-05-22 — GPT-5.3-Codex live MCP run (isolated root dir)

**Tester:** GPT-5.3-Codex via VS Code agent tools  
**Server version:** main branch build from workspace (`dist/index.js`)  
**Isolation target:** `LOCALLAMA_ROOT_DIR=C:\Users\herat\locallama-dev`

**Pre-flight server check (per isolation rule):**
- No active `node ... dist/index.js` process was running at test start.
- Existing `C:\Users\herat\locallama-dev\locallama.lock` appeared stale.
- `C:\Users\herat\locallama-dev` existed with isolated artifacts (`data/jobs.db`, model tracking JSON files).
- Provider listeners during session: Ollama (`11434`) and LM Studio (`1234`) reachable; llama.cpp (`8080`) not detected.

#### Test A — `preemptive_route_task` with vs without `task_categories`

**Inputs:** identical TypeScript utility task, `priority: quality`, `context_length: 180`, `expected_output_length: 280`; second call added `task_categories: ["typescript", "backend", "utilities"]`.

**Result:** both calls selected the same route: `costClass=paid`, `providerId=paid`, `modelId=baidu/cobuddy:free`.

**Interpretation:** capability filtering did not produce a different candidate in this live run (either equivalent capability match or category filter not materially influencing ranking for this task).

#### Test B — `get_cost_estimate`

**Input:** `model: gemma3-4b-64k:latest`, `context_length: 180`, `expected_output_length: 280`.

**Result:** tool returned valid local/paid/free cost structure and `recommendation: "paid"`.

#### Test C — `benchmark_model`

**Input:** `model_id: gemma3-4b-64k:latest`, `provider_id: lm_studio`, `category: medium`.

**Result:** benchmark completed successfully with nonzero quality/speed metrics, but response reported `providerId: "ollama"` for the same model id.

**Observation:** provider mismatch in benchmark response reproduced; issue filed: [#87](https://github.com/Heratiki/locallama-mcp/issues/87).

#### Test D — Concurrent `route_task` x3 (`priority: cost`) + DB ground truth

**Inputs:** three simultaneous small coding tasks (Python/JavaScript/Go helpers).

**Initial route responses:**
- All three returned `status: queued`, but each reported `queue_position: 1`.
- All three selected `openrouter / meta-llama/llama-3.3-70b-instruct:free`.

**Status polling vs DB:**
- Polling reached `completed` for 1 task.
- Polling timed out (no terminal completion state) for 2 tasks.
- SQLite rows for same task IDs showed:
  - 2 tasks `completed`
  - 1 task stuck `in_progress` (`progress_pct: 1`)
- All three rows had identical `started_at` timestamps, indicating simultaneous dispatch, not serialized queue start.

**Interpretation:**
- `get_task_status` staleness remains reproducible in live conditions (consistent with [#83](https://github.com/Heratiki/locallama-mcp/issues/83)).
- Queue position semantics appear inconsistent (`queue_position: 1` for all concurrent submissions); issue filed: [#88](https://github.com/Heratiki/locallama-mcp/issues/88).
- Concurrency controls still appear ineffective in this scenario (simultaneous starts).

#### Live run artifact

- Raw structured output captured at `temp/live-realworld-2026-05-21-output.json`.

---

### 2026-05-22 — GPT-5.3-Codex high-priority follow-up run (bounded)

**Tester:** GPT-5.3-Codex via VS Code agent tools  
**Goal:** cover next high-priority scenarios from "Tests Not Yet Performed" while avoiding long-running hangs.  
**Isolation roots:**
- `C:\Users\herat\locallama-dev\hp2-low-score-20260522`
- `C:\Users\herat\locallama-dev\hp2-contention-20260522`
- `C:\Users\herat\locallama-dev\hp2-quarantine-20260522`

#### Test E — `preemptive_route_task` low-score exclusion stress

**Method:** same coding task run twice with OpenRouter disabled, changing `CODE_SCORE_THRESHOLD` from `0.3` to `0.8`.

**Result:** both runs selected the same local model:
- `costClass=local`
- `modelId=qwen/qwen3.5-9b`

**Interpretation:** this run did not validate #49/#50 exclusion behavior. In this isolated root, local models had no benchmark summaries loaded, so capability score filtering did not materially change model selection.

#### Test F — `benchmark_task` / `benchmark_tasks` + concurrent `route_task`

**Method:** started `benchmark_task` and `benchmark_tasks` first, then submitted 3 `route_task` calls during benchmark activity.

**Observed benchmark behavior:**
- `benchmark_task` succeeded on local `gemma3-4b-64k:latest` with nonzero quality/time metrics.
- `benchmark_tasks` succeeded similarly for its batch task.

**Observed route behavior during benchmark activity:**
- All 3 `route_task` calls routed to `openrouter / meta-llama/llama-3.3-70b-instruct:free`.
- Initial queue positions were `1`, `2`, `3` (not the all-ones pattern from prior run).
- DB rows showed closely staggered starts (`~389ms` apart), all `in_progress` at snapshot time.

**Interpretation:**
- This run did **not** reproduce #88 (queue positions were distinct in this environment).
- It also did not conclusively prove/disprove #84 contention because route selection escaped to OpenRouter free models while local benchmarking was active.

#### Test G — OpenRouter free-model quarantine validation

**Method:** attempted live quarantine filter validation in isolated roots.

**Result:** blocked/inconclusive.
- In the quarantine root, `get_free_models` returned an empty set, so no model could be quarantined and re-checked for exclusion.
- Additional direct probe showed sessions where OpenRouter key was not configured in that runtime context, which also yields empty free-model results.

**Interpretation:** quarantine filter path still needs a dedicated run with stable OpenRouter free-model availability.

#### Issues created in this follow-up run

- None. No clearly new, non-duplicate defect was isolated beyond existing open issues.

#### Live run artifact

- Raw structured output captured at `temp/live-high-priority-quick-2026-05-22-output.json`.
