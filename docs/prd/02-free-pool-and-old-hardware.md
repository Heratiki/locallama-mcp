# PRD 02 — Free Pool and Old Hardware (G7 + G8)

_Status: DRAFT — needs maintainer rulings. 2026-11-01. Goals G7 and G8 of
`docs/prd/00-goals-roadmap.md`. Facts: `docs/research/free-model-landscape-2026-11-01.md`
(cited as "R1 Part 1" and "R1 Part 3"). Format follows
`docs/prd/01-verified-patch-and-grind-loop.md` (PRD 01)._

This draft makes no ruling. Every choice that belongs to the maintainer is a
numbered question in §12. Where the text says "proposed", the proposal waits
for the answer in §12.

## 1. Summary

PRD 01 gives LocalLama a grind loop. A long grind run needs many model calls.
One free tier cannot supply them, and an old laptop cannot run them fast.
This PRD closes two gaps.

**G7 — Free pool.** LocalLama adds more free online providers next to the
OpenRouter free tier. Each provider has its own limits, read from its own
docs. A quota tracker counts the calls. When every free tier is at its limit,
the patch Job waits for the next window. It does not fail. The task status
shows when the Job runs again.

**G8 — Old hardware.** LocalLama detects the machine and picks a profile.
The profile sets timeouts, context sizes, the local model and the runtime
flags for the hardware floor (Ruling 9: 8 GB RAM, no usable GPU). One install
command sets this up. A first-run check says what the machine can do.

## 2. Rulings this PRD obeys

From `docs/prd/00-goals-roadmap.md`, Rulings 1-9, and from PRD 01:

- **Ruling 3:** paid spend is off by default. No G7 provider is paid.
- **Ruling 9:** every "done when" line also passes on the 8 GB CPU-only machine at $0.
- **PRD 01 R-D:** the patch worker calls providers through `ProviderRegistry`.
  G7 adds providers to that registry and changes no other call path.
- **PRD 01 §5.5:** the patch ladder is local, then free, then paid. G7 and
  G8 keep this order.
- **PRD 01 §6 (safety):** unchanged. G7 and G8 add no write to the user's tree.

No new ruling is made here.

## 3. Scope

In scope:

- A generic OpenAI-compatible free provider and a descriptor file for each free tier (G7).
- A quota tracker with per-minute, per-day and per-token windows (G7).
- 429 handling that does not trip the circuit breaker (G7).
- The patient wait for patch Jobs, and its status fields (G7).
- A privacy flag and a warning for tiers that use or review prompts (G7).
- Hardware detection, profiles, a model pull helper and a first-run check (G8).
- Floor defaults for timeouts, contexts and runtime flags (G8).

Out of scope:

- Any paid provider, and any paid override change (PRD 01 §5.11).
- Free coding tools in R1 Part 2. They are clients (Ruling 8), not providers.
- Cerebras, Together, Hugging Face, GitHub Models, Mistral, NVIDIA and Cohere.
  R1 "Left out and why" gives the reasons. Re-check R1 before any is added.
- The route path (`route_task`). Its provider selection does not change.
- A container backend, the G4 DAG and the G1 read surface.

## 4. Today's code

The code facts below came from reading the source on 2026-11-01.

