# 06 — Benchmarking & capability detection

Benchmarks are how the system *learns* which model is good at what. A **Benchmark** is a
structured test run that produces empirical **Capability** scores, and those scores feed back into
Routing Decisions ([03](03-decision-engine.md)). Without benchmarks the router falls back to
declared capabilities and heuristics.

## The modular benchmark engine

Public surface: `benchmarkModule` (`src/modules/benchmark/index.ts:69`). Internals:

- **`core/runner.ts`** — orchestrates a benchmark run (the largest piece, ~730 LOC).
- **`core/model-benchmarker.ts`** — benchmarks a single model.
- **`core/freshness.ts`** — decides when stored results are stale and need re-running.
- **`core/summary.ts`** — rolls raw runs up into summaries.
- **`evaluation/metrics.ts`, `evaluation/quality.ts`** — scoring. Prefer **executable** scoring
  (apply patch → run tests → record) over heuristic quality scoring, which should be secondary
  metadata, not the pass/fail signal (`docs/AGENTS.md` "Coding Guidelines").
- **`api/ollama.ts`, `api/lm-studio.ts`, `api/simulation.ts`** — provider adapters that actually
  call models. (Replacing the simulated path with real adapters is an explicit modernization
  priority.)
- **`storage/benchmarkDb.ts`, `storage/results.ts`** — persistence into `benchmarks.db`.

## Where scores land — and the registry split (read this)

`benchmark_model` writes capability scores into the **`ModelRegistry` + `CapabilityDetector`**
(`src/modules/core/model-registry.ts`, `core/capability-detector.ts`). That is the **canonical**
store and the one the full routing path reads.

It does **not** write the decision-engine's heuristic `modelsDb`. That store is only seeded from
the registry once at startup. This is the same two-store asymmetry described in
[03-decision-engine](03-decision-engine.md) — benchmarking updates real routing immediately but
not `preemptive_route_task` until a restart re-seed. Authoritative: `docs/AGENTS.md:92`, issue #49.

## The benchmark-related MCP tools

| Tool | Does |
|------|------|
| `benchmark_model` | One model → capability scores in `ModelRegistry`. |
| `benchmark_task` / `benchmark_tasks` | Run one/many tasks across models. |
| `benchmark_free_models` | OpenRouter free models through the modular engine → `benchmarks.db` (issue #51). |
| `rate_model` / `set_model_prompting_strategy` | Human/heuristic quality signal + per-model strategy. |

Tunables (env): `BENCHMARK_RUNS_PER_TASK`, `BENCHMARK_PARALLEL`, `BENCHMARK_MAX_PARALLEL_TASKS`,
`BENCHMARK_TASK_TIMEOUT`, `RELIABLE_BENCHMARK_COUNT`, `STARTUP_BENCHMARK_TARGETS` — see
[09-config-and-env](09-config-and-env.md).

## Validator benchmarking

The validation loop ([03](03-decision-engine.md)) has its own benchmark/fixture story: which
validator fixtures are trusted, how they get promoted, the acceptance rubric. Authoritative docs:
`docs/PRD-validator-benchmarking.md` and `docs/fixture-promotion-policy.md`.

## Running benchmarks

The CLI entrypoint is the root `run-benchmarks.js`, invoked by `npm run benchmark` /
`npm run benchmark:comprehensive` after a build. It uses discovered models from the server path,
with optional CLI filtering via `benchmark-models.json` (`docs/AGENTS.md` "Benchmarking").

## See also
- How scores influence routing → [03-decision-engine](03-decision-engine.md)
- Fixture promotion policy → [`docs/fixture-promotion-policy.md`](../docs/fixture-promotion-policy.md)
- Validator PRD → [`docs/PRD-validator-benchmarking.md`](../docs/PRD-validator-benchmarking.md)
