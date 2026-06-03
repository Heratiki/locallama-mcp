# PRD: Validator-Model Benchmarking, Unbenchmarked-Model Signaling, and Output Validation Loop

_Last updated: 2026-06-01. All implementation decisions finalised via grilling session._

## Problem Statement

When `route_task` selects a free/OpenRouter model, it frequently has no benchmark data for that model. With no quality signal, the router falls back to a base score of 0.3 plus name heuristics, and the caller receives no indication that the chosen model is unbenchmarked. The routed model then executes the task and returns output — but there is no step that validates whether the output actually meets the requirements. The orchestrator (e.g., Claude Sonnet) ends up as the implicit validator, which defeats the cost-reduction goal of the MCP: orchestrator tokens are burned to fix what a free model got wrong.

A second gap: there is no concept of a "validator model" — a model whose specific job is to score or verify another model's output against the original task requirements. The benchmark system measures how well models *generate* code or chat responses, but never measures how well a model *evaluates* output. A poor validator produces false confidence; a good one enables reliable self-correction without involving the orchestrator.

This was surfaced during a real-life integration test: `route_task` selected `meta-llama/llama-3.2-3b-instruct:free` (unbenchmarked, free tier) for a Python code generation task. The model produced output with a critical Python idiom bug (`__main__` misspelled as `_main`) and missed a stated requirement (punctuation stripping). The caller (Sonnet) had to detect and fix both issues — exactly the cost the MCP is designed to avoid.

## Solution

Introduce four coordinated capabilities:

1. **Ranked trio routing**: `route_task` and `preemptive_route_task` pre-compute a ranked trio of models (good/better/best) within the same cost tier. "Good" is used for the initial attempt. On validation failure, the system automatically escalates to "better", then "best", without re-running the router.

2. **Validator-model benchmarking**: Add a `validate` task category to the benchmark system. Models are benchmarked on their ability to correctly judge output quality using gold-standard fixture pairs (known-good and known-bad outputs). Models accumulate a `validationScore` that feeds into validator selection and is seeded from generation benchmarks on day one.

3. **Output validation loop with self-validation**: After a generation model completes a task, the generation model first self-validates its own output (pre-filter). If it passes self-validation, an external validator model checks the output. On failure at either stage, the system retries with the next model in the trio. Repair is always retry-as-repair — the validator judges only; it never rewrites output.

4. **Unified model rating tool**: A new `rate_model` MCP tool lets callers provide explicit feedback on any model in any role (generator or validator), closing the feedback loop and contributing to organic fixture growth.

## User Stories