| Area | File and symbol | Fact |
|---|---|---|
| Provider contract | `src/modules/core/provider/types.ts`: `LLMProvider`, `CostClass`, `TaskExecutionOptions`, `hasRateLimitBudget?()` | `CostClass` is `local`, `free` or `paid`. `signal` and `timeoutMs` exist in options. |
| Registry | `src/modules/core/provider/registry.ts`: `ProviderRegistry.register`, `initAll`, `executeWithConcurrencyLimit`, `recordProviderFailure` | Registers providers. Runs calls through `ProviderRateLimiter`. Failures feed the circuit breaker. |
| Concurrency | `src/modules/core/provider/rate-limiter.ts`: `ProviderRateLimiter.schedule` | Counts concurrent calls only (`PROVIDER_MAX_CONCURRENT_LOCAL`, `PROVIDER_MAX_CONCURRENT_REMOTE`). It knows no per-minute or per-day quota. |
| Breaker | `src/modules/core/provider/circuit-breaker.ts`: `CircuitBreaker` | Opens after 3 consecutive failures. Resets after 60 000 ms. A 429 counts as a failure today. |
| Local lifecycle | `src/modules/core/provider/local-runtime-lifecycle.ts`: `localProviderLifecycle.beforeExecution` | Calls `releaseResources` on a model switch. |
| Registration | `src/index.ts` (around the `registry.register(...)` lines) | LM Studio, Ollama and llama.cpp always register. OpenRouter registers only with `OPENROUTER_API_KEY`. |
| Only free provider | `src/modules/openrouter/provider.ts`: `OpenRouterProvider` | `costClass` is `paid`. With `OPENROUTER_FREE_ONLY` it lists only zero-cost models. It keeps its own `callTimestamps` window from `OPENROUTER_RATE_LIMIT_PER_MINUTE`. No per-day count. `hasRateLimitBudget()` needs 2 free calls in the window. |
| OpenRouter module | `src/modules/openrouter/index.ts`: `openRouterModule.getFreeModels`, `executeTask` | Maps HTTP 429 to an error message. It does not return `Retry-After` to the caller. |
| llama.cpp | `src/modules/llama-cpp/provider.ts`: `LlamaCppProvider`; `manager.ts`: `LlamaServerManager.spawnServer` | `releaseResources` is a no-op. Flags come from `LLAMA_CPP_SERVER_FLAGS`. `LLAMA_CPP_MAX_CTX` caps the context. Start-up wait is `LLAMA_CPP_STARTUP_TIMEOUT_MS` (120000). |
| Config | `src/config/index.ts`: `config.providerTimeoutMs` (120000), `config.ollamaTimeout` (120 s), `config.patchInferenceTimeoutMs` (900000), `config.patchLocalModels`, `config.patchFreeModels`, `config.openRouterFreeOnly` | Defaults assume a GPU, except the patch inference timeout. |
| Patch ladder | `src/modules/patch/ladder/build.ts`: `buildLadder`; `policy.ts`: `hasBudgetNow` | Lists every available provider. A model with price 0 goes to the free list. Ranks by the `code` score of `ModelRegistry`. A model with no score ranks last. `hasBudgetNow` makes the worker skip a free provider with no budget. It never waits. |

Two gaps follow from this table.

1. There is no per-day or per-token quota anywhere. The only guard is one
   per-minute window inside `OpenRouterProvider`.
2. The ladder ranks by `code` score. A new free model has no score. It would
   rank last, behind every local model. The pool would stay unused.

## 5. Flow

### 5.1 Free call (G7)

1. The worker takes the next ladder entry (PRD 01 §5.5).
2. The worker asks the quota tracker (§6.2) for the entry's provider.
3. Budget exists: the call goes through `ProviderRegistry.executeWithConcurrencyLimit`.
4. The provider counts the call in the tracker before it sends the request.
5. The reply gives usage and rate headers. The tracker records them (§6.2).
6. HTTP 429: the provider reads `Retry-After` when it exists. The tracker
   blocks that provider until that time. The call is a "quota" outcome, not a
   failure. The circuit breaker does not count it (§6.3).

### 5.2 Patient wait (G7)

1. The worker finds no ladder entry with budget now. Local entries count.
2. Proposed order (Ruling Q3 sets it): try the next entry of the same cost
   class, then local entries, then wait.
3. To wait, the worker writes `wait_until` and `wait_reason` to `patch_state`.
   The Job status stays `in_progress`.
4. The worker sleeps until the soonest window opens. A cancel wakes it.
5. After the wake-up, the worker goes to §5.1 step 1.
6. A wait does not use an attempt. A wait does count against the deadline of
   PRD 01 §5.5 (`PATCH_TASK_TIMEOUT_MS`), unless Q3 rules otherwise.
7. After a restart, the dispatcher (PRD 01 §5.7) resumes the Job. The tracker
   reloads its windows from `jobs.db` (§6.2), so the wait stays correct.

### 5.3 Setup and first run (G8)

1. The user runs the install command (§7.5).
2. Setup detects the hardware (§7.1) and picks a profile (§7.2).
3. Setup checks the runtime. It offers to fetch the profile's local model (§7.3).
4. Setup writes the profile's values to `.env` for keys that the user did not set.
5. The first-run check runs a short real request and reports (§7.4).
6. The profile applies at each start. A key in `.env` always wins.

