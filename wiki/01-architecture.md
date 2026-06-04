# 01 — Architecture & the request lifecycle

This page builds the mental model end to end: from process startup, through a single
`route_task` call, to a completed Job the agent polls for. Once you have this, the per-subsystem
pages are just zoom-ins.

## The shape

LocalLama is a **TypeScript ESM MCP server** speaking JSON-RPC over **stdio**. There is one hard
rule that shapes everything: **only JSON-RPC may touch `process.stdout`** — all logging goes to
`stderr` (`src/utils/logger.ts`). A stray `console.log` silently breaks the MCP handshake. See
`docs/AGENTS.md` "MCP stdio Transport Constraint".

The process is `LocalLamaMcpServer` (`src/index.ts:156`). It owns the MCP `Server`, a lock file
(single-instance guard), the tool dispatch handler (`src/index.ts:283`, `CallToolRequestSchema`),
and lifecycle for the subsystems below.

Five layers, each with its own wiki page:

```
 MCP client (agent)
        │  JSON-RPC / stdio
        ▼
 ┌──────────────────────────────────────────────┐
 │ MCP surface        tool-definition/, resources.ts   → 02
 ├──────────────────────────────────────────────┤
 │ Decision engine    routing/, decision-engine/       → 03
 ├──────────────────────────────────────────────┤
 │ Providers          core/provider/, ollama/, ...     → 04
 ├──────────────────────────────────────────────┤
 │ Execution + state  job-store/, jobTracker, executor → 05
 ├──────────────────────────────────────────────┤
 │ Observability      telemetry/, websocket-server/    → 08
 └──────────────────────────────────────────────┘
```

## Two key terms before the trace

Get these exactly right (full definitions in [10-glossary](10-glossary.md) / `CONTEXT.md`):

- **Task** — the aggregate work unit created by *one* `route_task` call. Owns one or more Jobs.
  You always get a `task_id` back and poll `get_task_status` for aggregate completion.
- **Job** — a discrete queued unit of execution with its own lifecycle
  `queued → in_progress → completed | failed | cancelled | permanently_failed`
  (`src/modules/job-store/types.ts:1`). Independently cancellable and retryable.

A Task with subtasks becomes several Jobs; each Job can target a different provider and run on
that provider's own slot.

## The lifecycle of one `route_task`

1. **Dispatch.** The agent calls the `route_task` tool (defined at
   `src/modules/api-integration/tool-definition/index.ts:33`). The central handler in
   `src/index.ts:283` routes the tool name to its implementation.

2. **Route.** Control reaches the routing layer — `routeTask`
   (`src/modules/api-integration/routing/index.ts:1463`, a bound method of the `Router` class at
   `:51`), which collaborates with the decision engine's `taskRouter`
   (`src/modules/decision-engine/services/taskRouter.ts:809`). This produces a **Routing
   Decision**: provider + model + cost class + reason. Routing is **local-first** — see
   [03-decision-engine](03-decision-engine.md) and [04-providers](04-providers.md) for the
   ranking and the cost-class preference order.

3. **Guard.** Before dispatch, the prompt is token-counted against the chosen model's declared
   context window; an over-budget prompt returns a structured `context_overflow` error instead of
   being sent (see [07-cost-and-search](07-cost-and-search.md)).

4. **Persist + enqueue.** A **Task** and its **Job(s)** are written to the persistent job store
   (`src/modules/job-store/`, SQLite). The Job enters the queue in state `queued`. This is what
   makes the call **non-blocking** and **restart-survivable** (ADR-0001).

5. **Return immediately.** `route_task` returns a `task_id` (and the Job IDs). The MCP call does
   **not** wait for execution. The agent is free to do other work.

6. **Execute through a slot.** The `JobTracker` (`src/modules/decision-engine/services/
   jobTracker.ts:63`) and `taskExecutor` pick up queued Jobs as a **slot** frees. There is **one
   shared slot for all local providers** (they contend for one GPU) and **one independent slot per
   remote provider** (run in parallel). Slot accounting lives in the provider registry's rate
   limiter (`src/modules/core/provider/registry.ts`). See [04-providers](04-providers.md).

7. **Observe.** While a Job runs, progress is broadcast on the **WebSocket side channel**
   (`ws://localhost:808x`) and the optional **dashboard**; task-executing tools also attach
   ambient `monitoring.*` metadata to their responses. See [08-telemetry-monitoring](08-telemetry-monitoring.md).

8. **Poll for completion.** The agent calls `get_task_status` (`get_task_status` tool;
   `getTaskStatus` at `routing/index.ts:1466`). A Task is `completed` when all Jobs complete,
   `partially_failed` when some fail, `failed` when all fail. Individual Jobs can be cancelled
   (`cancel_job`) or the whole remaining Task (`cancel_task`).

9. **Failure surfacing.** A Job that transitions to `failed`/`permanently_failed` raises a
   **Boot-time Alert** that rides along on the *next* tool response (the `_queue_alert` ambient
   field), so the agent learns about it without explicit polling. See
   [05-job-store-execution](05-job-store-execution.md).

## What survives a restart

The job queue is **persistent** (SQLite). On startup, **Job Recovery**
(`src/modules/job-store/recovery.ts`) finds Jobs left `in_progress` and attempts exactly **one**
automatic retry; a second failure marks the Job `permanently_failed` (manual re-queue only). A
Boot-time Alert tells the agent what needs attention. Design rationale: ADR-0001
(`docs/adr/0001-non-blocking-route-task-with-persistent-job-queue.md`).

## See also

- Decision/ranking detail → [03-decision-engine](03-decision-engine.md)
- Slots, cost classes, circuit breaking → [04-providers](04-providers.md)
- Job persistence, queue position, recovery → [05-job-store-execution](05-job-store-execution.md)
- The authoritative narrative of these terms → [`CONTEXT.md`](../CONTEXT.md)
