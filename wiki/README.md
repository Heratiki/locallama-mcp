# LocalLama MCP — Wiki

**Start here.** This wiki is the agent-facing map of the codebase. It explains how the system
actually works, from first principles, with every claim anchored to a `file:line` you can jump
to. Read the page you need; don't re-derive the architecture from source each time.

It does **not** duplicate the authoritative reference docs — it links out to them. When this
wiki and an authoritative doc disagree about *intent*, the authoritative doc wins; when they
disagree about *what the code does*, the code wins and this wiki should be corrected.

---

## The one-paragraph mental model

LocalLama is an **MCP server** that sits between a coding agent (Claude Code, Codex, Cursor, …)
and a pool of LLM runtimes. The agent hands it a **Task** via the `route_task` tool. The server
decides *which provider and model* should do the work — preferring **local** (Ollama / LM Studio
/ llama.cpp, free, runs on your GPU) → **free** remote (OpenRouter free tier) → **paid** frontier
— based on measured cost, capability, context size, and benchmark history. The Task is split into
one or more **Jobs**, written to a **persistent queue**, and `route_task` returns a `task_id`
*immediately* without blocking. Jobs execute through a small number of **slots** (one shared slot
for all local providers because they share one GPU; one independent slot per remote provider). The
agent **polls** `get_task_status` for results, or watches the WebSocket side channel / dashboard.
This lets the agent offload slow, repetitive work to a "good enough" local model and keep moving.

If you read nothing else, read **[01-architecture](01-architecture.md)** and the glossary in
**[10-glossary](10-glossary.md)**.

---

## Navigation

| Page | What it covers |
|------|----------------|
| [01-architecture](01-architecture.md) | The whole shape + the `route_task` → Job → slot → poll lifecycle |
| [02-mcp-surface](02-mcp-surface.md) | Every MCP tool and resource, with one-line purpose |
| [03-decision-engine](03-decision-engine.md) | Task analysis, model selection, the two model data stores |
| [04-providers](04-providers.md) | Provider registry, cost classes, slots, circuit breaker, rate limiter |
| [05-job-store-execution](05-job-store-execution.md) | Persistent Job lifecycle, queue position, recovery, alerts |
| [06-benchmarking](06-benchmarking.md) | Benchmark engine, scoring, capability detection, model registry |
| [07-cost-and-search](07-cost-and-search.md) | Token accounting, cost estimation, BM25/retriv code search |
| [08-telemetry-monitoring](08-telemetry-monitoring.md) | Telemetry, WebSocket channel, dashboard, `get_system_state` |
| [09-config-and-env](09-config-and-env.md) | Config loading + the env var reference |
| [10-glossary](10-glossary.md) | Condensed domain glossary (canonical: `CONTEXT.md`) |
| [11-doc-map](11-doc-map.md) | Which docs are authoritative, and where archived material went |

## Authoritative docs (this wiki links to these, never forks them)

- **[`CONTEXT.md`](../CONTEXT.md)** — canonical domain language (Task, Job, Provider Queue, …).
- **[`docs/AGENTS.md`](../docs/AGENTS.md)** — shared operating guide + reading order for agents.
- **[`docs/audits/ARCHITECTURAL_TRUTHS.md`](../docs/audits/ARCHITECTURAL_TRUTHS.md)** — core constraints / design philosophy.
- **[`docs/adr/`](../docs/adr/)** — architecture decision records (the *why* behind structural choices).
- **[`docs/PROJECT_STATE.md`](../docs/PROJECT_STATE.md)** — current status snapshot.
- **[`docs/OPERATIONAL_TEST_PLAN.md`](../docs/OPERATIONAL_TEST_PLAN.md)** / **[`docs/LIVE_TESTING.md`](../docs/LIVE_TESTING.md)** — verified runtime behavior + open bugs.

## Keeping this wiki honest

Pages cite `file:line`. Line numbers drift as code changes — treat them as "look near here for
this symbol," and trust the **symbol name** over the exact number. When you change a subsystem,
update its wiki page in the same change. The maintenance contract lives in
[11-doc-map](11-doc-map.md).