## 6. Components — G7

### 6.1 Free provider and descriptors

New module `src/modules/free-pool/`.

- `OpenAICompatProvider implements LLMProvider`. It has `costClass = 'free'`
  and `isLocal = false`. It posts to `{baseUrl}/chat/completions` with a
  bearer key. It uses the same `raceAbort` and `signal` helpers as
  `OpenRouterProvider` (`src/modules/core/provider/types.ts`).
- `getCost(modelId)` returns `{ prompt: 0, completion: 0 }`. Then
  `buildLadder` puts every listed model on the free list (`priceOf` in
  `src/modules/patch/ladder/build.ts`).
- `listModels()` returns only the models named in the descriptor's
  `models` list. A model that is not named is never listed. This filter
  keeps paid-only models out (R1 Part 1: Cloudflare paid-only list, Gemini
  models that are not on the free tier).
- One descriptor per provider in `src/config/free-providers.json`. It copies
  the shape of `src/config/provider-compat.json` and `models.json`.

Descriptor fields:

| Field | Meaning |
|---|---|
| `id`, `displayName` | Provider id, for example `groq` |
| `baseUrl` | OpenAI-compatible base URL (from R1 Part 1) |
| `keyEnv` | Name of the env var with the key, for example `GROQ_API_KEY` |
| `models[]` | `{ id, contextWindow }` for each free model that LocalLama may use |
| `limits` | `{ rpm?, rpd?, tpm?, tpd?, neuronsPerDay? }`. A field that R1 marks `not published` is absent. |
| `dayReset` | When the day window resets: `{ tz }` or `rolling` |
| `dataUse` | `none_stated`, `may_train_or_review` or `unconfirmed` (§6.4) |
| `sourceUrl`, `checkedAt` | The doc page and the date of the facts |

Each limit value comes from R1 Part 1 and nowhere else. The values stay in
the descriptor file. This PRD does not copy them. An absent limit means
"unknown": the tracker then relies on 429 replies only (§6.2).

`src/index.ts` registers each provider whose `keyEnv` is set, next to the
OpenRouter block. A provider with no key does not register.

**Ranking fix.** `buildLadder` ranks free models by the `code` score. New
free models have no score, so they rank last. Proposed: `buildLadder` keeps
the top `PATCH_FREE_MODELS` models per provider before it merges, and the
descriptor may carry a `codeScoreHint`. A model with no score keeps the rank
rule of PRD 01 §5.5 inside its provider. This needs a ruling (Q10). Until then the ladder rules of PRD 01 apply.

**OpenRouter.** `OpenRouterProvider` keeps its `costClass = 'paid'` and its
free-only guard. Its `callTimestamps` window moves into the tracker (§6.2).
`OPENROUTER_RATE_LIMIT_PER_MINUTE` stays as an override of the descriptor
value. R1 Part 1 gives 20 requests/min and 50 requests/day for an account
with less than 10 credits bought. The OpenRouter descriptor holds these.

### 6.2 Quota tracker

New file `src/modules/free-pool/quota-tracker.ts`: `QuotaTracker`.

- Keys: provider id (and model id where the limit is per model).
- Windows: per minute (sliding), per day (fixed reset from `dayReset`), and
  per token for `tpm` and `tpd`. A provider with `neuronsPerDay` and no
  per-model neuron rate is tracked by request count only, plus 429 replies.
  R1 says tokens per Neuron are `not published`.
- API:
  - `hasBudget(providerId, modelId, estTokens): boolean`
  - `reserve(providerId, modelId, estTokens): void`
  - `record(providerId, modelId, usage)`: actual tokens from the reply
  - `block(providerId, untilMs, reason)`: from a 429 and `Retry-After`
  - `nextWindowAt(providerId): number | null`: when budget returns
  - `snapshot(): ProviderQuotaView[]`: for status output
- Persistence: a new additive table `quota_usage` in `jobs.db`
  (`CREATE TABLE IF NOT EXISTS`, as PRD 01 §5.6 does). Columns:
  `provider_id`, `model_id`, `window`, `window_start`, `count`, `tokens`,
  `blocked_until`. Day counts must survive a restart, or a restart would
  spend a quota twice.
