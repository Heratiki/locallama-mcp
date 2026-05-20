# Non-blocking route_task with persistent job queue and serial local execution

`route_task` returns a Job ID immediately instead of blocking until the model finishes. Jobs are stored in a persistent queue (SQLite) so they survive server restarts. Each Provider has its own independent FIFO queue and execution slot. Multiple Providers run in parallel — one active Job per Provider at a time. All local Providers (Ollama, LM Studio) share a single slot because they share VRAM on the same GPU (8 GB); running two local models simultaneously causes OOM or swap thrashing. Remote Providers (OpenRouter, and future providers such as OpenAI and Anthropic) each have their own independent slot and are not VRAM-constrained. The practical effect: one local Job and one remote Job can run simultaneously; two local Jobs cannot.

This replaces the prior synchronous model, which would time out after the MCP SDK's 60-second default on any task longer than a minute. The expected use case is long-horizon work (hours, potentially days) submitted to small local models while the user continues interactive work on faster paid models.

## Job recovery on restart

Jobs found in `in_progress` state at startup are automatically retried once. The retry may use a different model or provider chosen by the Routing Decision engine (to avoid re-hitting the same OOM or model bug). If the retry also fails, the Job is marked `permanently_failed` and requires manual re-queue. Auto-retry is capped at one attempt to prevent infinite crash loops on 8 GB VRAM hardware.

At startup, if any Jobs are queued, recovering, or permanently failed, the server emits a Boot-time Alert so the user or MCP client can decide early what to do with them. The Alert surfaces on two channels: a terminal log line (visible when the server is run manually) and a `_queue_alert` metadata field on every subsequent MCP tool response until the queue is clear. The ambient metadata approach ensures MCP clients (Claude Code, OpenCode, etc.) cannot miss it without requiring them to call a dedicated status tool.

## Considered options

**Synchronous with hard cap** — keep blocking, fail tasks over ~90 s with a "break into smaller subtasks" error. Rejected: forces callers to decompose work the server should handle, and breaks legitimate long tasks.

**MCP experimental Tasks API** — use the SDK's `experimental/tasks` for proper async. Rejected for now: client support is sparse, the API is labelled experimental and may change. Can be adopted later as a transport upgrade without changing the queue model.
