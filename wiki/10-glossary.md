# 10 — Glossary

> **Canonical source: [`CONTEXT.md`](../CONTEXT.md).** This page is a fast-lookup condensation.
> When precise wording or the `_Avoid_` list matters, read `CONTEXT.md`. If the two ever disagree,
> `CONTEXT.md` wins.

## Routing & execution

- **Task** — the aggregate work unit from one `route_task` call. Owns one or more Jobs; you get a
  `task_id` and poll `get_task_status`. *(Avoid: request, work item.)*
- **Job** — a discrete queued unit of execution. Lifecycle
  `queued → in_progress → completed | failed | cancelled | permanently_failed`. Independently
  cancellable/retryable. A failed Job triggers a Boot-time Alert. *(Avoid: subtask, request.)*
- **Job Queue** — the persistent, ordered list of Jobs; survives restart.
- **Queue Position** — a **read-time computed** integer of how many Jobs are ahead in the same
  slot; `null` once the Job leaves `queued`. Not stored. (ADR-0002.)
- **Provider Queue** — each provider's own FIFO queue + execution slot; different providers run in
  parallel.
- **Local Inference Slot** — the **single** slot shared by *all* local providers (one GPU). Only
  one local Job runs at a time. Remote providers each have their own slot.
- **Routing Decision** — the decision engine's output: provider + model + cost class + reason.
- **Cost Class** — `local` (user hardware, no per-token cost) / `free` (remote, quota-limited) /
  `paid` (remote, per-token billing).

## Providers & models

- **Provider** — an LLM runtime the server dispatches Jobs to (Ollama, LM Studio, llama.cpp,
  OpenRouter). Has a cost class, availability, hosted Models.
- **Model** — a specific LLM hosted by exactly one Provider (e.g. `qwen2.5-coder:7b`).
- **Capability** — a declared or measured property gating what Tasks a Model can handle (`code`,
  `vision`, `toolUse`, `largeContext`).
- **Benchmark** — a structured test run producing empirical Capability scores that feed Routing
  Decisions.
- **Binary Discovery** — best-effort startup check for role-specific llama.cpp binaries.
  Diagnostic only; does **not** make llama.cpp routable by itself.
- **User-managed llama.cpp mode** — server connects to an already-running `llama-server` via
  `LLAMA_CPP_ENDPOINT`; it does not own the process lifecycle.

## Monitoring

- **Dashboard** — optional, server-local web UI for the queue, benchmarks, and manual Tasks.
- **Job Recovery** — startup process that gives `in_progress` Jobs **one** auto-retry; a second
  failure → `permanently_failed`. Never retries more than once.
- **Boot-time Alert** — a notification surfaced at startup (and mid-session on Job failure) via the
  ambient `_queue_alert` field; auto-clears when no failed/permanently_failed Jobs remain.
- **Ambient metadata field** — an additive top-level field on tool results carrying server context
  without a separate poll (e.g. `_queue_alert`, `monitoring.*`).
- **Server reminder** — cadence-gated ambient nudge about optional monitoring setup.
- **Monitoring reachability state** — `reachable` / `unreachable` / `unknown`.
- **System State** — the `get_system_state` snapshot: `status` (`healthy`/`contended`/`degraded`,
  worst-case), `reasons` codes, `poll_again_after_ms`, `local_slot`, `remote_providers`.
- **Server-local monitoring endpoint** — a URL resolved from the **server** machine, not the
  client; remote clients may need port forwarding.
- **WebSocket side channel** — `ws://localhost:808x`, broadcasts Job progress; complements, does
  not replace, the MCP tool response path.

## See also
- The authoritative definitions + example dialogue → [`CONTEXT.md`](../CONTEXT.md)
- Domain layout / single-context convention → [`docs/agents/domain.md`](../docs/agents/domain.md)