- `OpenAICompatProvider.hasRateLimitBudget()` and
  `OpenRouterProvider.hasRateLimitBudget()` call `hasBudget`. The existing
  hook in `LLMProvider` stays the single seam. `hasBudgetNow` in
  `src/modules/patch/ladder/policy.ts` keeps working.
- Safety margin: the tracker keeps a reserve below each published limit
  (today `OpenRouterProvider` keeps 2 calls). The size of the reserve is a
  setting, not a number from R1.

### 6.3 429 and the circuit breaker

Today a 429 raises an error. `ProviderRegistry.recordProviderFailure` counts
it. Three of them open the breaker for 60 000 ms. This is wrong for a quota.

- The free provider throws a typed `QuotaExceededError` with `retryAfterMs`.
- `ProviderRegistry` does not call `recordProviderFailure` for it. It calls
  `QuotaTracker.block` instead.
- Other errors (5xx, timeouts, 401/403) still feed the breaker.
- A 401 or 403 marks the provider "key rejected". The ladder skips it until
  restart, and the status says why.

Files: `src/modules/core/provider/registry.ts`, `types.ts`,
`src/modules/openrouter/index.ts` (return the `Retry-After` header).

### 6.4 Data-use warning

R1 Part 1 says: the Gemini free tier lets Google use the content to improve
its products, and human reviewers may read it. R1 lists most other
providers' terms as `unconfirmed`. The patch task sends repo code.

- The descriptor field `dataUse` records the fact. Only R1 may set
  `may_train_or_review`. A provider with `unconfirmed` stays `unconfirmed`.
- A provider with `dataUse != none_stated` does not join the ladder until
  the operator acknowledges it (Q2 sets the rule and the wording).
- The acknowledgement is one setting per provider. Proposed name:
  `FREE_POOL_ACK_<ID>=true`.
- The warning shows in three places: at start-up (log), in the `patch_task`
  tool description, and in the first-run check (§7.4). The text names the
  provider and says that it may use or review prompts.
- The patch result lists the providers that handled the prompts
  (`models[].provider_id`, PRD 01 §5.1). The client can show them.

### 6.5 Patient queue — worker and status

New file `src/modules/patch/worker/quota-wait.ts` (the worker is PRD 01 issue 9;
this file is a helper it calls).

- `waitForBudget(ladder, cursor, tracker, signal)`: returns the next usable
  ladder index, or sleeps until `tracker.nextWindowAt(...)` and tries again.
- It writes `wait_until` and `wait_reason` to `patch_state` through the
  job-store, so the status survives a restart.
- Additive columns on `patch_state`: `wait_until INTEGER`, `wait_reason TEXT`.
  Written with `ALTER TABLE` in the same style as PRD 01 §5.6.
- It wakes on cancel (`AbortController`, PRD 01 §5.10).
- `get_task_status` adds to the patch part: `waiting: { until, reason,
  providers: [{ id, next_window_at }] }`. It is `null` when the Job is not
  waiting. The response stays short (G6).
- A Job that waits and passes the deadline ends with `budget_time` as today.
  Q3 asks whether the deadline pauses during a wait.
- `hasBudgetNow` (PRD 01 §5.5, "no wait") changes: the worker now waits when
  nothing else can run. This replaces the skip in PRD 01 §5.5 step 2 for
  the case "all entries skipped".

### 6.6 Tests (G7)

- Tracker windows with a fake clock: minute slide, day reset, token windows, restart reload.
- A fake provider that returns 429 with and without `Retry-After`.
- The breaker does not open on 429 and does open on 5xx.
- A ladder with three fake free providers and one local model: the worker moves across providers and waits when all are blocked.
- A cancel during a wait ends the Job `cancelled`.
- A descriptor with an absent limit does not break the tracker.

## 7. Components — G8

### 7.1 Hardware detection

New module `src/modules/hardware/`: `detectHardware()`.

- RAM total and free: Node `os.totalmem()` and `os.freemem()`.
- CPU: `os.cpus()` count and model.
- GPU: a best-effort probe for a usable GPU or iGPU (for example
  `nvidia-smi`, `rocm-smi`, or `vulkaninfo` when they exist). The probe never
  fails setup. Unknown means "no usable GPU".
