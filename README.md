# LocalLama MCP Server

[![Status: experimental](https://img.shields.io/badge/status-experimental-orange.svg)](https://github.com/Heratiki/locallama-mcp/releases)
[![Latest release](https://img.shields.io/github/v/release/Heratiki/locallama-mcp)](https://github.com/Heratiki/locallama-mcp/releases)
![License: ISC](https://img.shields.io/badge/license-ISC-blue.svg)

Local-first, provider-neutral Model Context Protocol server for coding-agent workflows. Routes tasks across local models (Ollama, LM Studio, llama.cpp), free OpenRouter models, and paid frontier models using cost, latency, context capacity, and benchmark history.

**Node.js:** >=22

> ⚠️ **Early / experimental — not yet a stable release.** This project is under active, rapid development and has not been fully verified end-to-end. MCP tool signatures, configuration, and behavior may change between releases without notice.
>
> Version numbers follow [SemVer](https://semver.org/) mechanically (they're derived from [Conventional Commit](https://www.conventionalcommits.org/) messages, not hand-picked), so a `1.x` number signals only *"a public surface exists"* — it is **not** a promise of stability or completeness. If you depend on this server, pin to an exact version.
>
> - **Tagged releases on `main`** are the relatively safer builds.
> - **The `testing` channel** publishes bleeding-edge pre-releases (`x.y.z-testing.n`) for trying unproven changes early.

## Overview

LocalLama MCP reduces token costs without sacrificing quality. Tasks are queued asynchronously — `route_task` returns a `task_id` immediately; callers poll `get_task_status` for results. The decision engine chooses local → free → paid based on measured provider capabilities and configurable thresholds.

Supported MCP clients: Codex, Claude Code, Claw Code, Cursor, GitHub Copilot Agent mode, and any generic MCP stdio client.

## Requirements

- Node.js 22+
- npm
- At least one of: Ollama, LM Studio, llama.cpp server, or an OpenRouter API key

## Installation

```bash
git clone https://github.com/Heratiki/locallama-mcp.git
cd locallama-mcp
npm install
npm run build
```

## Configuration

Copy `.env.example` to `.env` and edit with your values. The server resolves `.env` from its own root directory (or `LOCALLAMA_ROOT_DIR` when set), not from the MCP host's CWD.

```env
# Local LLM Endpoints
LM_STUDIO_ENDPOINT=http://localhost:1234/v1
OLLAMA_ENDPOINT=http://localhost:11434/api
# LLAMA_CPP_ENDPOINT=http://localhost:8080   # leave unset to disable

# Routing thresholds
DEFAULT_LOCAL_MODEL=qwen2.5-coder-3b-instruct
TOKEN_THRESHOLD=1500
COST_THRESHOLD=0.02
QUALITY_THRESHOLD=0.7

# Provider concurrency
PROVIDER_HEALTH_PROBE_INTERVAL_MS=60000
PROVIDER_MAX_CONCURRENT_LOCAL=1
PROVIDER_MAX_CONCURRENT_REMOTE=5
PROVIDER_TIMEOUT_MS=120000
OLLAMA_TIMEOUT=120

# Code search (native BM25, no Python required)
CODE_SEARCH_ENABLED=true
CODE_SEARCH_EXCLUDE_PATTERNS=["node_modules/**","dist/**",".git/**"]
CODE_SEARCH_INDEX_ON_START=true
CODE_SEARCH_REINDEX_INTERVAL=3600

# Benchmarks
BENCHMARK_RUNS_PER_TASK=3
BENCHMARK_PARALLEL=false
BENCHMARK_MAX_PARALLEL_TASKS=2
BENCHMARK_TASK_TIMEOUT=60000
BENCHMARK_SAVE_RESULTS=true
BENCHMARK_RESULTS_PATH=./benchmark-results

# Lock file
LOCK_FILE_CHECK_ACTIVE_PROCESS=true
REMOVE_STALE_LOCK_FILES=true

# OpenRouter (optional)
OPENROUTER_API_KEY=your_openrouter_api_key_here
OPENROUTER_FREE_ONLY=false

# Logging
LOG_LEVEL=debug

# Operational testing
# EXPECT_LOCAL_PROVIDER_DOWN=true
```

### Key environment variables

| Variable | Default | Description |
|---|---|---|
| `LM_STUDIO_ENDPOINT` | — | LM Studio API base URL |
| `OLLAMA_ENDPOINT` | — | Ollama API base URL |
| `LLAMA_CPP_ENDPOINT` | — | llama-server URL; leave unset to disable provider |
| `DEFAULT_LOCAL_MODEL` | — | Model name used when offloading to local provider |
| `TOKEN_THRESHOLD` | `1500` | Token count above which local offload is considered |
| `COST_THRESHOLD` | `0.02` | USD cost above which local offload is preferred |
| `QUALITY_THRESHOLD` | `0.7` | Quality score below which paid API is always used |
| `PROVIDER_MAX_CONCURRENT_LOCAL` | `1` | Shared local execution slot count |
| `PROVIDER_MAX_CONCURRENT_REMOTE` | `5` | Per-remote-provider slot count |
| `OPENROUTER_API_KEY` | — | Enables OpenRouter provider and related tools |
| `OPENROUTER_FREE_ONLY` | `false` | Restrict OpenRouter to free-tier models only |
| `EXPECT_LOCAL_PROVIDER_DOWN` | — | Set `true` in `test-operational.mjs` to assert no local suggestion |

## MCP Client Configuration

Build the server, then point your MCP client at `node dist/index.js`:

```json
{
  "mcpServers": {
    "locallama": {
      "command": "node",
      "args": ["/path/to/locallama-mcp/dist/index.js"],
      "env": {
        "LM_STUDIO_ENDPOINT": "http://localhost:1234/v1",
        "OLLAMA_ENDPOINT": "http://localhost:11434/api",
        "DEFAULT_LOCAL_MODEL": "qwen2.5-coder-3b-instruct",
        "TOKEN_THRESHOLD": "1500",
        "COST_THRESHOLD": "0.02",
        "QUALITY_THRESHOLD": "0.07",
        "OPENROUTER_API_KEY": "your_openrouter_api_key_here"
      }
    }
  }
}
```

Claude Code users can place this in `.mcp.json` (project-scoped) or `~/.claude/settings.json` (global).

## Tools

### Core tools (always available)

| Tool | Inputs | Description |
|---|---|---|
| `route_task` | `task`, `context_length`, `expected_output_length?`, `complexity?`, `priority?`, `preemptive?` | Queue a task asynchronously. Returns `task_id` immediately. Poll `get_task_status` for results. |
| `get_task_status` | `task_id` | Poll a non-blocking `route_task` submission. Returns status, progress, and inline result when complete. |
| `cancel_task` | `task_id` | Cancel all queued or in-progress jobs for a task. |
| `cancel_job` | `job_id` | Cancel a single background job. |
| `preemptive_route_task` | `task`, `context_length`, `expected_output_length?`, `complexity?`, `priority?` | Heuristic routing check with no LLM calls. Returns model/provider recommendation without executing the task. |
| `get_cost_estimate` | `context_length`, `expected_output_length?`, `model?` | Estimate USD cost before calling `route_task`. Local and free-tier models return 0. |
| `benchmark_task` | `task_id`, `task`, `context_length`, `expected_output_length?`, `complexity?`, `local_model?`, `paid_model?`, `runs_per_task?` | Benchmark one task across local vs paid models. |
| `benchmark_tasks` | `tasks[]`, `runs_per_task?`, `parallel?`, `max_parallel_tasks?` | Benchmark multiple tasks in one call. |
| `benchmark_model` | `model_id`, `provider_id?`, `task_categories?` | Run built-in benchmark suites against a specific model. Persists results to `benchmarks.db` and updates ModelRegistry capability scores. |
| `retriv_init` | `directories[]`, `exclude_patterns?`, `chunk_size?`, `force_reindex?`, `bm25_options?` | Index code with the native BM25 engine (no Python required). |
| `retriv_search` | `query`, `limit?` | Search indexed code using native BM25. |
| `reload_config` | — | Reload `.env` at runtime. Atomic: invalid config is rejected. |
| `check_for_updates` | — | Check whether the server is up to date with the latest GitHub commit. |
| `update_server` | — | Pull latest changes from GitHub, run `npm install` and `npm run build`. Restart the server manually after. |

### OpenRouter tools (require `OPENROUTER_API_KEY`)

| Tool | Inputs | Description |
|---|---|---|
| `get_free_models` | — | List free models available from OpenRouter. |
| `clear_openrouter_tracking` | — | Clear cached model list and force a fresh fetch. |
| `benchmark_free_models` | `tasks[]`, `runs_per_task?`, `parallel?`, `max_parallel_tasks?` | Benchmark free OpenRouter models. Results written to `benchmarks.db`. |
| `set_model_prompting_strategy` | `model_id`, `system_prompt`, `user_prompt`, `use_chat`, `assistant_prompt?`, `success_rate?`, `quality_score?` | Set a custom prompting strategy for an OpenRouter model. |

### Async task flow

```
route_task → { task_id }
                ↓ poll
get_task_status → { status: "pending" | "in_progress" | "completed" | "failed", result? }
```

When local providers are contended by benchmark workloads, `route_task` surfaces contention metadata:

```json
{
  "task_id": "...",
  "status": "queued",
  "queue_position": 2,
  "benchmark_contention": {
    "local_slot_contended": true,
    "active_benchmark_runs": 1,
    "queued_benchmark_runs": 2,
    "message": "Local execution slot currently contended by benchmark workloads."
  }
}
```

## Resources

### Static resources

| URI | Description |
|---|---|
| `locallama://status` | Server status |
| `locallama://models` | Available local models |
| `locallama://jobs/active` | Currently active jobs |
| `locallama://memory-bank` | Memory bank file list (if directory exists) |
| `locallama://openrouter/models` | All OpenRouter models (requires API key) |
| `locallama://openrouter/free-models` | Free OpenRouter models (requires API key) |
| `locallama://openrouter/status` | OpenRouter integration status (requires API key) |

### Resource templates

| URI template | Description |
|---|---|
| `locallama://usage/{api}` | Token usage and costs for a specific API (e.g. `openrouter`) |
| `locallama://jobs/progress/{jobId}` | Progress for a specific job |
| `locallama://openrouter/model/{modelId}` | Details for an OpenRouter model (requires API key) |
| `locallama://openrouter/prompting-strategy/{modelId}` | Prompting strategy for an OpenRouter model (requires API key) |

## Usage

### Starting the server

```bash
npm start
```

A lock file prevents multiple instances. Stale locks from crashed processes are detected and cleaned up automatically.

### Running benchmarks

```bash
npm run benchmark
npm run benchmark:comprehensive
```

Results are stored in `benchmark-results/` as JSON and Markdown summaries.

### Dashboard

When the server is running, a web dashboard is available at `http://localhost:3001` (server-local).

Features:
- Real-time job queue with status, provider/model, and queue position
- Task monitoring with per-job details and ETA
- Manual `route_task` submission form
- Task and job cancellation
- Benchmark history

REST API endpoints:

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/queue` | Queue summary and jobs. Filters: `status`, `provider`, `model`, `task_id`, `q`, `page`, `page_size` |
| `GET` | `/api/tasks` | Recent tasks. Filters: `status`, `provider`, `model`, `q`, `page`, `page_size` |
| `GET` | `/api/tasks/:taskId` | Detailed task status |
| `POST` | `/api/tasks` | Submit a task (`route_task`) |
| `POST` | `/api/tasks/:taskId/cancel` | Cancel a task |
| `POST` | `/api/jobs/:jobId/cancel` | Cancel a job |

Example submission:

```bash
curl -X POST http://localhost:3001/api/tasks \
  -H "Content-Type: application/json" \
  -d '{"task": "Refactor parser for readability", "context_length": 4096, "complexity": 0.6, "priority": "quality"}'
```

### Live monitoring metadata

When the JobTracker WebSocket server is running, task-executing tools include:

```json
{
  "task_id": "task-123",
  "monitoring": {
    "websocketUrl": "ws://127.0.0.1:8081",
    "activeJobsUri": "locallama://jobs/active",
    "jobProgressUriTemplate": "locallama://jobs/progress/{jobId}",
    "note": "Connect to websocketUrl for live updates, or use MCP resources."
  }
}
```

`websocketUrl` is `scope: server-local` — in SSH/container/Codespaces/WSL setups, forward the port before connecting.

### `_server_reminder` ambient metadata

Tools attach a `_server_reminder` field at most once every 30 minutes to surface monitoring info:

```json
{
  "_server_reminder": {
    "schemaVersion": 1,
    "kind": "monitoring-reminder",
    "status": "reachable",
    "scope": "server-local",
    "message": "Optional monitoring available from MCP server host.",
    "monitoringUrl": "http://127.0.0.1:3001",
    "lastCheckedAt": 1747699200000
  }
}
```

### Remote access

If your MCP client is not on the same machine as the server:

```bash
# SSH
ssh -L 8081:127.0.0.1:8081 -L 3001:127.0.0.1:3001 user@host
```

- Dev Containers / Codespaces: forward ports 8081 (WebSocket) and 3001 (dashboard) via the VS Code Ports view.
- WSL client + WSL server: use the WebSocket URL directly. Windows client + WSL server: forward port 8081 via VS Code or a local tunnel.

## Provider integrations

### Ollama

Set `OLLAMA_ENDPOINT` in `.env`. The server probes for available models on startup.

### LM Studio

Set `LM_STUDIO_ENDPOINT` in `.env`. Exposes an OpenAI-compatible API.

### llama.cpp (`llama-server`)

```bash
# Single model
llama-server -m /path/to/model.gguf --port 8080

# Router mode (multiple models)
llama-server --model /path/model1.gguf --model /path/model2.gguf --port 8080
```

Set `LLAMA_CPP_ENDPOINT=http://localhost:8080` in `.env`. If the endpoint is unset or unreachable, the provider initialises silently — other providers are unaffected. The server does not manage the `llama-server` process lifecycle.

### OpenRouter

Set `OPENROUTER_API_KEY`. The server fetches ~240 available models on startup (30+ free). Use `clear_openrouter_tracking` to force a refresh. Set `OPENROUTER_FREE_ONLY=true` to restrict to free-tier models.

## Code search

Code search uses a native TypeScript BM25 engine — no Python or external dependencies required.

```
# Via MCP tool
retriv_init { "directories": ["/path/to/repo"], "force_reindex": true }
retriv_search { "query": "pagination logic" }
```

## Development

```bash
npm run build        # compile TypeScript + copy assets
npm start            # run compiled server
npm run dev          # TypeScript watch mode
npm test             # build + run Jest (23 suites, 186 tests)
npm run lint         # ESLint (note: eslint-plugin-import not installed — lint currently fails)
npm run lint:fix     # ESLint with auto-fix
```

All test files mock server state to prevent multiple real instances during test runs.

## Architecture

```
src/
  index.ts                        entry point, lock file, MCP lifecycle
  modules/
    api-integration/              tool definitions, resources, routing adapters
    decision-engine/              task analysis, model selection, coordination
    cost-monitor/                 token accounting, cost estimation
    benchmark/                    execution, scoring, summaries, DB storage
    lm-studio/                    LM Studio provider
    ollama/                       Ollama provider
    llama-cpp/                    llama-server provider
    openrouter/                   OpenRouter provider
    core/provider/                shared provider registry and execution queue
    updater/                      self-update logic (check_for_updates, update_server)
    job-store/                    persistent Task/Job store
    websocket-server/             live monitoring side channel
```

Decision engine uses two model data stores:
- `ModelRegistry` + `CapabilityDetector`: benchmark-derived capability scores (authoritative for full routing)
- `modelsDbService`: heuristic performance data seeded from ModelRegistry at startup; used by `preemptiveRouting()`

## Project docs

| File | Purpose |
|---|---|
| `docs/AGENTS.md` | Shared operating guide for all coding agents |
| `docs/PROJECT_STATE.md` | Current snapshot of completed and in-progress work |
| `docs/ROADMAP.md` | Long-form modernization backdrop |
| `docs/ROADMAP_ACTIVE.md` | Active roadmap tasks |
| `docs/PLAN.md` | Branch implementation plan |
| `docs/OPERATIONAL_TEST_PLAN.md` | Live test record and verified behavior |
| `docs/LIVE_TESTING.md` | Real-world MCP test results and known open bugs |
| `docs/audits/ARCHITECTURAL_TRUTHS.md` | Core design principles and constraints |
| `docs/history/memory-bank/` | Historical append-only project memory |

## Troubleshooting

**Server won't start — lock file detected**

1. Check if another instance is running (`ps aux | grep locallama`).
2. Stale locks from crashes are cleaned up automatically (`REMOVE_STALE_LOCK_FILES=true`).
3. If needed, manually remove `locallama.lock` from the project root.

**OpenRouter models not appearing**

Use `clear_openrouter_tracking` through the MCP interface to force a fresh fetch.

**`npm run lint` fails**

`eslint-plugin-import` is referenced in the config but not installed. Known issue. Build and tests are unaffected.

## Security notes

- API keys belong in `.env`, which is excluded from version control.
- All log output goes to `stderr`; `stdout` is reserved for MCP JSON-RPC. Never write non-JSON to stdout.
- Treat MCP tools as model-controlled surfaces. Avoid mutations without user approval.

## License

ISC
