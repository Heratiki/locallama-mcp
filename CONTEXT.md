# LocalLama MCP

An MCP server that routes coding work across local models, free remote models, and paid frontier models. The goal is to let a coding agent delegate slow or repetitive subtasks to capable-enough local models, then check back when done — freeing the agent to continue with faster models on other work.

## Language

### Routing and execution

**Task**:
An incoming work request from an MCP client (e.g. Claude Code). A Task is what the client submits; it may decompose into one or more Jobs.
_Avoid_: Request, prompt, query

**Job**:
A discrete unit of work in the execution queue. Jobs have a lifecycle: `queued → in_progress → completed | failed | cancelled | permanently_failed`. A Task produces at least one Job; when the coordinator decomposes a Task into subtasks, each subtask becomes its own Job. Jobs are independently cancellable and independently retryable. A failed Job triggers an immediate Boot-time Alert entry so the caller is notified on the next tool call without needing to poll.
_Avoid_: Task (when referring to the queued unit), subtask, request

**Task**:
The aggregate work unit created by one `route_task` call. A Task owns one or more Jobs. `route_task` always returns a `task_id`; callers poll `get_task_status` for aggregate completion. Individual Job IDs are visible in the Task status response for targeted cancellation. A Task is `completed` when all its Jobs complete, `partially_failed` when some Jobs fail and others succeed, and `failed` when all Jobs fail. Callers may cancel individual Jobs (`cancel_job`) or the entire remaining work (`cancel_task`).
_Avoid_: Job (when referring to the aggregate), request, work item

**Job Queue**:
The persistent, ordered list of Jobs awaiting execution. Survives server restart. Jobs are processed in submission order unless a provider-specific slot is free.
_Avoid_: Task queue, work queue

**Queue Position**:
A read-time computed integer indicating how many Jobs are ahead of a given Job among those competing for the same execution slot. For local Jobs, counts other local Jobs in `queued` or `in_progress` state with an earlier insertion order (by `rowid` when `created_at` ties). For remote Jobs, counts other Jobs on the same Provider Queue. `null` when the Job is `in_progress`, `completed`, `failed`, `cancelled`, or `permanently_failed` — position is only meaningful while a Job is `queued`. The `is_local` flag on a Job records which slot category it was assigned at routing time and must be updated alongside `provider_id` whenever a Routing Decision changes.
_Avoid_: Stored position, enqueue-time position, global position across all providers

**Provider Queue**:
Each Provider has its own independent FIFO Job Queue and execution slot. Jobs for different Providers run in parallel — one active Job per Provider at a time. A decomposed Task with subtasks targeting different Providers dispatches concurrently across those Providers, while still respecting each Provider's individual slot limit.
_Avoid_: Global queue, shared queue

**Local Inference Slot**:
The single execution slot shared by all local Providers (Ollama, LM Studio) combined. Because local Providers share VRAM on a single GPU, only one local Job can run at a time regardless of which local Provider hosts it. Remote Providers (OpenRouter, future: OpenAI, Anthropic) each have their own independent slot and are not VRAM-constrained.
_Avoid_: Worker, thread, connection

**Routing Decision**:
The output of the decision engine for a given Task — which provider and model should handle it, and why. Captured with cost class, provider ID, model ID, and reason.
_Avoid_: Model selection, dispatch choice

**Cost Class**:
A three-value classification of a provider's cost structure: `local` (runs on user hardware, no per-token cost), `free` (remote, quota-limited, no direct cost), `paid` (remote, per-token billing).
_Avoid_: Provider type, tier

### Providers and models

**Provider**:
An LLM runtime that the server can dispatch Jobs to. Each Provider has a cost class, an availability state, and a set of hosted Models. Examples: Ollama, LM Studio, OpenRouter.
_Avoid_: Backend, runtime, service

**Model**:
A specific LLM hosted by a Provider. Identified by provider-scoped ID (e.g. `qwen2.5-coder:7b` on Ollama). A Model belongs to exactly one Provider.
_Avoid_: Engine, checkpoint

**Capability**:
A declared or empirically measured property of a Model that determines what kinds of Tasks it can handle. Examples: `code`, `vision`, `toolUse`, `largeContext`.
_Avoid_: Feature, skill, ability