- llama.cpp build: whether `llama-server` exists (`LLAMA_CPP_SERVER_BIN`) and
  its version string. R1 says LFM3 needs a build with LFM3 support.
- Ollama: whether the `OLLAMA_ENDPOINT` answers.
- It returns a plain `HardwareReport`. It makes no network call.

### 7.2 Profiles

New file `src/config/hardware-profiles.json`. Each profile is a set of
defaults. The floor profile is `cpu-8gb`.

A profile sets (config keys that exist today are in code font):

| Setting | Floor profile intent |
|---|---|
| `config.providerTimeoutMs`, `config.ollamaTimeout` | Long. The 120 s default is too short for slow tokens. `config.patchInferenceTimeoutMs` already defaults to 900000. |
| `LLAMA_CPP_STARTUP_TIMEOUT_MS` | Longer than 120000 for a cold CPU load. |
| `LLAMA_CPP_MAX_CTX` and `PATCH_CONTEXT_TOKENS` | Small. |
| `LLAMA_CPP_SERVER_FLAGS` | CPU flags, and one resident model (for the router: a limit of 1 model). |
| `PATCH_LOCAL_MODELS` | 1, so one local model is in RAM (Ruling 9, PRD 01 §7). |
| `PROVIDER_MAX_CONCURRENT_LOCAL` | 1 (already the default). |
| Default local model | One entry of R1 Part 3. Q4 picks it. |

The tables give intent, not numbers. R1 publishes no CPU speed, so
timeouts and context sizes are set from the measurement in §7.4 (Q6).

Resolution order: explicit `.env` key, then profile, then built-in default.
`src/config/index.ts` applies this order. It never overwrites a user key.
Profile choice: automatic from `HardwareReport`, with `LOCALLAMA_PROFILE` as
an override. Profile names beyond `cpu-8gb` are a maintainer choice (Q4).

### 7.3 Local models and the pull helper

R1 Part 3 lists candidate models and their official GGUF files:

- Granite 4.2 3B, Q4_K_M, 2.24 GB.
- LFM3-1.7B, Q4_K_M, 1.10 GB. Needs a new llama.cpp build. Custom licence.
- Gemma 4 E2B-it QAT Q4_0, 3.35 GB.
- Granite 4.2 8B (5.35 GB) and Gemma 4 E4B (5.15 GB) are "tight on 8 GB".

R1 gives no RAM need and no CPU tokens per second for any model. The cards
state file sizes only. LocalLama must measure speed on the target machine.

- A helper `locallama models pull <profile|model>` downloads a GGUF from the
  vendor repo named in the profile. It checks the file size and a hash.
- It never downloads without a yes from the user. It shows size and licence first.
- Each profile entry records: repo, file, size, licence name and
  `checkedAt`. For a custom licence (LFM3), the helper prints the licence
  name and the link and asks for a yes (Q8).
- llama.cpp loads the file through the existing discovery
  (`src/modules/llama-cpp/discovery.ts`, `LLAMA_CPP_MODEL`). No new runtime path.
- The profile's ladder hint tells `buildLadder` to prefer the profile model.
  The model also needs a `code` score in `ModelRegistry`, or the ranking
  fix of §6.1 applies. Today a model with no score ranks last (`scoreOf` in
  `src/modules/patch/ladder/build.ts`).

### 7.4 First-run check

A command `locallama doctor` (and the same logic behind an MCP read, so a
client can ask). It runs on the install and on demand.

1. Report the hardware (§7.1) and the profile.
2. Check each runtime: reachable, version, the model that is loaded.
3. Warn when the runtime can keep more than one model in RAM (PRD 01 §7
   promised this warning).
4. Run one short generation on the local model. Measure tokens per second
   and time to the first token. This gives the CPU number that R1 lacks.
5. For each free provider whose key is set: a one-call probe, then show the
   remaining quota as the tracker sees it. Show the §6.4 warning for each
   provider with a data-use flag.
6. List what the machine can do. Q6 sets the report shape.
7. The check changes no file except an optional write of the measured speed
   to `~/.locallama` (or `config.rootDir`), so the profile can use it.

### 7.5 Install

One command that detects, pulls, writes config and runs the check. The
method is the maintainer's choice (Q5). The command never needs a paid
account. It never installs a runtime without a yes from the user.

### 7.6 Tests (G8)