1. As an orchestrator agent, I want `route_task` to return a ranked trio of models (good/better/best) upfront, so that I can see the full fallback ladder before the task executes.
2. As an orchestrator agent, I want `route_task` to tell me when any model in the trio has no benchmark data, so that I can choose to benchmark them first.
3. As an orchestrator agent, I want `route_task` to tell me which `benchmark_model` call to make for each unbenchmarked trio member, so that I do not have to determine this myself.
4. As an orchestrator agent, I want the MCP to validate generated output before returning it to me, so that I do not spend tokens correcting code the MCP could have caught.
5. As an orchestrator agent, I want to know whether the returned output was validated, by which model, and with what confidence, so that I can calibrate my trust in the result.
6. As an orchestrator agent, I want validation to be skippable per call with `validate: false`, so that I can opt out for latency-sensitive or non-code tasks.
7. As an orchestrator agent, I want the generation model to self-validate its own output before an external validator is called, so that obvious failures are caught cheaply without consuming an external validator slot.
8. As an orchestrator agent, I want the retry to automatically use the next model in the pre-computed trio without re-routing, so that retry latency is minimal.
9. As an orchestrator agent, I want `preemptive_route_task` to also return the full trio with benchmark metadata, so that planning decisions have the same information as execution decisions.
10. As an orchestrator agent, I want to submit feedback on any model's performance via a unified `rate_model` tool, so that the system learns from my observations.
11. As a system operator, I want validator models benchmarked specifically for their validation accuracy using gold-standard fixture pairs, so that `validationScore` reflects real capability, not heuristics.
12. As a system operator, I want the `validate` benchmark to start with seeded scores derived from generation benchmarks, so that the system is usable on day one without a cold-start gap.
13. As a system operator, I want the `validate` benchmark fixture set to grow automatically from `rate_model` negative outcomes, so that real-world failures become future test cases without manual effort.
14. As a system operator, I want fixture candidates from production to require a review gate before becoming authoritative, so that mislabelled data cannot corrupt the benchmark.
15. As a system operator, I want the retry budget and validation threshold to be configurable via `.env`, so that I can tune the tradeoff between quality and latency.
16. As a system operator, I want validation failures logged with the output, the validator's reasoning, and the retry outcome, so that I can improve prompting strategies over time.
17. As a system operator, I want free-tier trio ranking to factor in provider diversity and current rate-limit usage, so that retries do not hit the same provider wall as the initial attempt.
18. As a system operator, I want `route_task` to return a `fallback_notice` when fewer than 3 distinct models exist in the tier, so that I know the trio has limited coverage.
19. As a developer, I want the `OutputValidator` module to have a narrow interface with no dependency on the job store or routing logic, so that it can be tested in isolation with a mock provider.
20. As a developer, I want the validator model's live reputation to update automatically via EMA on parse reliability, so that unreliable validators sink in the rankings through use.
21. As a developer, I want manual `rate_model` feedback to also adjust the relevant model score, so that explicit operator signals carry weight alongside automatic signals.
22. As a developer, I want `benchmark_model` to accept `task_categories: ["validate"]`, so that validation capability can be benchmarked independently of generation capability.
23. As a cost-conscious operator, I want the validator model selected from local/free tier whenever a sufficiently accurate one exists, so that validation does not introduce paid API calls.
24. As a cost-conscious operator, I want self-validation on free-tier models gated on remaining rate-limit budget, so that self-validation does not consume a slot the retry needs.
25. As a cost-conscious operator, I want the system to skip external validation entirely when no model meets `MIN_VALIDATOR_SCORE`, rather than using a poor validator, so that I do not get false confidence.

## Implementation Decisions

### 1. `validate` benchmark task category — binary pass/fail with ground-truth fixtures

The benchmark runner's `task_categories` enum gains `validate` alongside `code`, `chat`, `tool-use`, and `long-context`.

A `validate` benchmark task presents the model with:
- The original task description
- A generated output (either a known-good or known-bad example from the fixture set)
- A YES/NO prompt: *"Does this output correctly and completely satisfy the task? Answer only YES or NO on the first line, then explain."*

The benchmark score for a single run is binary: did the model's first-line verdict match the ground-truth label? Averaged across runs, this produces a `validationScore` between 0 and 1. The YES/NO format is chosen for robustness across all model sizes — JSON output is fragile for small models.

**Repair model**: validation is retry-as-repair only. The validator judges; it never rewrites output. A failed verdict triggers escalation to the next model in the ranked trio.

### 2. `validationScore` bootstrapping

On day one, no models have real `validate` benchmark data. To avoid a cold-start gap:

- When a model has no `validate` benchmark runs, its `validationScore` is seeded as `codeScore × 0.8`.
- This seeded score is treated as a single benchmark run for confidence-blending purposes (`confidence = 1 / RELIABLE_BENCHMARK_COUNT`), so it is heavily discounted relative to models with real validate data.
- Once real `validate` runs accumulate to `RELIABLE_BENCHMARK_COUNT`, the seeded value is fully replaced by the empirical score.
- `RELIABLE_BENCHMARK_COUNT` is promoted from a file-scoped constant to a named config value (default: `3`), shared across generation and validation selection logic.

### 3. Ranked trio — pre-computed at routing time, tier-homogeneous

`route_task` computes a ranked trio of models at routing time:

