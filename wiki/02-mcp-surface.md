# 02 — MCP surface (tools & resources)

This is the contract the agent sees. Everything else in the codebase exists to serve these.

- **Tools** are model-invoked actions. Defined in
  `src/modules/api-integration/tool-definition/index.ts` (the `ToolDefinitionProvider`, exported
  at `:689`). Dispatch happens in the central handler at `src/index.ts:283`.
- **Resources** are read-only URIs the client can fetch. Registered in
  `src/modules/api-integration/resources.ts:48` (`setupResourceHandlers`).

> Treat tools as a **model-controlled surface**: avoid adding tools that mutate files, run
> commands, or spend money without a clear approval path (`docs/AGENTS.md` "Safety").

## Tools

Line numbers point at the `name:` declaration in `tool-definition/index.ts`.

### Routing & task lifecycle
| Tool | Line | Purpose |
|------|------|---------|
| `route_task` | 33 | Submit a Task. Routes local→free→paid, enqueues Job(s), returns `task_id` immediately (non-blocking). |
| `preemptive_route_task` | 203 | Cheap pre-flight: which provider/model *would* handle this, without enqueuing. Reads `modelsDb` heuristics. |
| `get_task_status` | 129 | Poll aggregate Task status + per-Job state. The completion path for `route_task`. |
| `cancel_task` | 144 | Cancel all remaining Jobs of a Task. |
| `cancel_job` | 115 | Cancel a single Job by ID. |
| `get_cost_estimate` | 240 | Estimate token cost for a prompt/model before committing. |

### System & config
| Tool | Line | Purpose |
|------|------|---------|
| `get_system_state` | 178 | Runtime health snapshot: `healthy`/`contended`/`degraded`, slot stats, provider availability. See [08](08-telemetry-monitoring.md). |
| `get_telemetry_summary` | 159 | Aggregated telemetry spans/metrics. |
| `reload_config` | 192 | Hot-reload the subset of config marked hot-reloadable (see [09](09-config-and-env.md)). |
| `check_for_updates` | 628 | Check if a newer server version is published. |
| `update_server` | 637 | Self-update the installed server. |

### Benchmarking & model data
| Tool | Line | Purpose |
|------|------|---------|
| `benchmark_task` | 265 | Benchmark one task across models. |
| `benchmark_tasks` | 307 | Benchmark a batch of tasks. |
| `benchmark_model` | 367 | Benchmark a single model; writes capability scores to `ModelRegistry`. |
| `benchmark_free_models` | 526 | Benchmark OpenRouter free-tier models through the modular engine → `benchmarks.db`. |
| `rate_model` | 646 | Record a quality rating for a model. |
| `set_model_prompting_strategy` | 586 | Pin a prompting strategy for a model. |

### Providers / OpenRouter
| Tool | Line | Purpose |
|------|------|---------|
| `get_free_models` | 460 | List currently available OpenRouter free models. |
| `clear_openrouter_tracking` | 495 | Reset local OpenRouter usage/rate-limit tracking. |

### Code search (retriv / BM25)
| Tool | Line | Purpose |
|------|------|---------|
| `retriv_init` | 79 / 401 | Initialize/index the code-search corpus. |
| `retriv_search` | 437 | BM25 search over the indexed corpus. See [07](07-cost-and-search.md). |

*(`retriv_init` appears twice — declaration + conditional re-registration; both point at the same handler.)*

## Resources

Registered in `resources.ts`. Static + templated URIs:

| URI | Line | Returns |
|-----|------|---------|
| `locallama://status` | 64 | Server status. |
| `locallama://models` | 70 | Available models across providers. |
| `locallama://jobs/active` | 76 | Currently active Jobs. |
| `locallama://memory-bank` | 87 | Files from the root `memory-bank/` dir (live read at `resources.ts:83`). |
| `locallama://openrouter/models` | 97 | OpenRouter models (when configured). |
| `locallama://openrouter/free-models` | 103 | OpenRouter free models. |
| `locallama://openrouter/status` | 109 | OpenRouter integration status. |
| `locallama://usage` (API Usage Statistics) | 126 | Usage stats. |
| `locallama://jobs/{id}` (Job Progress) | 132 | Per-Job progress (templated). |
| `locallama://openrouter/models/{id}` | 143 | Per-model details (templated). |
| `locallama://openrouter/prompting/{id}` | 149 | Per-model prompting strategy (templated). |

> ⚠️ The `locallama://memory-bank` resource reads the **root `memory-bank/` directory** at
> runtime (`resources.ts:83`). That directory is intentionally **not** archived for this reason —
> see [11-doc-map](11-doc-map.md).

## See also
- How `route_task` flows through the system → [01-architecture](01-architecture.md)
- Client-specific quirks → [`docs/client-compatibility.md`](../docs/client-compatibility.md)