- `detectHardware` with mocked `os` and mocked probe commands.
- Profile resolution: a `.env` key beats the profile; the profile beats the default.
- The pull helper with a fake HTTP server: size check, hash check, abort on mismatch.
- The first-run check with a fake provider: the report has every section.
- The floor test of PRD 01 §7 repeats here: llama.cpp with `-ngl 0` and an 8 GB limit
  (`systemd-run --user --scope -p MemoryMax=8G`). The report names it a simulation.

## 8. Safety

- Provider keys come from the environment only. They never go in a prompt, a
  log line, a Job row or a check's env (PRD 01 §5.4).
- The quota tracker never logs a key.
- A provider with a data-use flag does not receive repo content until the
  operator acknowledges it (§6.4).
- The pull helper downloads only from the repo URL in the profile. It writes
  only in the models directory. It checks size and hash.
- The install command makes no system-wide change without a yes.
- The free pool adds no write to the user's working tree (Ruling 2).

## 9. Docs that change with the code

- `CONTEXT.md`: Free Pool, Quota Window, Quota Tracker, Hardware Profile, Doctor.
- `wiki/10-glossary.md`: short entries that point to `CONTEXT.md`.
- New wiki pages: `wiki/13-free-pool.md` and `wiki/14-old-hardware.md`. Links from `wiki/README.md`.
- `.env.example`: one key and one acknowledgement per provider; `LOCALLAMA_PROFILE`.
- `docs/lightweight-models.md`: point to the profile model list.
- ADR `docs/adr/0005-free-pool-quota-tracker-and-patient-wait.md`.
- ADR `docs/adr/0006-hardware-profiles.md`.
- `docs/OPERATIONAL_TEST_PLAN.md`: the live G7 and G8 runs.
- R1 refresh: repeat the research lane before each G7 wave (roadmap, R1).

## 10. Acceptance criteria

G7:

1. Each provider in the first wave (Q1) registers when its key is set, and not otherwise.
2. A fake free provider's listed models are only the models in its descriptor.
3. A listed free model has price 0 in `priceOf`, so `buildLadder` puts it on the free list.
4. The tracker enforces per-minute, per-day and per-token windows with a fake clock.
5. A day count survives a restart.
6. A 429 with `Retry-After` blocks the provider until that time and does not open the circuit breaker.
7. A 5xx and a timeout still open the breaker as today.
8. A provider with `dataUse != none_stated` is not on the ladder until acknowledged. A provider with `none_stated` needs no acknowledgement.
9. With every free provider blocked and no local model, the patch Job waits. `get_task_status` shows `waiting.until` and the provider list.
10. After a restart during a wait, the Job resumes and the wait time stays right.
11. `cancel_task` during a wait ends the Job `cancelled` at once.
12. A wait does not use an attempt (§5.2).
13. **Live:** a grind run that needs more requests than one free tier allows per day finishes at $0 with `cost_usd = 0`. It moves across providers and waits for quota. The report lists calls per provider.

G8:

14. `detectHardware` returns RAM, CPU count, GPU status and runtime status on Linux. A failed probe never throws.
15. On a machine of 8 GB RAM or less with no usable GPU, the profile is `cpu-8gb` and the config shows its values.
16. A `.env` key beats the profile value (test).
17. `locallama models pull` refuses a hash or size mismatch, and asks before it downloads.
18. `locallama doctor` reports hardware, runtimes, measured tokens per second, free provider status and the data-use warnings.
19. With a runtime that can keep many models resident, `doctor` warns (PRD 01 §7).
20. **Live floor test:** on an 8 GB, CPU-only machine (or the simulation of §7.6), with no API key, a fresh install finishes the PRD 01 seed request with a passing diff. It uses only local and free models. The report states RAM peak and time.

All: `npx tsc --noEmit` passes; the full suite passes; every new module has unit tests.

## 11. Issues (wave order)

Each issue owns its paths. Issues in one wave own disjoint paths. `src/index.ts`
and `src/config/index.ts` change in one issue each (issues 1 and 9). This PRD
depends on PRD 01 issues 1, 6 and 9 for the types, the job store and the worker.