- **Tier selection runs first**: the router determines which cost tier to use (local / free / paid) as today.
- **All three slots come from the same tier**: if "good" is a free-tier model, "better" and "best" are also free-tier. The trio never mixes tiers.
- **Ranking within the tier** uses the same confidence-blended scoring as today, extended with `validationScore` as an additional factor.
- **Insufficient models**: if fewer than 3 distinct models exist in the selected tier, the "good" model fills the remaining slots and the response includes a `fallback_notice` string explaining how many distinct options exist.
- **The trio is stored in-memory** in the `JobTracker` job map alongside the existing job state. It is not persisted to the DB — if the server restarts, the job is recovered as failed and the client re-submits (existing recovery behaviour).

### 4. Free-tier trio ranking: provider diversity + rate-limit awareness

For free-tier trios (OpenRouter), the ranking scorer applies two additional factors:

- **Provider diversity bonus**: models from a different provider than "good" receive a ranking bonus. This distributes rate-limit risk across the trio so a retry does not hit the same provider wall.
- **Current usage penalty**: models from providers near their rate limit (tracked via the existing OpenRouter rate-limit accounting) receive a ranking penalty proportional to remaining capacity.

Both factors are combined into the existing scoring formula as additional weights.

### 5. `route_task` and `preemptive_route_task` response shape

Both tools return the full trio with metadata. `preemptive_route_task` uses the same response shape as `route_task` — the heuristic scorer already ranks all candidates, so surfacing top-3 adds negligible compute.

```typescript
ranked_trio: {
  good:   { model_id, provider_id, benchmark_runs, validation_score_seeded: boolean },
  better: { model_id, provider_id, benchmark_runs, validation_score_seeded: boolean },
  best:   { model_id, provider_id, benchmark_runs, validation_score_seeded: boolean },
  fallback_notice?: string   // present when fewer than 3 distinct models available
},
benchmarking_recommended?: Array<{
  model_id: string,
  provider_id: string,
  suggested_categories: Array<'code' | 'chat' | 'validate'>,
  reason: string
}>  // one entry per trio member with benchmark gaps; absent when all are well-benchmarked
```

The existing `model` field at the top level continues to reflect the "good" model for backwards compatibility.

### 6. Validation flow: self-validation pre-filter + external validator

After the "good" model generates output, the following sequence runs (unless `validate: false` was passed):

1. **Self-validation** (pre-filter): the generation model is called again with the YES/NO validation prompt on its own output.
   - For local models: model is already warm — effectively free compute.
   - For free-tier models: gated on remaining rate-limit budget. If budget is insufficient, self-validation is skipped.
   - Self says **NO** → skip external validator entirely, retry immediately with "better."
   - Self says **YES** → proceed to external validation.
2. **External validator selection**: `getBestValidatorModel()` selects the highest-scoring model meeting `MIN_VALIDATOR_SCORE` (default: `0.6`, `.env` key: `MIN_VALIDATOR_SCORE`). Prefers local then free over paid.
3. **External validation**: validator receives task + output, returns YES/NO verdict.
   - **YES** → return result with `validation: { passed: true, self_validated: bool, external_model, confidence }`.
   - **NO** → retry with "better" from the trio.
4. **Retry**: dispatch "better" model, repeat from step 1. If "better" also fails, dispatch "best."
5. **Budget exhausted**: return best result seen with `validation: { passed: false, ... }` and let the caller decide.
6. **No external validator available** (all below `MIN_VALIDATOR_SCORE`): return after self-validation only, with `validation: { external_skipped: true, reason: 'no_qualified_validator' }`.

### 7. `OutputValidator` deep module

A narrow module exposing a single async entry point:

```typescript
validate(
  task: string,
  output: string,
  validatorModel: Model
): Promise<{
  passed: boolean,
  confidence: number,   // 0–1, derived from explanation length/certainty
  reason: string,
  parsed_cleanly: boolean  // true if YES/NO was on first line; false if keyword fallback used
}>
```

**Prompt format**: "Does this output correctly and completely satisfy the task? Answer only YES or NO on the first line, then explain."