**Benchmark**:
A structured test run against a Model that produces empirical scores for one or more Capabilities. Benchmark results feed back into Routing Decisions.
_Avoid_: Evaluation, test run, assessment

### Monitoring

**Dashboard**:
A web interface for observing the Job Queue, reviewing Benchmark results, and submitting Tasks manually. It is optional and server-local like the WebSocket side channel, so remote users may need port forwarding before opening it from another machine.
_Avoid_: UI, frontend, portal, monitor

**Job Recovery**:
The process that runs at server startup when Jobs in `in_progress` state are found. The server attempts one automatic retry using the same or an alternate Routing Decision. If the retry also fails, the Job enters `permanently_failed` and requires manual re-queue. A Job never auto-retries more than once.
_Avoid_: Resume, restart, replay

**Boot-time Alert**:
A notification surfaced to the user or MCP client at startup when the Job Queue contains Jobs that need attention (recovering, queued-but-stale, or permanently failed). Lets the agent decide early whether to cancel, re-queue, or wait. Also triggered mid-session when any Job transitions to `failed` or `permanently_failed`, so the agent is notified on the next tool call without explicit polling. The alert clears automatically when no `failed` or `permanently_failed` Jobs remain — healthy queued/in_progress Jobs do not sustain it. Future: explicit acknowledgement via tool call for sessions with large decomposed refactors.
_Avoid_: Startup warning, notification, banner

**Ambient metadata field**:
A top-level response field attached to MCP tool results when server context must be surfaced without a separate polling call. Ambient metadata fields are additive and optional, and should remain top-level for consistency (for example `_queue_alert`).
_Avoid_: Nested metadata envelope, inline prose-only warning

**Server reminder**:
An ambient metadata field that surfaces a low-frequency prompt about optional monitoring setup. The reminder is cadence-gated per server process instance, emitted by a single winner under concurrent calls, and attached to both successful and handled-error tool responses across all tools when eligible.
_Avoid_: Per-call spam, transport-level crash guarantees

**Monitoring reachability state**:
The reminder's normalized status for monitoring endpoint checks: `reachable`, `unreachable`, or `unknown` when no conclusive probe result exists yet.
_Avoid_: Boolean-only status, ad-hoc freeform strings

**Server-local monitoring endpoint**:
A monitoring URL emitted in MCP metadata that is resolved from the machine running the MCP server, not the machine running the MCP client. Typical examples are `monitoring.websocketUrl` and the optional dashboard URL. In remote environments, callers may need SSH, container, Codespaces, or WSL port forwarding before these URLs are reachable.
_Avoid_: Globally reachable URL, client-local URL

**Non-blocking reminder path**:
Reminder attachment behavior that must not wait on outbound reachability probes before returning a tool response.
_Avoid_: Synchronous probe on request path, latency-coupled reminder injection

**WebSocket side channel**:
The secondary real-time channel (ws://localhost:808x) that broadcasts Job progress updates. It is a server-local monitoring endpoint: remote clients may need forwarding before the URL is reachable. Complements, but does not replace, the primary MCP tool response path.
_Avoid_: WebSocket server (ambiguous — the side channel is a specific role, not just a server)

## Example dialogue

> **Dev:** I want to send a big refactor to a local model and keep working while it runs.
>
> **Domain expert:** You submit a Task via `route_task`. The server creates a Job in the Job Queue and returns the Job ID immediately — the MCP call doesn't block. The Local Inference Slot picks up the Job when it's at the front of the queue and free. If there's already a local Job running, yours waits. You can check progress via `get_job_status` or watch the WebSocket side channel. Eventually you'll be able to track it on the Dashboard.
>
> **Dev:** What if there's a paid model and a local model I could use?
>
> **Domain expert:** The Routing Decision picks based on cost class preference, Capability match, and current provider availability. If you want local-first, the Job goes to the Local Inference Slot queue. If you want immediate results and don't mind cost, it routes to a paid provider — no queue, no wait.
>
> **Dev:** What happens if the server restarts while my refactor is running?
>
> **Domain expert:** The Job Queue is persistent. In-progress Jobs at restart are marked `failed` with reason `server_restart`. The Job stays in the queue so you can inspect it; re-queuing is manual for now.