| # | Issue | Owns | Wave |
|---|---|---|---|
| 1 | Contracts: `FreeProviderDescriptor`, `QuotaView`, `HardwareReport`, `HardwareProfile`, config keys (profile, acknowledgements) | `src/modules/free-pool/types.ts`, `src/modules/hardware/types.ts`, `src/config/index.ts`, `.env.example` | 1 |
| 2 | Docs: terms, glossary, ADRs 0005 and 0006 | `CONTEXT.md`, `wiki/10-glossary.md`, `docs/adr/0005-*`, `docs/adr/0006-*` | 1 |
| 3 | Quota tracker and `quota_usage` table | `src/modules/free-pool/quota-tracker.ts`, `src/modules/job-store/quota*`, their tests | 2 |
| 4 | `QuotaExceededError`, breaker bypass for 429, `Retry-After` from OpenRouter | `src/modules/core/provider/registry.ts`, `src/modules/core/provider/circuit-breaker.ts`, `src/modules/openrouter/index.ts`, their tests | 2 |
| 5 | `OpenAICompatProvider` and descriptor loader (first-wave descriptors) | `src/modules/free-pool/provider.ts`, `src/modules/free-pool/descriptors.ts`, `src/config/free-providers.json`, their tests | 2 |
| 6 | Hardware detection and profile resolution | `src/modules/hardware/**`, `src/config/hardware-profiles.json`, their tests | 2 |
| 7 | Model pull helper | `src/modules/hardware/pull/**`, `scripts/pull-model*`, their tests | 2 |
| 8 | `patch_state.wait_*` columns; `quota-wait` helper; ladder ranking fix | `src/modules/patch/worker/quota-wait.ts`, `src/modules/patch/ladder/**`, `src/modules/job-store/patch-wait*`, their tests | 3 (after 3-5) |
| 9 | Wire-up: register providers, apply profile, `waiting` in `get_task_status`, data-use warning in the tool text | `src/index.ts`, `src/modules/api-integration/tool-definition/index.ts`, `src/modules/api-integration/routing/index.ts`, their tests | 4 (after 5-8) |
| 10 | `locallama doctor` and the install command | `src/cli/**` (or the path the Q5 answer sets), `scripts/install*`, their tests | 4 (after 6, 7) |
| 11 | Live runs: G7 grind past one tier, G8 floor test, wiki pages | `scripts/free-pool-live/**`, `wiki/13-free-pool.md`, `wiki/14-old-hardware.md`, `wiki/README.md`, `docs/OPERATIONAL_TEST_PLAN.md`, `docs/lightweight-models.md` | 5 (after 9, 10) |

Issue 1 lands first so wave-2 lanes build against the same contracts.
Issues 3 and 4 touch the provider path: run them one at a time.
Issue 5 needs the Q1 answer. Issues 6 and 7 need the Q4 and Q8 answers.

## 12. Rulings needed

Each question has options and one recommendation. The maintainer decides.

**Q1. Which free providers to add first.**
R1 "Takeaways" ranks five: OpenRouter `:free`, Groq, Gemini, Cloudflare Workers AI, SambaNova.
- A. Groq and Cloudflare Workers AI first, with OpenRouter already in place. Add SambaNova as reserve. Gemini waits for Q2. _(Recommended)_ Reason: R1 publishes limits for Groq and SambaNova, and Cloudflare publishes its Neuron allowance, so the tracker has real numbers; neither has the Gemini data-use problem. R1 marks Groq's and Cloudflare's code-use terms as `unconfirmed`, so the first wave still carries that risk.
- B. Groq only first. Reason: one new provider proves the tracker with the least work.
- C. All four new providers in one wave. Reason: widest pool, but more terms to check and more review work.

**Q2. Free tiers that use or human-review prompts (Gemini free tier).**
R1 says the Gemini free tier may use prompts to improve Google products and human reviewers may read them. Repo code is in the prompt.
- A. Add the provider but off by default. The operator sets an acknowledgement per provider. A warning shows at start-up, in the tool text and in `doctor`. _(Recommended)_ Reason: the free pool grows for people who accept the trade, and nobody is opted in by accident.
- B. Do not add any provider with this term. Reason: the safest choice, but the pool loses the 1M-token Gemini free model.
- C. Add it on by default with a warning only. Reason: simplest, but code can leave the machine before the user decides.

