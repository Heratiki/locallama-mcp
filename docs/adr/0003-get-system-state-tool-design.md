# get_system_state: MCP tool, slot-aware schema, job-store queue counts

Remote MCP callers have no reliable way to determine why a task is delayed. Existing ambient fields (`_queue_alert`, `_server_reminder`, `benchmark_contention` on `QueuedRouteTaskResult`) are attached to other tool responses and require a prior `route_task` call to observe. The WebSocket side channel is server-local and unreachable from remote clients without port forwarding.

`get_system_state` is a zero-argument MCP tool that returns a structured snapshot of runtime health: top-level `status` and `reasons` for fast agent branching, plus raw counts in `local_slot` and `remote_providers` for diagnostic detail.

## Key decisions

### Tool, not MCP resource

Resources add a second URI-based surface to document, test, and keep in sync with the tool schema. MCP clients reach for `call_tool` not `read_resource` in practice. A tool also lets the response carry `poll_again_after_ms` guidance (already established by `route_task` and `get_task_status`), which a URI resource cannot. The existing `locallama://jobs/active` and `locallama://jobs/progress/{jobId}` URIs are emitted as monitoring metadata but are not load-bearing for agent polling.

### Worst-case `status` + `reasons` array, not a flat condition list

A single `status` enum (`"healthy" | "contended" | "degraded"`) gives agents a cheap branching signal. A parallel `reasons` array of active condition codes (`"local_slot_benchmark_contention"`, `"benchmark_queued"`, `"provider_unavailable"`, `"provider_unreachable"`) preserves full diagnostic detail when multiple conditions are active simultaneously. Priority order: `degraded > contended > healthy`. This is the same pattern as HTTP status codes with a body — fast path cheap, diagnostic path complete.

A flat array of conditions was rejected because it forces every caller to iterate and check membership rather than switch on one value.

### Slot-aware structure, not flat provider enumeration

Ollama, LM Studio, and llama.cpp share a single VRAM-constrained execution slot (see ADR 0001). Enumerating them individually implies they have independent slots, which they do not. A dedicated `local_slot` block reflects this architectural reality and matches the `local_slot_contended` vocabulary already in `QueuedRouteTaskResult`. Remote providers each have independent slots and are enumerated individually in `remote_providers`.

### `queued_jobs` from job store, not rate limiter

The rate limiter holds in-memory scheduling state that rehydrates lazily after a server restart. The job store (SQLite) is the system of record for job lifecycle and has the correct count immediately after restart. Using the job store also keeps `get_system_state` consistent with `get_task_status`, which already reads from it. The query is a cheap `COUNT WHERE status = 'queued' AND is_local = ?`.

### State-driven `poll_again_after_ms`

`healthy → 30 000 ms`, `contended → 5 000 ms`, `degraded → 10 000 ms`. Contended polls more aggressively because a benchmark finishing frees the local slot — an event worth catching quickly. Degraded polls less aggressively because an unavailable provider requires external action; hammering the endpoint wastes calls. This follows the pattern established by `get_task_status`.

## Response schema

```typescript
{
  status: "healthy" | "contended" | "degraded";
  reasons: Array<
    | "local_slot_benchmark_contention"
    | "benchmark_queued"
    | "provider_unavailable"
    | "provider_unreachable"
  >;
  poll_again_after_ms: number;
  local_slot: {
    status: "inference" | "benchmark" | "idle";
    queued_jobs: number;           // job store
    active_benchmark_runs: number; // rate limiter
    queued_benchmark_runs: number; // rate limiter
  };
  remote_providers: Array<{
    id: string;
    cost_class: "local" | "free" | "paid";
    available: boolean;            // circuit breaker
    queued_jobs: number;           // job store
  }>;
}
```

## Backward compatibility

`_queue_alert`, `_server_reminder`, and `benchmark_contention` on `QueuedRouteTaskResult` are unchanged. `get_system_state` is additive.

## Considered options

**Expand ambient metadata on existing tools** — attach system state to every `route_task` / `get_task_status` response. Rejected: callers with no active task have no way to observe system state, and bloating every response with provider enumeration increases payload size on the hot path.

**MCP resource URI** — expose `locallama://system/state` as a readable resource. Rejected: no `poll_again_after_ms` guidance, requires clients to use `read_resource` rather than `call_tool`, and adds a second surface to keep synchronized with the type system.

**Per-provider separate tools** — `get_local_slot_state`, `get_provider_state`. Rejected: forces callers to make multiple round-trips to build a picture of overall system health.
