# 08 — Telemetry, monitoring & system state

How the server tells you what it's doing. Three distinct channels: **telemetry** (spans/metrics
for analysis), the **WebSocket side channel + dashboard** (live Job progress), and
**`get_system_state`** (a point-in-time health snapshot). Plus the **server reminder** that nudges
clients toward monitoring setup.

## Telemetry

`src/modules/telemetry/` is an OpenTelemetry-style layer:

- `getTracer()` (`telemetry/index.ts:17`) and `withSpan<T>()` (`:25`) — instrument code paths.
- `initTelemetry` / `shutdownTelemetry` (`sdk.ts`, re-exported `index.ts:48`) — lifecycle.
- `file-exporter.ts` — writes spans to a file (`TelemetrySpanRecord`).
- `analytics.ts` — aggregation.

Surfaced to clients via the **`get_telemetry_summary`** MCP tool.

## WebSocket side channel & dashboard

The **WebSocket side channel** (`ws://localhost:808x`) broadcasts Job progress in real time. It is
a **server-local** monitoring endpoint — a remote client may need SSH/container/Codespaces/WSL
**port forwarding** before the URL is reachable (`CONTEXT.md`, "Server-local monitoring endpoint").

- `src/modules/websocket-server/ws-server.ts` — `initJobTracker()` (`:38`) wires the JobTracker in;
  `broadcastJobs()` (`:44`) pushes updates to connected clients.
- `ws-server.ts` has its own `db.ts` view + `ws-server-types.ts`.
- The **Dashboard** (`ui.html` at repo root) is the optional web UI: manual `route_task`
  submission, task/job cancellation, benchmark history, queue monitoring with filters, pagination,
  queue-position range, and ETA fields (`eta_ms`/`eta`). Also server-local (issue #34).

Task-executing tools attach **ambient `monitoring.*` metadata** to their responses when the
JobTracker WebSocket server is running: `monitoring.websocketUrl`, `monitoring.activeJobsUri`,
`monitoring.jobProgressUriTemplate` (`docs/PROJECT_STATE.md`). These ride along on normal tool
results — no extra polling call.

> ⚠️ The reminder/monitoring path must be **non-blocking**: never wait on an outbound reachability
> probe before returning a tool response (`CONTEXT.md`, "Non-blocking reminder path").

## `get_system_state` — the health snapshot

`getSystemState()` (`src/modules/api-integration/system-state/index.ts:15`) returns a
`SystemStateResult`:

- top-level **`status`**: `"healthy" | "contended" | "degraded"` — the **worst-case** of all active
  conditions (`degraded > contended > healthy`).
- **`reasons`**: active condition codes —
  `"local_slot_benchmark_contention"`, `"benchmark_queued"`, `"provider_unavailable"`,
  `"provider_unreachable"`.
- a `poll_again_after_ms` hint, a `local_slot` block, and a `remote_providers` array.

Data sources: local slot stats from the in-memory rate limiter, `queued_jobs` from the persistent
job store, provider availability from the circuit breaker ([04-providers](04-providers.md)). Design
detail: `docs/adr/0003-get-system-state-tool-design.md`.

## Server reminder

The **server reminder** (`src/modules/server-reminder/`: `gate.ts`, `reachability.ts`) is an
ambient metadata field that low-frequency-nudges the client about optional monitoring setup. It is
**cadence-gated per server process**, emitted by a single winner under concurrent calls, and
attached to both success and handled-error responses across all tools when eligible. Its
**Monitoring reachability state** normalizes to `reachable` / `unreachable` / `unknown`
(`CONTEXT.md`). Not a per-call spam, not a transport-level guarantee.

## See also
- Slot/availability sources behind the health codes → [04-providers](04-providers.md)
- Where alerts (vs telemetry) come from → [05-job-store-execution](05-job-store-execution.md)
- System-state design → [`docs/adr/0003-...`](../docs/adr/0003-get-system-state-tool-design.md)