**Parsing**: read first line, check for YES/NO. If absent, keyword-scan the full response (`pass`, `correct`, `yes` → passed; `fail`, `incorrect`, `no` → failed). If nothing found, `parsed_cleanly: false`, treat as validation skipped (graceful degradation).

No dependency on the job store, routing, or benchmark infrastructure — only `providerRegistry.executeTask`. Fully testable with a mock provider.

### 8. Validator model selection: `getBestValidatorModel`

A new function in the model selector applies the same confidence-blended scoring as `getBestLocalModel`, reading from `benchmarkSummary.scores.validate`:

- Prefers local then free over paid
- Returns `null` when no model meets `MIN_VALIDATOR_SCORE` (validation is then skipped)
- Uses the shared `RELIABLE_BENCHMARK_COUNT` for confidence calculation
- Excludes the generation model from validator candidates when possible (avoid self-loop via external path; self-validation is handled separately in step 1)

### 9. Validator live reputation: EMA on parse reliability

After every `OutputValidator` call, the validator model's `validationScore` is updated:

```
newScore = oldScore × 0.95 + signal × 0.05
```

Where `signal = 1.0` if `parsed_cleanly: true`, `signal = 0.0` if `parsed_cleanly: false` (unparseable response). This rewards validators that reliably produce clean YES/NO and penalises ones that produce garbage, without making assumptions about verdict correctness.

### 10. Unified `rate_model` MCP tool

New tool with the following parameters:

| Parameter | Type | Description |
|---|---|---|
| `model_id` | string | Model being rated |
| `job_id` | string | Job this feedback relates to (for audit trail) |
| `role` | `'generator' \| 'validator'` | What the model was doing |
| `outcome` | `'positive' \| 'negative' \| 'partial'` | Overall quality signal |
| `validator_verdict` | `'accurate' \| 'too_strict' \| 'too_lenient'` | Only when `role: 'validator'` |
| `comment` | string? | Optional free-text context |

**Score adjustments**:
- `role: 'generator'` → adjusts `qualityScore` and the relevant `scores.code` / `scores.chat` field
- `role: 'validator'` → adjusts `scores.validate`
- Adjustment magnitude uses the same EMA formula as automatic reputation updates but with a stronger alpha (`0.10` vs `0.05`) — explicit human/orchestrator signals carry more weight than automatic parse-reliability signals
- `outcome: 'negative'` + `job_id` → saves `{ task, output, label: 'bad' }` as a fixture candidate in the review queue

### 11. `validate` benchmark fixture set

**Seed set**: 10–15 hand-crafted fixture triples `{ task, known_good_output, known_bad_output }` shipped with the codebase in a versioned JSON file. The Python `__main__` case from the real-world test failure is fixture #1.

