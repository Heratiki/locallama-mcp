# Client Compatibility Matrix

This document tracks which MCP clients can successfully call the LocaLLama MCP tools and what response shape they receive.

## Tool surface summary

| Tool | Purpose | Returns |
|---|---|---|
| `route_task` | Execute a coding task using the best available model | `{ costClass, providerId, modelId, content, reason, estimatedCost? }` |
| `preemptive_route_task` | Model-selection pre-check without executing | `{ costClass, providerId, modelId, reason }` |
| `get_cost_estimate` | Token-level cost estimate | `{ localCost, paidCost, ... }` |
| `cancel_job` | Cancel a background job | `{ success, status, message, jobId }` |
| `benchmark_model` | Run benchmark suites against a model | `{ modelId, categories, scores, ... }` |
| `benchmark_task` / `benchmark_tasks` | Ad-hoc task benchmarking | provider-specific result objects |
| `get_free_models` | List free OpenRouter models (requires API key) | array of model descriptors |
| `benchmark_free_models` | Benchmark free OpenRouter models | benchmark result array |
| `retriv_init` / `retriv_search` | Code search (native TypeScript BM25) | init status / search results |

All tool results are returned as MCP `content[0].text` (type `"text"`) containing JSON-serialized output.  Schema-aware clients can parse `content[0].text` as JSON; plain-text clients receive readable output.

## Response shape (route_task / preemptive_route_task)

```jsonc
// route_task response (parsed from content[0].text)
{
  "costClass": "local",          // "local" | "free" | "paid"
  "providerId": "lm-studio",     // normalised provider id
  "modelId": "qwen2.5-coder-7b", // model that ran the task
  "content": "// the generated code...",
  "reason": "Routed to local model because complexity 0.3 is below threshold.",
  "estimatedCost": 0             // USD; 0 for local/free
}

// preemptive_route_task response
{
  "costClass": "local",
  "providerId": "ollama",
  "modelId": "codellama:7b",
  "reason": "Preemptive routing selected codellama:7b (ollama). Call route_task to execute."
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
