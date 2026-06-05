# 07 — Cost accounting, context guard & code search

Two loosely related concerns live under `src/modules/cost-monitor/` and the
`api-integration/cost-estimation/` + `retriv-integration/` adapters: **knowing what a Task costs
before you run it**, and **finding relevant code to feed a model** (BM25 / retriv).

## The cost monitor

Public surface: `costMonitor` (`src/modules/cost-monitor/index.ts:47`). It bundles token
accounting, cost estimation, and the code-search helpers. Key pieces:

- **`tokenManager.ts`** — token accounting (the `TokenUsage` type, re-exported at
  `cost-monitor/index.ts:749`).
- **`api.ts`** — provider cost/usage queries (e.g. OpenRouter credits).
- **`cacheOptimizer.ts`, `codeCache.ts`** — caching of code-task context to avoid recompute.

Token counting is **tiktoken-backed**: utilities in `src/modules/utils/tokenCount.ts` and
`utils/contextWindow.ts` underpin the **context-window guard**. Before dispatch, the routing layer
counts prompt tokens against the chosen model's declared context window and returns a structured
**`context_overflow`** error rather than sending an over-budget prompt (issue #4 / Task 4,
`docs/PROJECT_STATE.md`). The `get_cost_estimate` MCP tool exposes the estimate side of this to
clients.

Cost estimation types live in `src/modules/api-integration/cost-estimation/`
(`index.ts` + `types.ts`); the `CostClass` they reason about is the same `local`/`free`/`paid`
axis from [04-providers](04-providers.md).

## Code search (retriv / BM25)

The goal: retrieve the most relevant code chunks for a coding Task so the model gets the right
context. Implemented as a **native TypeScript BM25 engine — no Python runtime dependency**
(`docs/AGENTS.md` "Code Search Dependencies").

- **`bm25.ts`** — the `BM25Searcher` ranking core.
- **`codeSearchEngine.ts` / `codeSearch.ts`** — the `CodeSearchEngine` that indexes and queries a
  corpus (both re-exported at `cost-monitor/index.ts:750`).
- **`retriv_optimizer.ts`** — retriv-style optimization layer.
- Adapter: `src/modules/api-integration/retriv-integration/` bridges this to the MCP tools.

MCP tools: **`retriv_init`** indexes the corpus, **`retriv_search`** queries it
([02-mcp-surface](02-mcp-surface.md)). Behavior is gated by env:
`CODE_SEARCH_ENABLED`, `CODE_SEARCH_EXCLUDE_PATTERNS`, `CODE_SEARCH_INDEX_ON_START`,
`CODE_SEARCH_REINDEX_INTERVAL` ([09](09-config-and-env.md)).

> The `dev-docs/` directory (gitignored) contains **third-party retriv library reference**
> (`sparse_retriever.md`, `dense_retriever.md`, `bm25`, etc.). It documents the library this
> module is modeled on, not this codebase. It is not part of the wiki.

## See also
- Cost class preference in routing → [03-decision-engine](03-decision-engine.md)
- Lightweight model notes → [`docs/lightweight-models.md`](../docs/lightweight-models.md)