**Organic growth**: every `rate_model` call with `outcome: 'negative'` generates a fixture candidate: `{ task, output, label: 'bad' }` stored in a separate candidates file. A future `promote_fixture` tool (or manual PR) moves candidates to the authoritative set after human review. The details of the review rubric, roles, audit trails, and promotion workflow are governed by the [fixture-promotion-policy.md](file:///home/heratiki/Source/locallama-mcp/docs/fixture-promotion-policy.md).

**Structure**: fixtures are language-tagged so the benchmark runner can filter by language when selecting fixture pairs for a given task.

### 12. Schema additions

- `benchmarkSummary.scores` gains `validate?: number`
- `ModelCapabilities.scores` gains `validate?: number`
- `BenchmarkSummary.taskCategories` gains `'validate'` as a valid value
- `RELIABLE_BENCHMARK_COUNT` promoted to named config value (default: `3`)
- `MIN_VALIDATOR_SCORE` added to config (default: `0.6`)
- `VALIDATION_RETRY_BUDGET` added to config (default: `1`, meaning one retry after initial failure)
- No DB schema changes — trio is in-memory; fixture candidates stored as a JSON file

### 13. Free model benchmark parity

`getBestFreeModel` is updated to read task-category scores from `ModelRegistry` (the same source as `getBestLocalModel`) rather than `modelsDbService.getDatabase()`. `modelsDbService` lookup for selection purposes is deprecated; `ModelRegistry` becomes the single source of truth across all providers.

## Testing Decisions

Good tests assert observable behaviour from controlled input. Tests seed a minimal `ModelRegistry`, inject mock providers, and do not call real model APIs.

**Modules to test:**

- **`OutputValidator`**: mock provider returning clean YES/NO → assert `passed` and `parsed_cleanly: true`. Mock provider returning prose → assert keyword fallback fires. Mock provider throwing → assert graceful skip (no error thrown).
- **`getBestValidatorModel`**: seed registry with models at varying `validationScore` and benchmark counts; assert confidence-blended selection. Assert `null` returned when all below `MIN_VALIDATOR_SCORE`. Assert generation model excluded from external validator candidates.
- **Self-validation gate**: mock local model saying NO to its own output → assert external validator not called, retry dispatched immediately. Mock local model saying YES → assert external validator called.
- **Ranked trio composition**: seed registry with 1, 2, and 3+ models in a tier; assert `fallback_notice` present when < 3 distinct models; assert tier homogeneity.
- **Free-tier ranking**: seed two free models from the same provider near rate limit and one from a different provider; assert provider-diverse model ranked higher.
- **`benchmarking_recommended`**: route with an unbenchmarked model in all three trio slots; assert all three appear in the array. Route with all well-benchmarked; assert field absent.
- **`rate_model` tool**: call with `role: 'validator'`, `outcome: 'negative'`; assert `scores.validate` decreases and a fixture candidate is written. Call with `role: 'generator'`, `outcome: 'positive'`; assert `qualityScore` increases.
- **EMA reputation**: call `OutputValidator` with unparseable responses; assert `validationScore` drifts down toward 0 across repeated calls.
- **Retry loop**: mock "good" model failing self-validation; assert "better" model is dispatched without external validator call. Mock "good" passing self, failing external; assert "better" dispatched. Mock all three failing; assert `validation.passed: false` returned.
- **`validate` fixture scoring**: fixture ground truth = 'bad', model says NO → score 1.0. Model says YES → score 0.0.

Prior art: existing `benchmarkService` and `modelSelector` unit tests demonstrate the registry-seeding pattern to follow.

## Out of Scope

- Validator-repairs-output: the validator judges only; repair is always retry-as-repair with a different generation model.
- Async/non-blocking validation: skipped due to resource concerns on older machines. Validation is sync and blocking.
- Multi-turn validation loops beyond the configured `VALIDATION_RETRY_BUDGET`.
- Validation of non-code outputs (chat, long-context) in this iteration.
- Automatic promotion of fixture candidates to authoritative set — human review required.
- UI or dashboard changes to expose validation telemetry.
- Changes to the existing `codeEvaluationService` heuristic path.
- Language-specific syntax checking via the existing TypeScript-only `CodeValidator`.
- A `promote_fixture` MCP tool — deferred to a follow-on PRD.

## Further Notes

**`codeEvaluationService.getCodeValidationOptions()`** is the closest existing analogue to `getBestValidatorModel`. It is disconnected from the routing path. This PRD does not remove it; the new modules should be designed so it can eventually delegate to them.

**Cost accounting**: `validation` metadata returned to the caller should include estimated token cost of both self-validation and external validation calls so the orchestrator can account for them.

**Real-world trigger**: this PRD was created after a live test in which `meta-llama/llama-3.2-3b-instruct:free` (zero benchmark runs) was routed a Python code-generation task, produced output with a broken `__main__` guard and missing punctuation stripping, and required Sonnet intervention to correct — the exact scenario this feature is designed to prevent. The `__main__` case is fixture #1 in the seed set.

**`stale jobs.db` bug found during testing**: the original `jobs.db` had a schema predating the `task_id` column, causing `initJobStore()` to fail silently on startup (`SQLITE_ERROR` from `CREATE INDEX … ON jobs(task_id)`). Fixed by deleting the stale DB. A follow-on hardening task should split the `db.exec()` DDL block into individual statements so a stale schema does not silently disable the entire job store.
