# Client Compatibility Matrix

This document tracks which MCP clients can successfully call the LocaLLama MCP tools and what response shape they receive.

## Tool surface summary

| Tool | Purpose | Returns |
|---|---|---|
| `route_task` | Queue a coding task using the best available model | `{ task_id, status, job_count, queue_position, poll_again_after_ms, provider, model }` |
| `get_task_status` | Poll a queued task and retrieve completed job results | `{ task_id, status, progress_pct, jobs: [...] }` |
| `cancel_task` | Cancel all queued/in-progress jobs for a task | `{ success, task_id, cancelled_count, status, message }` |
| `reload_config` | Reload `.env` at runtime (hot-reloadable fields only) | `{ success, envPath, appliedFields, restartRequiredFields, activeConfig }` |
| `preemptive_route_task` | Model-selection pre-check without executing | `{ costClass, providerId, modelId, reason }` |
| `get_cost_estimate` | Token-level cost estimate | `{ localCost, paidCost, ... }` |
| `cancel_job` | Cancel a background job | `{ success, status, message, jobId }` |
| `benchmark_model` | Run benchmark suites against a model | `{ modelId, categories, scores, ... }` |
| `benchmark_task` / `benchmark_tasks` | Ad-hoc task benchmarking | provider-specific result objects |
| `get_free_models` | List free OpenRouter models (requires API key) | array of model descriptors |
| `benchmark_free_models` | Benchmark free OpenRouter models | benchmark result array |
| `retriv_init` / `retriv_search` | Code search (native TypeScript BM25) | init status / search results |

All tool results are returned as MCP `content[0].text` (type `"text"`) containing JSON-serialized output.  Schema-aware clients can parse `content[0].text` as JSON; plain-text clients receive readable output.

## Response Shape

```jsonc
// route_task response (parsed from content[0].text)
{
  "task_id": "uuid",
  "status": "queued",
  "job_count": 1,
  "queue_position": 1,
  "poll_again_after_ms": 5000,
  "provider": "ollama",
  "model": "qwen2.5-coder:7b"
}

// get_task_status response
{
  "task_id": "uuid",
  "status": "completed",
  "job_count": 1,
  "completed_count": 1,
  "failed_count": 0,
  "progress_pct": 100,
  "poll_again_after_ms": 0,
  "jobs": [
    { "job_id": "uuid", "status": "completed", "result": "// generated code..." }
  ]
}

// preemptive_route_task response
{
  "costClass": "local",
  "providerId": "ollama",
  "modelId": "codellama:7b",
  "reason": "Preemptive routing selected codellama:7b (ollama). Call route_task to execute."
}

// reload_config response
{
  "success": true,
  "envPath": "<project>/.env",
  "appliedFields": [
    "defaultLocalModel",
    "tokenThreshold",
    "openRouterFreeOnly"
  ],
  "restartRequiredFields": [
    "server.port",
    "lmStudioEndpoint",
    "openRouterApiKey"
  ],
  "activeConfig": {
    "openRouterFreeOnly": true,
    "tokenThreshold": 1200,
    "providerTimeoutMs": 120000
  }
}
```

## Per-client behavioral hints

The server detects the connected client via the MCP initialize handshake (`clientInfo.name`) and adjusts default behavior:

| Client (`clientInfo.name`) | Max output tokens | Subtask granularity | Plain-text preference |
|---|---|---|---|
| `claude-code` | 8192 | fine | no |
| `codex-cli` | 4096 | coarse | no |
| `github-copilot-chat` | 2048 | coarse | yes |
| `cline` | 8192 | fine | no |
| `roo-code` | 8192 | fine | no |
| *(unknown)* | 4096 | coarse | no |

These hints are read by the routing layer and do not change tool schemas.  They are tunable via `src/modules/core/client/hints.ts`.

## Manual smoke test matrix

Run the following script against each client after connecting it to `dist/index.js`.  Check all boxes before marking Section 7 ✅.

### Test script

```
route_task:
  task: "Write a TypeScript function that returns the nth Fibonacci number using memoization."
  context_length: 50
  priority: "cost"
```

| Client | Connected | route_task called | JSON parseable | costClass present | providerId present |
|---|---|---|---|---|---|
| Claude Code | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ |
| Codex CLI | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ |
| GitHub Copilot Chat (VS Code) | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ |
| Cline | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ |
| Roo Code | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ |

### How to configure a client

Point the client's MCP config at `node /path/to/locallama-mcp/dist/index.js` over stdio.

Example for Claude Code (`~/.claude/claude_desktop_config.json`):
```json
{
  "mcpServers": {
    "locallama": {
      "command": "node",
      "args": ["/path/to/locallama-mcp/dist/index.js"]
    }
  }
}
```

Example for VS Code (`.vscode/mcp.json`):
```json
{
  "inputs": [],
  "servers": {
    "locallama": {
      "type": "stdio",
      "command": "node",
      "args": ["${workspaceFolder}/../locallama-mcp/dist/index.js"]
    }
  }
}
```