**Q3. Quota-wait behaviour.**
Three parts: the order when a tier is at its limit, whether the deadline pauses, and the longest wait.
- A. Next free provider, then local models, then wait. The deadline pauses during a wait. No cap on one wait; `max_minutes` still limits the task. _(Recommended)_ Reason: it matches the north star (a slow result that works) and keeps the Job alive across a day reset.
- B. Wait only when no free and no local entry has budget. The deadline keeps running. Reason: a clear time limit, but a day-reset wait would end most Jobs with `budget_time`.
- C. Fail fast with a diagnosis that shows when quota returns. Reason: simple, but it breaks the G7 done-when line.

**Q4. The default local model for the 8 GB CPU-only profile.**
R1 Part 3 gives these. R1 publishes no CPU speed for any of them.
- A. Granite 4.2 3B Q4_K_M (2.24 GB). _(Recommended)_ Reason: Apache-2.0, an official GGUF, LiveCodeBench v6 69.71, and R1 names it the best-sourced 3B choice.
- B. LFM3-1.7B Q4_K_M (1.10 GB). Reason: the smallest file and a high score, but it needs a new llama.cpp build and a custom licence.
- C. Gemma 4 E2B-it QAT Q4_0 (3.35 GB). Reason: a major vendor and Apache-2.0, but the lowest score of the three (LiveCodeBench v6 44.0%).

**Q5. The install method.**
- A. An npm package with a `locallama setup` command that runs the §5.3 flow. _(Recommended)_ Reason: the project is a Node MCP server, and clients already start it with `npx`.
- B. A shell script that installs Node, llama.cpp and the package. Reason: it needs fewer steps for a new user, but it touches the whole system.
- C. A container image. Reason: a clean setup, but old hardware may lack the RAM to spare for a container.

**Q6. How the first-run check reports.**
- A. A short text report in the terminal, and the same data as JSON through an MCP read. Show a "can do / cannot do" line per capability, with the measured tokens per second. _(Recommended)_ Reason: a person reads the text, and a client reads the JSON, from one source.
- B. Text only. Reason: the least work.
- C. A dashboard page. Reason: friendlier, but it needs the front door that Ruling 8 puts later.

A second part of Q6 (default A): the speed that `doctor` measures sets the timeouts and context size of the profile. Option: use fixed profile values and only report the speed.

**Q7. Which local runtime to support first on the floor.**
- A. llama.cpp (`llama-server`) first. Ollama stays supported as is. _(Recommended)_ Reason: PRD 01 §7 and the floor test already use llama.cpp with `-ngl 0`, and it needs no daemon.
- B. Ollama first. Reason: easier install for a new user, but `releaseResources` and model limits depend on Ollama's own settings.
- C. Both with equal support. Reason: widest reach, but twice the floor tests.

**Q8. Model download and licence policy.**
- A. The helper downloads only after an explicit yes. It shows size and licence first. A custom licence (LFM3) needs the user to read it and say yes. _(Recommended)_ Reason: no surprise download of 1-5 GB on a slow link, and the licence stays the user's decision.
- B. Ship only Apache-2.0 models in profiles. Reason: no licence prompt, but it drops LFM3 as a choice.
- C. Download on first run with no prompt. Reason: the fastest start, but it breaks the "no change without a yes" rule of §8.

**Q9. Where the provider limits live.**
- A. A static `src/config/free-providers.json` in the repo, each entry with `sourceUrl` and `checkedAt`. Maintainers update it with each R1 run. _(Recommended)_ Reason: R1 says free tiers change often, and a file under review is easy to audit.
- B. Fetch limits at run time from the provider. Reason: always fresh, but R1 shows that several providers publish no numbers on a page.
- C. Both: the file as the default, a runtime override from a user file. Reason: users fix a stale value fast, but it adds a second source of truth.

**Q10. The ranking of free models that have no `code` score.**
Today `buildLadder` ranks them last. §6.1 explains the gap.
- A. Keep the top N free models per provider before the merge, so every enabled provider gets a place on the ladder. _(Recommended)_ Reason: it needs no score data and it makes the pool real.
- B. Add a `codeScoreHint` for each model in the descriptor file. Reason: ranking by quality, but the maintainer must find scores that R1 does not publish for most models.
- C. Leave the ranking as is. Reason: no change, but new free models would rarely run.
