# 04 — Providers, cost classes & slots

A **Provider** is an LLM runtime the server can dispatch Jobs to. Each has a **cost class**, an
availability state, and a set of hosted **Models**. This page covers the registry that abstracts
them, the slot model that controls concurrency, and the resilience layer (circuit breaker + rate
limiter).

## The registry abstracts every provider behind one interface

`ProviderRegistry` (`src/modules/core/provider/registry.ts:18`, singleton via
`getProviderRegistry()` at `:297`) holds all initialized providers. The contract each provider
implements is `LLMProvider` (`src/modules/core/provider/types.ts`), whose key field is
`readonly costClass` (`types.ts:45`).

Provider implementations live in their own modules — keep provider-specific logic **there**, not
scattered through the decision engine (`docs/AGENTS.md` "Coding Guidelines"):

| Provider | Module | Cost class |
|----------|--------|------------|
| Ollama | `src/modules/ollama/` | `local` |
| LM Studio | `src/modules/lm-studio/` | `local` |
| llama.cpp | `src/modules/llama-cpp/` | `local` |
| OpenRouter | `src/modules/openrouter/` | `free` and/or `paid` |

Useful registry methods: `listByCostClass(costClass)` (`registry.ts:57`) filters providers by
`local`/`free`/`paid`.

## Cost classes

`CostClass = 'local' | 'free' | 'paid'` (`types.ts:10`):

- **`local`** — runs on user hardware, no per-token cost, VRAM-bound.
- **`free`** — remote, quota/rate-limited, no direct cost (OpenRouter free models).
- **`paid`** — remote, per-token billing (OpenRouter paid; future OpenAI/Anthropic).

This is the axis routing prefers along: **local → free → paid** ([03](03-decision-engine.md)).

## Slots: the concurrency model (this is the crux)

The single most important runtime constraint:

- **One shared "Local Inference Slot" for *all* local providers combined.** Ollama, LM Studio,
  and llama.cpp share one GPU's VRAM, so only **one local Job runs at a time** regardless of which
  local provider hosts it.
- **One independent slot per remote provider.** Remote providers aren't VRAM-bound, so their Jobs
  run in parallel with each other and with the local slot.

A decomposed Task whose subtasks target different providers dispatches **concurrently** across
them, while still respecting each provider's slot limit. Caps are configurable:

- `PROVIDER_MAX_CONCURRENT_LOCAL` (`registry.ts:29`, default 1)
- `PROVIDER_MAX_CONCURRENT_REMOTE` (`registry.ts:30`, default 1 per provider)

Slot accounting is done by the registry's **rate limiter**
(`src/modules/core/provider/rate-limiter.ts`); queue stats come from
`getQueueStats('local', 'local')` (`registry.ts:206`). The `is_local` flag on a Job records which
slot category it was assigned at routing time and must move with `provider_id` if a Routing
Decision changes (`CONTEXT.md`, Queue Position).

## Resilience: circuit breaker + rate limiter

- **Circuit breaker** (`src/modules/core/provider/circuit-breaker.ts`) — trips a provider to
  unavailable after repeated failures so routing stops choosing it; feeds the
  `provider_unavailable` reason in `get_system_state`.
- **Rate limiter** (`rate-limiter.ts`) — enforces slot caps and tracks queue depth; the source of
  `local_slot_benchmark_contention` / `benchmark_queued` signals.
- **Local runtime lifecycle** (`local-runtime-lifecycle.ts`) — manages local process reachability.

## llama.cpp has two modes

1. **User-managed mode** — the server connects to an already-running `llama-server` via
   `LLAMA_CPP_ENDPOINT` and does **not** own the process lifecycle.
2. **Binary Discovery** — a best-effort startup check (`src/modules/llama-cpp/discovery.ts`) for
   role-specific binaries, used for future managed execution. It is **diagnostic only** and does
   **not** make llama.cpp routable by itself (`CONTEXT.md`).

## See also
- Ranking that *picks* a provider → [03-decision-engine](03-decision-engine.md)
- Slot health surfaced to clients → [08-telemetry-monitoring](08-telemetry-monitoring.md)
- Registry design rationale → [`docs/architecture/provider-registry.md`](../docs/architecture/provider-registry.md)
