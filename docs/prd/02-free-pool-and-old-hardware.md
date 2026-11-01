# PRD 02 — Free Pool and Old Hardware (G7 + G8)

_Status: DRAFT revision 1 — after review; needs maintainer rulings. 2026-11-01.
Goals G7 and G8 of `docs/prd/00-goals-roadmap.md`. Facts:
`docs/research/free-model-landscape-2026-11-01.md` (cited as "R1 Part 1" and
"R1 Part 3"). Review: `docs/prd/02-review-2026-11-01.md`. Format follows
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

**Prerequisite: issue #147.** Issue #147 builds the patch dispatcher, the
`patch_task` tool and the seed fixtures. It is in progress. This PRD depends on
it. In this checkout the dispatcher, the tool and a production caller of
`PatchWorker` do not exist. `recoverInProgressJobs` skips patch Jobs. This
PRD assumes that #147 fixes these points. No PRD 02 build issue starts
before #147 merges. After #147 merges, the builder re-checks the §4 rows that
name the worker, the dispatcher and `recoverInProgressJobs`, and updates §4
if they differ.

## 3. Scope

In scope:

- A generic OpenAI-compatible free provider and a descriptor file for each free tier (G7).
- A quota tracker with durable reservations and per-minute, per-day and per-token windows (G7).
- One owner for breaker admission and outcome recording, and typed quota errors (G7).
- The patient wait for patch Jobs, its state machine and its status fields (G7).
- A privacy flag, an acknowledgement and a warning for tiers that use or review prompts, or whose terms are unknown (G7).
- Ladder selection across providers (G7).
- Hardware detection, profiles, calibration, a model pull helper and a first-run check (G8).
- Floor defaults for timeouts, contexts, health probes, residency and retrieval memory (G8).
- CLI and package assets for the install command (G8).

Out of scope:

- Any paid provider, and any paid override change (PRD 01 §5.11).
- Free coding tools in R1 Part 2. They are clients (Ruling 8), not providers.
- Cerebras, Together, Hugging Face, GitHub Models, Mistral, NVIDIA and Cohere.
  R1 "Left out and why" gives the reasons. Re-check R1 before any is added.
- The route path (`route_task`) selection logic. Its provider choice does not
  change. Its breaker accounting does change (§6.3), because one owner must
  record outcomes.
- A container backend, the G4 DAG and the G1 read surface.

## 4. Today's code

The code facts below came from reading the source on 2026-11-01. The review
of the same date confirmed or corrected them.

| Area | File and symbol | Fact |
|---|---|---|
| Provider contract | `src/modules/core/provider/types.ts`: `LLMProvider`, `CostClass`, `TaskExecutionOptions`, `hasRateLimitBudget?()` | `CostClass` is `local`, `free` or `paid`. `signal` and `timeoutMs` exist in options. `hasRateLimitBudget()` takes no argument: it knows no model and no token count. |
| Registry | `src/modules/core/provider/registry.ts`: `ProviderRegistry.register`, `initAll`, `isAvailable`, `recordProviderSuccess`, `recordProviderFailure`, `executeWithConcurrencyLimit` | `executeWithConcurrencyLimit` only schedules the call. It does not check the breaker and does not record the outcome. The breaker methods are public. |
| Breaker callers | `src/modules/api-integration/task-execution/index.ts` (`recordProviderFailure` on failure); `src/modules/core/provider/helpers.ts` (`recordProviderFailure`) | The route executor records every failure, a 429 too. The patch model path does neither admission nor recording. Three places touch the breaker, so one registry change cannot cover all callers. |
| Concurrency | `src/modules/core/provider/rate-limiter.ts`: `ProviderRateLimiter.schedule` | Counts concurrent calls only (`PROVIDER_MAX_CONCURRENT_LOCAL`, `PROVIDER_MAX_CONCURRENT_REMOTE`). It knows no per-minute or per-day quota. |
| Breaker | `src/modules/core/provider/circuit-breaker.ts`: `CircuitBreaker` | Opens after 3 consecutive failures. Resets after 60 000 ms. |
| Local lifecycle | `src/modules/core/provider/local-runtime-lifecycle.ts`: `localProviderLifecycle.beforeExecution` | Calls `releaseResources` on a model switch. |
| Registration | `src/index.ts` (around the `registry.register(...)` lines, and the model seeding loop after them) | LM Studio, Ollama and llama.cpp always register. OpenRouter registers only with `OPENROUTER_API_KEY`. After registration, the loop seeds the shared `ModelRegistry` from every registered provider's `listModels()`. |
| Only free provider | `src/modules/openrouter/provider.ts`: `OpenRouterProvider` | `costClass` is `paid`. With `OPENROUTER_FREE_ONLY` it lists only zero-cost models. It keeps its own `callTimestamps` window from `OPENROUTER_RATE_LIMIT_PER_MINUTE`. No per-day count. `hasRateLimitBudget()` needs 2 free calls in the window. |
| OpenRouter module | `src/modules/openrouter/index.ts`: `openRouterModule.getFreeModels`, `executeTask` | Maps HTTP 429 to an error message string. It does not return `Retry-After`. The provider sees a string, not a typed error. |
| llama.cpp | `src/modules/llama-cpp/provider.ts`: `LlamaCppProvider`; `index.ts`: `llamaCppModule.callApi`, `_runHealthProbe`; `manager.ts`: `LlamaServerManager.spawnServer` | `callApi` does not stream. `executeTask` discards usage. `releaseResources` is a no-op. `isAvailable` needs health `healthy` and at least one model. The health probe has its own timeout (`llamaCppHealthProbeTimeoutMs`) and marks thinking output as degraded. Flags come from `LLAMA_CPP_SERVER_FLAGS`. `LLAMA_CPP_MAX_CTX` caps the context. Start-up wait is `LLAMA_CPP_STARTUP_TIMEOUT_MS` (120000). |
| Config | `src/config/index.ts`: `config` and `buildConfigFromEnv`; `config.providerTimeoutMs` (120000), `config.ollamaTimeout` (120 s), `config.patchInferenceTimeoutMs` (900000), `config.patchLocalModels`, `config.patchFreeModels`, `config.openRouterFreeOnly` | `config` is built synchronously when the module loads. `LOCALLAMA_PROFILE` already exists: `lightweight` or `default`. Defaults assume a GPU, except the patch inference timeout. |
| Patch ladder | `src/modules/patch/ladder/build.ts`: `buildLadder`, `rank`; `policy.ts`: `hasBudgetNow`, `computeDeadline` | `buildLadder` ranks the local list and the free list separately, then joins them. An unscored free model does not compete with local scores. It ranks last inside the free list. `rank` removes duplicates by `model_id` alone, so a second provider that serves the same model is lost. `computeDeadline` uses `max_minutes` as the Job deadline. |
| Patch worker | `src/modules/patch/worker/index.ts`: `PatchWorker.runJob` | The loop advances the cursor past an entry with no budget, for good. It counts a dispatched call that ends in 429 as an attempt. It never waits. |
| Prompt builder | `src/modules/patch/prompt/builder.ts`: `buildPrompt` | Fill order: goal, hinted files, last errors and blocks (attempt 2 and later), BM25 results. A big hinted file can use the whole budget before the error text is added. |
| Retrieval | `src/modules/cost-monitor/codeSearch.ts`: `readCodeFiles` | Keeps the whole file and its chunks in memory. No memory ceiling. |
| Output validator | `src/modules/decision-engine/services/outputValidator.ts`: `OutputValidator.validate` | Can call a provider's `executeTask` directly, with no ladder. |
| Job store | `src/modules/job-store/db.ts`: `initJobStore` | Creates the tables. It has no hook for additive migrations from other modules. |
| Package | `package.json` (`bin`, `files`); `scripts/copy-assets.js` | `bin` has only `locallama-mcp`. `files` lists `dist/`, `ui.html` and `README.md`, so `src/config` JSON files do not ship. `copy-assets.js` copies one lock helper. |

Three gaps follow from this table.

1. There is no per-day or per-token quota anywhere. The only guard is one
   per-minute window inside `OpenRouterProvider`.
2. The ladder joins providers by model id. A model that two providers serve
   appears once. A provider with many scored models can fill the free cap.
   A provider with unscored models can lose every slot.
3. Three places own parts of the breaker, and the worker has no wait state.

## 5. Flow

### 5.1 Free call (G7)

1. The worker takes the next usable ladder entry (§5.2).
2. The worker asks the provider to reserve quota (§6.2). The reply is a
   reservation or a denial with `retryAt`.
3. With a reservation, the call goes through `ProviderRegistry.executeGuarded`
   (§6.3). That method checks the breaker, runs the call through
   `executeWithConcurrencyLimit`, and records the outcome.
4. The provider settles the reservation with the actual usage from the reply.
5. HTTP 429: the provider throws `QuotaExceededError` with `retryAfterMs`
   when `Retry-After` exists. The tracker blocks that provider until that time.
   The breaker does not count it. The worker does not count an attempt (§5.2).
6. A 401 or 403 throws `AuthRejectedError`. The provider is "key rejected"
   until restart.

### 5.2 Patient wait (G7)

The wait uses one clock: the Job's `deadline_at` (PRD 01 §5.5). No second
timer exists. A wait either leaves `deadline_at` as it is, or moves it later by
the length of the wait. Q3 chooses which. Both are stored in `patch_state`, so
a restart reads the same value.

**Entry states.** The worker keeps a state for each ladder entry:

| State | Meaning | Cursor |
|---|---|---|
| `usable` | Budget exists now. | May run. |
| `quota_blocked(until)` | Temporary. A window or a `Retry-After` closes the entry until `until`. | Does not advance. The entry stays in the ladder. |
| `too_large` | The estimated prompt is bigger than a token window of the entry (for example a per-minute token cap). It cannot fit now or later. | Skipped for this attempt only. Shorter context may fit later. |
| `key_rejected` | 401 or 403. | Skipped until restart. |
| `exhausted` | Attempts used up or the error signature repeated (PRD 01 §5.5). | Advances, as today. |
| `unavailable` | Provider missing, breaker open, or health not `healthy`. | Skipped. The breaker reset time counts as a wake time. |

Only `exhausted` moves the persisted cursor. The other states live in memory.
After a restart, the worker rebuilds them from the tracker (§6.2).

**Loop.**

1. The worker scans the ladder from the top. It picks the first `usable` entry
   that the order of Q3 allows. Local entries come first (PRD 01 §5.5).
2. If it finds one, it runs §5.1.
3. If no entry is `usable` and at least one is `quota_blocked` or
   `unavailable` with a known time, the worker waits (step 5).
4. If every entry is `exhausted`, `too_large` or `key_rejected`, the Job ends
   with the reason of PRD 01 §5.5 (`ladder_exhausted` or the existing reason).
   It does not wait for ever.
5. To wait, the worker writes `wait_until` and `wait_reason` to `patch_state`
   and, under a Q3 clock rule that pauses the deadline, the wait start time.
   The Job status stays `in_progress`.
6. **Wake selection.** `wait_until` is the soonest time among the blocked
   entries. At that time the worker scans the ladder from the top again. It
   does not resume at the entry that blocked.
7. **429 accounting.** A call that ends in 429 does not use an attempt. No
   `attempts` row is written. A different failure (5xx, timeout, bad output)
   uses an attempt, as today.
8. **Worker release.** A waiting Job does not hold the sole patch worker. Before
   the wait, the worker closes the search handles and the check processes. It
   keeps the workspace directory on disk. It returns the worker to the
   dispatcher. The dispatcher requeues the Job at `wait_until`. This needs a
   timed requeue in the #147 dispatcher. After #147 merges, the builder
   checks that the dispatcher supports it. If it does not, issue 10 adds it in
   a file that #147 does not own.
9. **Cancel.** `cancel_task` clears the timer and ends the Job `cancelled` at
   once (PRD 01 §5.10).
10. **Restart.** The dispatcher requeues each Job that has a `wait_until`. The
    tracker reloads its reservations from `jobs.db`. Reservations in the
    `reserved` state that have no live owner count as interrupted (§6.2).
11. **Deadline.** The stop check of PRD 01 §5.5 reads `deadline_at` as before.
    Under a pausing clock rule, the worker adds the wait length to `deadline_at`
    when the wait ends, and writes it in the same transaction as the wake.

### 5.3 Setup and first run (G8)

1. The user runs the install command (§7.5).
2. Setup detects the hardware (§7.1) and picks a profile (§7.2).
3. Setup checks the runtime. It offers to fetch the profile's local model (§7.3).
4. Setup writes the chosen profile name, and only the keys that the user did
   not set, to `.env`.
5. The first-run check runs a short streaming request, measures speed, and
   saves a calibration file (§7.4).
6. At each start, `config` reads the profile and the calibration without a
   network call (§7.2). A key in `.env` always wins.

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
| `baseUrl` | OpenAI-compatible base URL, or `null` when R1 does not give it (see below) |
| `keyEnv` | Name of the env var with the key, for example `GROQ_API_KEY` |
| `models[]` | `{ id, contextWindow }` for each free model that LocalLama may use. The array order is the maintainer's order inside the provider (§6.6). |
| `limits` | `{ rpm?, rpd?, tpm?, tpd?, neuronsPerDay? }`. A field that R1 marks `not published` is absent. |
| `dayReset` | `{ kind: 'tz', tz }`, `{ kind: 'rolling' }` or `{ kind: 'unknown' }` |
| `dataUse` | `none_stated`, `unknown` or `train_or_review` (§6.4) |
| `sourceUrl`, `checkedAt` | The doc page and the date of the facts |

Each limit value comes from R1 Part 1 and nowhere else. The values stay in
the descriptor file. This PRD does not copy them. An absent limit means
"unknown": the tracker then relies on 429 replies only (§6.2).

**Facts that R1 does not give.** The builder must not invent a fact. Four
descriptor facts are open:

| Provider | Field | R1 status | Descriptor value until checked |
|---|---|---|---|
| Cloudflare Workers AI | `baseUrl` | R1 says the models page lists "OpenAI compatible API endpoints". It gives no URL. | `null`. To confirm at build time from the provider's docs. The URL may need an account identifier. |
| SambaNova | `baseUrl` | R1: the base URL was not in the text read. `unconfirmed`. | `null`. To confirm at build time from the provider's docs. |
| Groq, SambaNova, OpenRouter | `dayReset` | R1 states no reset rule for the day count. | `{ kind: 'unknown' }`. To confirm at build time from the provider's docs. |
| Cloudflare, Gemini | `dayReset` | R1 gives 00:00 UTC for Cloudflare Neurons and midnight Pacific for Gemini. | `tz` from R1. |

Rules for open facts:

- A descriptor with `baseUrl = null` does not register. `doctor` and the
  start-up log say which field is missing.
- `dayReset = unknown` makes the tracker use a rolling day window (§6.2). That
  never over-spends.
- **Build-time check.** A script `scripts/check-free-descriptors.*` fails the
  build when a descriptor in the first wave (Q1) has `baseUrl = null`, no
  `sourceUrl`, no `checkedAt`, or `dayReset.kind = unknown` without a note in
  the descriptor that says "checked, the provider states no rule".
- **Research prerequisite.** Before issue 8 starts, one targeted R1 refresh
  lane reads the docs for the open rows above and writes the answers to R1.
  Builders copy only from that update.

`src/index.ts` registers each provider whose `keyEnv` is set and whose
descriptor passes the rules above, next to the OpenRouter block. A provider
with no key does not register.

**Consent inside the provider.** The provider enforces the acknowledgement
(§6.4) itself. It does not rely on the ladder.

**OpenRouter.** `OpenRouterProvider` keeps its `costClass = 'paid'` and its
free-only guard. Its `callTimestamps` window moves into the tracker (§6.2).
`OPENROUTER_RATE_LIMIT_PER_MINUTE` stays as an override of the descriptor
value. R1 Part 1 gives 20 requests/min and 50 requests/day for an account
with less than 10 credits bought. The OpenRouter descriptor holds these.

### 6.2 Quota tracker

New file `src/modules/free-pool/quota-tracker.ts`: `QuotaTracker`.

**Scope.** One key for each (provider id, model id) pair, and one for the
provider where the limit is per account.

**Contract.** The old `hasRateLimitBudget(): boolean` stays as a coarse hint
for the ladder (`hasBudgetNow`). It does not admit a call. A new optional
method on `LLMProvider` admits calls:

```ts
reserveQuota?(req: { modelId: string; estPromptTokens: number;
  maxOutputTokens: number; jobId?: string }): Promise<QuotaReservation | QuotaDenial>;
```

- `QuotaReservation`: `{ id, providerId, modelId, reservedTokens, createdAt }`.
- `QuotaDenial`: `{ reason: 'window' | 'blocked' | 'too_large', retryAt: number | null }`.
- `settleQuota(id, usage)`: records the actual tokens. Missing usage settles at
  the reserved amount.
- `releaseQuota(id)`: gives the reservation back. Only legal when the request
  never left the machine.

**Atomic admission.** `reserve` runs in one SQLite transaction
(`BEGIN IMMEDIATE`) on `jobs.db`. The transaction reads the window rows,
checks every limit (`rpm`, `rpd`, `tpm`, `tpd`), and writes the reservation
row. Two MCP server processes that share `jobs.db` take turns, so they cannot
both pass the same last slot. The database sets a busy timeout, and a busy
timeout failure is a `window` denial, not an admit.

**Token estimate.** `estPromptTokens` comes from the prompt builder's token
count of the real prompt. `maxOutputTokens` comes from the call options. The
reserved amount is the sum. If the reserved amount is bigger than a token
window (`tpm` or `tpd`), the denial is `too_large` with `retryAt = null`. The
Groq limits of R1 make this case real: R1 notes the 8K per-minute token cap is
small for agent loops.

**Durable rows.** Two additive tables in `jobs.db`, created with
`CREATE TABLE IF NOT EXISTS` (PRD 01 §5.6):

- `quota_reservation`: `id`, `provider_id`, `model_id`, `reserved_tokens`,
  `settled_tokens`, `state` (`reserved`, `settled`, `released`,
  `interrupted`), `created_at`, `settled_at`, `owner_pid`, `owner_boot`, `job_id`.
- `quota_block`: `provider_id`, `model_id`, `blocked_until`, `reason`.

One row per call lets the tracker compute an exact sliding minute window and
the day window. It does not use aggregate counters. The tracker deletes rows
older than the longest window it needs.

**Reconciliation.**

| Event | Result |
|---|---|
| Reply with usage | Settle at actual tokens. |
| Reply without usage | Settle at the reserved tokens. |
| Request failed before it was sent (local error, abort before send) | Release. Nothing counts. |
| Request sent, then error, timeout or cancel | Settle at the reserved tokens. The provider may have counted it. |
| 429 | Settle at the reserved tokens, then block until `Retry-After`. |
| Process died with a `reserved` row | At the next start, or when `owner_pid` and `owner_boot` show no live owner, mark `interrupted`. It counts at the reserved tokens. Nothing refunds it. |

The rule is conservative: an uncertain call counts as spent.

**Day window.** `dayReset.kind = tz` resets at midnight of that zone.
`rolling` and `unknown` count the rows of the last day, as a sliding window. A
provider with `neuronsPerDay` and no per-model Neuron rate is tracked by
request count only, plus 429 replies. R1 says tokens per Neuron are
`not published`.

**Safety margin.** The tracker keeps a reserve below each published limit
(today `OpenRouterProvider` keeps 2 calls). The size of the reserve is a
setting, not a number from R1.

**Status.** `nextWindowAt(providerId): number | null` and
`snapshot(): ProviderQuotaView[]` serve the wait (§5.2) and the status output.

### 6.3 Breaker ownership and typed errors

Today three places touch the breaker (§4). This PRD gives the breaker one owner:
`ProviderRegistry`.

- New method `ProviderRegistry.executeGuarded(provider, run, options)`. It
  1. checks the breaker (`isAvailable`) and throws a typed
     `ProviderUnavailableError` when the circuit is open;
  2. runs the call through `executeWithConcurrencyLimit`;
  3. records the outcome: success closes the circuit; a failure that counts
     calls `recordFailure`.
- Outcome rule: `QuotaExceededError` and `ConsentRequiredError` do not count.
  `AuthRejectedError` does not count either; it marks the provider
  "key rejected" (§5.1). 5xx, timeouts and network errors count.
- `recordProviderFailure` and `recordProviderSuccess` become internal to the
  registry. The callers in `api-integration/task-execution/index.ts` and
  `core/provider/helpers.ts` switch to `executeGuarded` and drop their own
  recording. The patch model path uses `executeGuarded`. `OutputValidator`
  reaches providers through the same path where it can; where it cannot, it is
  guarded by §6.4.
- The typed errors live in `src/modules/core/provider/types.ts`.
- OpenRouter: `openRouterModule.executeTask` returns structured fields
  (`errorKind`, `retryAfterMs`) next to the message. `OpenRouterProvider`
  throws the typed error from them. It no longer rethrows a string.

The breaker sets are unchanged: 3 failures open it, 60 000 ms resets it.

### 6.4 Data-use warning and acknowledgement

R1 Part 1 says: the Gemini free tier lets Google use the content to improve
its products, and human reviewers may read it. For most other providers, R1
says the terms are `unconfirmed`. `unconfirmed` means "not found". It does not
mean "the provider reviews prompts". The patch task sends repo code.

The descriptor field `dataUse` has three values:

| Value | Meaning | Source |
|---|---|---|
| `train_or_review` | A primary page says the provider may use or review the content. | Only R1 may set it. |
| `unknown` | R1 did not find the terms. | R1 marks it `unconfirmed`. |
| `none_stated` | A primary page states that the provider does not use the content. | R1 must name the page. No provider has it today. |

**Gate.** A provider that the gate covers has no models on the ladder, and
receives no prompt, until the operator acknowledges it. Q2 sets which values the
gate covers. The acknowledgement is one setting per provider. Proposed name:
`FREE_POOL_ACK_<ID>=true`.

**Where the gate acts.** The provider enforces it. It does not depend on the
ladder.

- `OpenAICompatProvider.isAvailable()` is false and `listModels()` is empty
  before the acknowledgement. The `ModelRegistry` seeding loop in `src/index.ts`
  then seeds nothing from it.
- `OpenAICompatProvider.executeTask()` throws `ConsentRequiredError` before it
  opens any network connection. This covers `OutputValidator.validate` and any
  other direct caller.
- `doctor` does not send a probe to a provider that needs an acknowledgement. It
  shows "not probed: acknowledgement missing".

**Warning text.** The text depends on the value:

- `train_or_review`: "`<provider>` may use or review your prompts."
- `unknown`: "The terms of `<provider>` on prompt use are not confirmed."

The warning shows in three places: at start-up (log), in the `patch_task` tool
description, and in the first-run check (§7.4). The patch result lists the
providers that handled the prompts (`models[].provider_id`, PRD 01 §5.1). The
client can show them.

### 6.5 Ladder selection across providers

`buildLadder` (`src/modules/patch/ladder/build.ts`) changes in these ways. The
rules below are the proposal for Q10.

- **Identity.** An entry is the pair (`provider_id`, `model_id`). `rank` removes
  duplicates of the pair, not of `model_id`. Two providers that serve the same
  model give two entries.
- **Per provider.** Inside each provider, rank by the `code` score of
  `ModelRegistry`. Break ties by the descriptor's `models[]` order. A model with
  no score ranks after every scored model of the same provider.
- **Merge.** The merge takes entries round-robin across providers: each
  provider's first entry, then each provider's second entry, and so on. The
  provider order is the registration order.
- **Final cap.** `PATCH_FREE_MODELS` caps the merged free list.
- **Guarantee.** If the cap is not smaller than the number of free providers
  that have at least one listed model, every such provider gets at least one
  entry. If the cap is smaller, the first providers in registration order win.
  The status shows which providers the cap cut.
- **Local list.** Unchanged. It is ranked and capped alone, as today.

The local and free lists never compete on score. An unscored free model never
ranks behind a local model, and it does not need a score to stay on the ladder.

### 6.6 Patient queue — worker and status

Files: `src/modules/patch/worker/quota-wait.ts` (new helper) and the changes to
`src/modules/patch/worker/index.ts` and `src/modules/patch/ladder/policy.ts`.
The worker is #147's. After #147 merges, issue 10 owns these edits (§11).

- `quota-wait.ts` implements the state machine of §5.2. It returns the next
  usable ladder index, or a wait with `wait_until`.
- It writes `wait_until` and `wait_reason` to `patch_state` through the
  job-store, so the status survives a restart.
- Additive columns on `patch_state`: `wait_until INTEGER`, `wait_reason TEXT`,
  `wait_started_at INTEGER`. They come from a migration (§11, issue 1 hook,
  issue 10 body), in the same style as PRD 01 §5.6.
- `get_task_status` adds to the patch part: `waiting: { until, reason,
  providers: [{ id, next_window_at }] }`. It is `null` when the Job is not
  waiting. The response stays short (G6).
- A Job that waits and passes `deadline_at` ends with `budget_time`, as today.
  Q3 sets whether the wait moves `deadline_at`.
- `hasBudgetNow` (PRD 01 §5.5, "no wait") stays a coarse skip hint. The worker
  replaces the permanent skip of PRD 01 §5.5 step 2 with the entry states of
  §5.2.
- The `max_minutes` field keeps its PRD 01 meaning: it sets `deadline_at` at
  submit. Under a pausing rule of Q3, it limits active time, not wall time.
  The tool description says this.

### 6.7 Tests (G7)

- Tracker windows with a fake clock: minute slide, day reset (`tz`, `rolling`,
  `unknown`), token windows, restart reload.
- Two tracker instances on one `jobs.db` (two processes): they cannot both take
  the last slot.
- Reconciliation: each row of the §6.2 table, including a killed process with a
  `reserved` row.
- A `too_large` denial when the prompt is bigger than a token window. The Job
  does not wait for ever.
- A fake provider that returns 429 with and without `Retry-After`.
- The breaker: no count on 429, 401, 403 and consent errors; a count on 5xx and
  timeouts. The route executor and the patch path both go through
  `executeGuarded`, and no call records twice.
- OpenRouter: a 429 reaches the registry as `QuotaExceededError` with
  `retryAfterMs`.
- Ladder: two providers serve the same model id; both stay. With cap at least
  the provider count, every provider keeps one entry. Unscored free models stay.
- A ladder with three fake free providers and one local model: the worker moves
  across providers and waits when all are blocked. The persisted cursor does not
  pass a `quota_blocked` entry.
- A 429 uses no attempt. A 5xx uses one.
- A cancel during a wait ends the Job `cancelled`.
- A restart during a wait: the Job resumes at `wait_until`; `deadline_at` holds
  the right value under both clock rules.
- A waiting Job frees the worker slot: a second Job runs during the wait.
- Consent: with the provider unacknowledged, `listModels()` is empty,
  `executeTask()` throws before any network call, `OutputValidator.validate`
  sends nothing, and `doctor` sends no probe.
- A descriptor with an absent limit, `baseUrl = null` or `dayReset = unknown`
  does not break the tracker or the loader.

## 7. Components — G8

### 7.1 Hardware detection

New module `src/modules/hardware/detect/`: `detectHardware()`.

- RAM total and free: Node `os.totalmem()` and `os.freemem()`.
- CPU: `os.cpus()` count and model.
- GPU: a best-effort probe for a usable GPU or iGPU (for example
  `nvidia-smi`, `rocm-smi`, or `vulkaninfo` when they exist). The probe never
  fails setup. Unknown means "no usable GPU".
- llama.cpp build: whether `llama-server` exists (`LLAMA_CPP_SERVER_BIN`) and
  its version string. R1 says LFM3 needs a build with LFM3 support.
- Ollama: whether the `OLLAMA_ENDPOINT` answers.
- It returns a plain `HardwareReport`. It makes no network call except to a
  local runtime endpoint.

Two levels exist, because `config` loads before any probe can run (§7.2):

- `detectHardwareSync()`: `os` data only. No process spawn, no network.
- `detectHardware()`: the full async report. `doctor` and setup use it.

### 7.2 Profiles and bootstrap

New file `src/config/hardware-profiles.json`. Each profile is a set of
defaults. The floor profile is `cpu-8gb`.

**Name clash.** `LOCALLAMA_PROFILE` already means `default` or `lightweight`
(`buildConfigFromEnv`). That meaning stays. The hardware profile uses a new key:
`LOCALLAMA_HARDWARE_PROFILE`. A `lightweight` value of the old key does not select
a hardware profile.

**Initialization order.** `config` is built synchronously at import. So:

1. At import, `config` reads, in this order: `.env` keys, then the hardware
   profile, then built-in defaults.
2. The profile name comes from `LOCALLAMA_HARDWARE_PROFILE`; else from the saved
   calibration file (§7.4), which names the profile that setup chose; else from
   `detectHardwareSync()` (RAM and CPU only); else `default`.
3. The profile never needs a probe or a network call.
4. After start, async probes (`detectHardware()`) feed `doctor` and warnings.
   They never change `config` after import.
5. A change of profile takes effect at the next start.

**Floor profile settings** (config keys that exist today are in code font):

| Setting | Floor profile intent |
|---|---|
| `config.providerTimeoutMs`, `config.ollamaTimeout` | Long. The 120 s default is too short for slow tokens. `config.patchInferenceTimeoutMs` already defaults to 900000. |
| `LLAMA_CPP_STARTUP_TIMEOUT_MS` | Longer than 120000 for a cold CPU load. |
| `llamaCppHealthProbeTimeoutMs` | Long, for the same reason. See §7.7. |
| `LLAMA_CPP_MAX_CTX` and `PATCH_CONTEXT_TOKENS` | Small. |
| `LLAMA_CPP_SERVER_FLAGS` | CPU flags, and one resident model (§7.7). |
| `PATCH_LOCAL_MODELS` | 1. This limits ladder entries only. It does not limit residency (§7.7). |
| `PROVIDER_MAX_CONCURRENT_LOCAL` | 1 (already the default). |
| Retrieval limits | Per-file and total byte ceilings for the search index (§7.8). |
| Default local model | One entry of R1 Part 3. Q4 picks it. |

The table gives intent, not numbers. R1 publishes no CPU speed. The floor
profile has static conservative values for every key. Calibration (§7.4) may
raise or lower the timeouts and the context size.

**Calibration use.** At import, `config` reads the calibration file when it
exists and when it is valid. A calibration is valid when the machine
fingerprint (RAM total, CPU model, CPU count) and the model file digest match.
If the file is missing, stale, unreadable or invalid, `config` uses the static
profile values and does not fail. Q6 sets whether calibration changes any value.

**Existing profile compatibility.** A user key always wins. The name
`lightweight` keeps its current effect. The new key adds no effect when unset
and the machine is not a floor machine.

### 7.3 Local models and the pull helper

R1 Part 3 lists candidate models and their official GGUF files:

- Granite 4.2 3B, Q4_K_M, 2.24 GB.
- LFM3-1.7B, Q4_K_M, 1.10 GB. Needs a new llama.cpp build. Custom licence.
- Gemma 4 E2B-it QAT Q4_0, 3.35 GB.
- Granite 4.2 8B (5.35 GB) and Gemma 4 E4B (5.15 GB) are "tight on 8 GB".

R1 gives no RAM need and no CPU tokens per second for any model. The cards
state file sizes only. LocalLama must measure speed on the target machine.

**Manifest.** Each profile model has an entry in
`src/config/model-manifest.json`. R1 gives rounded sizes only, so the manifest
copies none of its sizes. The builder fills each field at build time from the
repo's file listing and the model card, and marks each field below "to confirm
at build time from the provider's docs":

| Field | Meaning |
|---|---|
| `repo`, `file` | The vendor repo and the GGUF file name (from R1 Part 3). |
| `revision` | The pinned commit of the repo. The helper downloads that revision only. |
| `sizeBytes` | The exact byte length of the file. |
| `sha256` | The digest of the file. |
| `destination` | The path in the models directory. |
| `licence`, `licenceUrl` | The licence name and link. |
| `checkedAt` | The date of the facts. |

A script `scripts/check-model-manifest.*` fails the build when a field is
missing or when a listed file no longer matches its digest.

**Helper.** `locallama models pull <profile|model>`:

- It downloads a GGUF from the vendor repo and revision in the manifest.
- It never downloads without a yes from the user. It shows size and licence first.
- It checks free disk space before it starts.
- It writes to `<destination>.part`. If a `.part` file exists and the revision
  and size match, it resumes with an HTTP range request. Otherwise it restarts.
- At the end it checks byte length and digest against the manifest. A mismatch
  deletes the `.part` file, reports the error and leaves no model file. It
  renames the file only after the digest matches. Nothing loads a `.part` file.
- For a custom licence (LFM3), it prints the licence name and the link and
  asks for a yes (Q8).
- llama.cpp loads the file through the existing discovery
  (`src/modules/llama-cpp/discovery.ts`, `LLAMA_CPP_MODEL`). No new runtime path.
- The profile's ladder hint tells `buildLadder` to prefer the profile model.
  The ranking rules of §6.5 apply: the model needs no `code` score to stay on
  the ladder.

### 7.4 First-run check and calibration

A command `locallama doctor` (and the same logic behind an MCP read, so a
client can ask). It runs on the install and on demand. Setup and the MCP read
call one function in `src/modules/hardware/doctor/`.

1. Report the hardware (§7.1) and the profile.
2. Check each runtime: reachable, version, the model that is loaded.
3. Warn when the runtime can keep more than one model in RAM (PRD 01 §7
   promised this warning).
4. Run one short streaming generation on the local model. Measure time to the
   first token and tokens per second (interface below).
5. For each free provider whose key is set and that needs no missing
   acknowledgement: a one-call probe, then show the remaining quota as the
   tracker sees it. For a provider that needs an acknowledgement: show "not
   probed: acknowledgement missing" and the §6.4 warning.
6. List what the machine can do. Q6 sets the report shape.
7. Write the calibration file (below). This is the only file the check writes.

**Measurement interface.** The current llama.cpp path cannot measure this:
`llamaCppModule.callApi` does not stream and `LlamaCppProvider.executeTask`
discards usage. Two changes follow (issue 7):

- `llamaCppModule.measureThroughput(modelId, prompt, signal)`: a streaming
  request. It records the time to the first streamed token and the count of
  streamed completion tokens. It prefers the usage that the server reports.
  If the server reports none, it counts streamed chunks and marks the result
  `approximate`. If streaming fails, the result is `unavailable`.
- `LlamaCppProvider.executeTask` returns the usage that the server reports.
  This also gives the quota-free local path real token counts for PRD 01.

**Calibration file.** `<config.rootDir>/calibration.json`:

- Fields: `profile`, `fingerprint` (RAM total, CPU model, CPU count),
  `modelId`, `modelSha256`, `ttftMs`, `tokensPerSecond`, `quality`
  (`measured`, `approximate`, `unavailable`), `measuredAt`.
- It is written atomically (temp file, then rename).
- `config` reads it at import (§7.2). A fingerprint or digest mismatch makes it
  stale. A stale or invalid file is ignored, and `doctor` says that the check
  must run again.
- If the measurement is `unavailable`, `doctor` writes the profile name but no
  speed. The profile keeps its static values.

### 7.5 Install

One command that detects, pulls, writes config and runs the check. The method
is the maintainer's choice (Q5). The command never needs a paid account. It
never installs a runtime without a yes from the user.

For option A of Q5, issue 12 owns these package changes:

- `package.json`: add a `locallama` entry to `bin` that points to the CLI
  entry in `dist`. Keep `locallama-mcp`.
- `package.json`: `files` must include the JSON config that the CLI and the
  server read (`free-providers.json`, `hardware-profiles.json`,
  `model-manifest.json`). They ship under `dist/config/`.
- `scripts/copy-assets.js`: copy those JSON files to `dist/config/`. Today it
  copies one lock helper.
- Code loads these files from a path relative to the built module, not from
  `src/`.
- A package test runs `npm pack`, unpacks the archive, and checks that every
  file the CLI needs is in it.

### 7.6 Tests (G8)

- `detectHardware` and `detectHardwareSync` with mocked `os` and mocked probe commands.
- Profile resolution: a `.env` key beats the profile; the profile beats the
  default; `LOCALLAMA_PROFILE=lightweight` keeps its old effect and selects no
  hardware profile; a missing or stale calibration file falls back to static values.
- The pull helper with a fake HTTP server: size check, digest check, abort on
  mismatch, resume of a `.part` file with matching revision and size, restart on
  a revision mismatch, no rename on failure, no download without a yes.
- `measureThroughput` with a fake streaming server: first-token time, token count, the
  `approximate` and `unavailable` results.
- The first-run check with a fake provider: the report has every section, and an
  unacknowledged provider is not probed.
- `npm pack` content test (§7.5).
- The floor test of PRD 01 §7 repeats here: llama.cpp with `-ngl 0` and an 8 GB limit
  (`systemd-run --user --scope -p MemoryMax=8G`). The report names it a simulation.
- **Memory under load.** In the same limit, run inference, search indexing and a
  check command together. Record the peak memory. The test fails if the limit
  kills any process.
- **Repair on a small context.** Under the floor profile, run a request that
  fails its check on attempt 1 and passes after the repair. The context must be
  small enough that a hinted file alone would fill the old budget. The attempt-2
  prompt must contain the error text (§7.8).

### 7.7 Floor health and residency

**Health.** The floor profile must not exclude a slow reasoning model before the
patient worker runs.

- The profile sets `llamaCppHealthProbeTimeoutMs` long enough for a cold CPU
  model. The setting comes from the calibration when it exists.
- The profile sets a flag (proposed name `LLAMA_CPP_ACCEPT_DEGRADED`) that
  makes `LlamaCppProvider.isAvailable()` accept health `degraded`, which is the
  state that thinking output causes. `unhealthy` stays unavailable.
- A model that answers only in thinking output is still `degraded`, and `doctor`
  says so.
- A probe that times out keeps the provider `unavailable` and `doctor` names the
  timeout and the setting.

**Residency.** `PATCH_LOCAL_MODELS=1` limits ladder entries. It does not limit
what the runtime keeps in RAM.

- `LlamaCppProvider.releaseResources` stops the `llama-server` that LocalLama
  started (`LlamaServerManager`) when the ladder switches to another local
  model. It no longer does nothing.
- The floor flags start one server with one model. They add no flag that loads a
  second model.
- LocalLama does not stop a `llama-server` that it did not start (found by
  process detection). `doctor` warns that it cannot control that server's
  residency.
- Ollama: `doctor` warns when it reports more than one loaded model, and names
  the Ollama setting that limits this. LocalLama does not change Ollama's own
  settings.

### 7.8 Small-context repair and retrieval memory

**Fill order.** `buildPrompt` fills hinted files before the repair errors. On a
small context this removes the feedback a weak model needs. Proposed change for
attempt 2 and later:

1. goal;
2. last errors and last edit blocks (cut with a reserved minimum share of the budget);
3. hinted files (cut to the remaining budget);
4. BM25 results.

On attempt 1 the order stays as in PRD 01 §5.8. The size of the reserved share
is a setting, not a number from R1. Issue 11 owns `src/modules/patch/prompt/**`
and keeps the `buildPrompt` signature, so the worker file does not change.

**Retrieval memory.** `readCodeFiles` keeps each whole file and its chunks.

- It skips a file bigger than a per-file byte ceiling and logs the skip.
- It stops adding documents at a total byte ceiling for the index.
- It stores only chunks for a file that is longer than one chunk. It stores the
  whole file only when one chunk covers it.
- The floor profile sets both ceilings. The default profile keeps today's
  behavior until the ceilings are set.

## 8. Safety

- Provider keys come from the environment only. They never go in a prompt, a
  log line, a Job row, a quota row or a check's env (PRD 01 §5.4).
- The quota tracker never logs a key.
- A provider that the §6.4 gate covers does not receive repo content until the
  operator acknowledges it. The provider enforces this, so direct callers
  (`OutputValidator`) are covered.
- The pull helper downloads only from the repo and revision in the manifest. It
  writes only in the models directory. It checks size and digest. It never loads
  a partial file.
- The install command makes no system-wide change without a yes.
- The free pool adds no write to the user's working tree (Ruling 2).
- A waiting Job keeps its workspace on disk and holds no process.

## 9. Docs that change with the code

- `CONTEXT.md`: Free Pool, Quota Window, Quota Reservation, Quota Tracker, Hardware Profile, Calibration, Doctor.
- `wiki/10-glossary.md`: short entries that point to `CONTEXT.md`.
- New wiki pages: `wiki/13-free-pool.md` and `wiki/14-old-hardware.md`. Links from `wiki/README.md`.
- `.env.example`: one key and one acknowledgement per provider; `LOCALLAMA_HARDWARE_PROFILE`.
- `docs/lightweight-models.md`: point to the profile model list.
- ADR `docs/adr/0005-free-pool-quota-tracker-and-patient-wait.md`.
- ADR `docs/adr/0006-hardware-profiles.md`.
- `docs/OPERATIONAL_TEST_PLAN.md`: the live G7 and G8 runs.
- R1 refresh: one targeted lane before issue 8 (§6.1), and one before each later G7 wave (roadmap, R1).

## 10. Acceptance criteria

G7:

1. Each provider in the first wave (Q1) registers when its key is set and its descriptor facts are complete, and not otherwise.
2. A fake free provider's listed models are only the models in its descriptor.
3. A listed free model has price 0 in `priceOf`, so `buildLadder` puts it on the free list.
4. The tracker enforces per-minute, per-day and per-token windows with a fake clock, and admits atomically across two processes.
5. A day count survives a restart. A killed process's reservation counts as spent.
6. A 429 with `Retry-After` blocks the provider until that time. It does not open the circuit breaker and uses no attempt.
7. A 5xx and a timeout still open the breaker as today. One owner (`executeGuarded`) records each outcome once, for the route path and the patch path.
8. The §6.4 gate covers the values that Q2 sets. A covered provider is not on the ladder, is not seeded into `ModelRegistry`, and gets no network call from `executeTask`, `OutputValidator` or `doctor` until acknowledged.
9. With every free provider blocked and no local model, the patch Job waits. `get_task_status` shows `waiting.until` and the provider list. The worker slot is free during the wait.
10. After a restart during a wait, the Job resumes and `wait_until` and `deadline_at` stay right.
11. `cancel_task` during a wait ends the Job `cancelled` at once.
12. A wait does not use an attempt (§5.2). A prompt that cannot fit a token window does not make the Job wait for ever.
13. With two providers that serve the same model id, both appear on the ladder. With the cap at least the provider count, every provider with a listed model appears.
14. The build-time check fails on a first-wave descriptor with a missing `baseUrl`, `sourceUrl` or `checkedAt`.
15. **Live:** a grind run that needs more requests than one free tier allows per day finishes at $0 with `cost_usd = 0`. It moves across providers and waits for quota. The report lists calls per provider.

G8:

16. `detectHardware` returns RAM, CPU count, GPU status and runtime status on Linux. A failed probe never throws.
17. On a machine of 8 GB RAM or less with no usable GPU, the profile is `cpu-8gb` and the config shows its values. The old `LOCALLAMA_PROFILE` keeps its meaning.
18. A `.env` key beats the profile value (test). A missing or stale calibration file falls back to static values.
19. `locallama models pull` asks before it downloads, resumes a matching `.part` file, and refuses a size or digest mismatch without leaving a model file.
20. `locallama doctor` reports hardware, runtimes, measured first-token time and tokens per second (or `unavailable`), free provider status and the data-use warnings. It writes a calibration file.
21. With a runtime that can keep many models resident, `doctor` warns (PRD 01 §7). With llama.cpp started by LocalLama, a model switch stops the old server.
22. On the floor profile, a slow reasoning model stays available to the worker (§7.7).
23. A failed-then-repaired request passes under the floor profile, and its attempt-2 prompt holds the error text.
24. Search indexing honours the per-file and total byte ceilings.
25. `npm pack` includes the `locallama` bin entry and every JSON file the CLI needs.
26. **Live floor test:** on an 8 GB, CPU-only machine (or the simulation of §7.6), with no API key, a fresh install finishes the PRD 01 seed request with a passing diff. It uses only local and free models. Inference, indexing and checks run together within the limit. The report states RAM peak and time.

All: `npx tsc --noEmit` passes; the full suite passes; every new module has unit tests.

## 11. Issues (wave order)

Each issue owns its paths. Issues in one wave own disjoint paths. A shared file
has one owner in the whole plan, or one owner per wave with the order below.

**Wave 0: issue #147 merges.** It builds the dispatcher, the `patch_task` tool
and the seed fixtures. No issue below starts before it merges. After it merges,
the builder checks the rows of §4 that name the worker and the dispatcher.

| # | Issue | Owns | Wave |
|---|---|---|---|
| 1 | Contracts and hooks: `FreeProviderDescriptor`, `QuotaReservation`, `QuotaDenial`, `HardwareReport`, `HardwareProfile`, `Calibration`, `PatchState` type with `wait_*` fields, config keys (hardware profile, acknowledgements, ceilings). A migration hook in `initJobStore` and two empty migration files. A stub `resolveProfileSync` that `config` calls. | `src/modules/free-pool/types.ts`, `src/modules/hardware/types.ts`, `src/modules/hardware/resolve.ts` (stub), `src/config/index.ts`, `src/modules/patch/types.ts`, `src/modules/job-store/db.ts`, `src/modules/job-store/migrations/index.ts`, `src/modules/job-store/migrations/quota.ts` (stub), `src/modules/job-store/migrations/patch-wait.ts` (stub), `.env.example` | 1 |
| 2 | Docs: terms, glossary, ADRs 0005 and 0006 | `CONTEXT.md`, `wiki/10-glossary.md`, `docs/adr/0005-*`, `docs/adr/0006-*` | 1 |
| 3 | Quota tracker with atomic reservations | `src/modules/free-pool/quota-tracker.ts`, `src/modules/job-store/migrations/quota.ts` (body), `src/modules/job-store/quota*`, their tests | 2 |
| 4 | Breaker ownership: `executeGuarded`, typed errors, callers switch to it | `src/modules/core/provider/registry.ts`, `src/modules/core/provider/types.ts`, `src/modules/core/provider/helpers.ts`, `src/modules/core/provider/circuit-breaker.ts`, `src/modules/api-integration/task-execution/index.ts`, their tests | 2 |
| 5 | Hardware detection and profile resolution (sync and async), calibration read | `src/modules/hardware/detect/**`, `src/modules/hardware/resolve.ts` (body), `src/modules/hardware/calibration.ts`, `src/config/hardware-profiles.json`, their tests | 2 |
| 6 | Model manifest and pull helper | `src/modules/hardware/pull/**`, `src/config/model-manifest.json`, `scripts/pull-model*`, `scripts/check-model-manifest*`, their tests | 2 |
| 7 | llama.cpp: `measureThroughput`, usage in `executeTask`, floor health, `releaseResources` | `src/modules/llama-cpp/**`, their tests | 2 |
| 8 | `OpenAICompatProvider`, descriptor loader, first-wave descriptors, consent gate. Starts after the R1 refresh lane (§6.1). | `src/modules/free-pool/provider.ts`, `src/modules/free-pool/descriptors.ts`, `src/config/free-providers.json`, `scripts/check-free-descriptors*`, their tests | 3 (after 1, 3, 4 and the R1 refresh) |
| 9 | OpenRouter migration to the tracker and typed errors | `src/modules/openrouter/**`, their tests | 3 (after 3, 4) |
| 10 | Worker wait state machine, ladder selection, `patch_state.wait_*` migration body, timed requeue if #147 lacks it | `src/modules/patch/worker/**`, `src/modules/patch/ladder/**`, `src/modules/job-store/migrations/patch-wait.ts` (body), `src/modules/job-store/patch-wait*`, their tests | 3 (after 3, 4) |
| 11 | Prompt fill order and retrieval ceilings | `src/modules/patch/prompt/**`, `src/modules/cost-monitor/codeSearch.ts`, their tests | 3 |
| 12 | `doctor` core, CLI and package assets | `src/modules/hardware/doctor/**`, `src/cli/**`, `package.json`, `scripts/copy-assets.js`, `scripts/install*`, their tests | 4 (after 5, 6, 7, 8) |
| 13 | Wire-up: register providers, apply profile at start, `waiting` in `get_task_status`, `doctor` MCP read, data-use text in the tool description | `src/index.ts`, `src/modules/api-integration/tool-definition/index.ts`, `src/modules/api-integration/routing/index.ts`, their tests | 5 (after 8-12) |
| 14 | Live runs and wiki pages | `scripts/free-pool-live/**`, `wiki/13-free-pool.md`, `wiki/14-old-hardware.md`, `wiki/README.md`, `docs/OPERATIONAL_TEST_PLAN.md`, `docs/lightweight-models.md` | 6 (after 13) |

Notes on the table:

- Issue 1 lands first. It owns `src/config/index.ts`, `db.ts`, the migration
  files' skeleton and `patch/types.ts`. Later issues change those files only
  through the owners named above: issue 3 and issue 10 fill the migration
  bodies, and issue 5 fills `resolve.ts`. These are different waves, so no two
  issues edit one file in one wave.
- Provider and registry integration (issues 8, 9, 10) comes after the tracker
  contract and body (issue 3) and the breaker owner (issue 4).
- Issue 13 is the only issue that edits `src/index.ts` and the tool definition.
  `doctor` core is in issue 12, so no wave has two issues in the tool files.
- `buildPrompt` keeps its signature, so issue 11 does not touch the worker.
- Issue 8 needs the Q1 answer. Issues 5 and 6 need the Q4 and Q8 answers.

## 12. Rulings needed

Each question has options and one recommendation. The maintainer decides.

**Q1. Which free providers to add first.**
R1 "Takeaways" ranks five: OpenRouter `:free`, Groq, Gemini, Cloudflare Workers AI, SambaNova. R1 gives a base URL for OpenRouter, Groq and Gemini. It gives none for Cloudflare and SambaNova (§6.1).
- A. Groq first, with OpenRouter already in place. Add Cloudflare Workers AI and SambaNova in the same wave only after the R1 refresh confirms their base URLs and reset rules. Gemini waits for Q2. _(Recommended)_ Reason: R1 publishes limits for Groq and SambaNova, and Cloudflare publishes its Neuron allowance. Groq has a base URL in R1. The others need the build-time check. R1 marks Groq's and Cloudflare's code-use terms as `unconfirmed`, so the first wave still carries that risk.
- B. Groq only first. Reason: one new provider proves the tracker with the least work and no open fact except the day reset.
- C. Groq, Cloudflare and SambaNova in one wave, with no gate on the research. Reason: widest pool, but builders would need facts that R1 does not give.

**Q2. Free tiers that use or human-review prompts, or whose terms are unknown.**
R1 says the Gemini free tier may use prompts to improve Google products and human reviewers may read them. For most other providers R1 says the terms are `unconfirmed`. Repo code is in the prompt. Two parts.

Part 1 — the Gemini case:
- A. Add the provider but off by default. The operator sets an acknowledgement per provider. A warning shows at start-up, in the tool text and in `doctor`. The provider enforces it. _(Recommended)_ Reason: the free pool grows for people who accept the trade, and nobody is opted in by accident.
- B. Do not add any provider with this term. Reason: the safest choice, but the pool loses the 1M-token Gemini free model.
- C. Add it on by default with a warning only. Reason: simplest, but code can leave the machine before the user decides.

Part 2 — which `dataUse` values the gate covers:
- A. Gate `train_or_review` only. `unknown` shows a different warning and needs no acknowledgement. _(Recommended)_ Reason: R1 does not say that an `unconfirmed` provider reviews prompts, and this keeps current OpenRouter free use working.
- B. Gate `train_or_review` and `unknown`. Reason: safest, but R1 lists nearly every provider as `unconfirmed`, so every free provider, OpenRouter included, would need an acknowledgement. This changes today's OpenRouter behavior.
- C. Gate nothing and warn only. Reason: least friction, but it breaks the Part 1 choice.

**Q3. Quota-wait behaviour.**
Three independent parts.

Part 1 — order when a tier is at its limit:
- A. Next entry of the same cost class, then local entries, then wait. _(Recommended)_ Reason: it matches PRD 01 §5.5 and spends free quota before local time.
- B. Wait only when no free and no local entry has budget. Reason: simplest to explain, but it idles when another tier is open.

Part 2 — the clock. The Job has one deadline, `deadline_at` (§5.2):
- A. The wait moves `deadline_at` later by its length. `max_minutes` then limits active time, not wall time. _(Recommended)_ Reason: it keeps a Job alive across a day reset. The tool text says what `max_minutes` means.
- B. The wait does not move `deadline_at`. `max_minutes` is wall time. Reason: a clear time limit, but a day-reset wait would end most Jobs with `budget_time`.
- C. Fail fast with a diagnosis that shows when quota returns. Reason: simple, but it breaks the G7 done-when line.

Part 3 — the longest wait. A pausing clock needs a cap, or a Job can wait for ever:
- A. A separate total-wait cap setting per Job. When the cap ends, the Job ends with a diagnosis that shows when quota returns. _(Recommended)_ Reason: the pause stays bounded, and the maintainer sets the cap.
- B. No cap. Reason: simplest, but a blocked key can hold a Job without end.
- C. A cap on each single wait only. Reason: easy to explain, but repeated waits are not bounded.

**Q4. The default local model for the 8 GB CPU-only profile.**
R1 Part 3 gives these. R1 publishes no CPU speed for any of them. R1 also warns that the scores come from different harnesses and settings and cannot be compared across rows. Compare the files, licences and support below, not the scores. The doctor measurement and the seed test decide in practice.
- A. Granite 4.2 3B Q4_K_M (2.24 GB). _(Recommended)_ Reason: Apache-2.0, an official GGUF, and R1 names it the best-sourced 3B choice.
- B. LFM3-1.7B Q4_K_M (1.10 GB). Reason: the smallest file, but it needs a new llama.cpp build and a custom licence.
- C. Gemma 4 E2B-it QAT Q4_0 (3.35 GB). Reason: a major vendor and Apache-2.0, the licence-safe fallback in R1.

**Q5. The install method.**
- A. An npm package with a `locallama setup` command that runs the §5.3 flow. Issue 12 changes `bin`, `files` and `copy-assets.js` (§7.5). _(Recommended)_ Reason: the project is a Node MCP server, and clients already start it with `npx`.
- B. A shell script that installs Node, llama.cpp and the package. Reason: it needs fewer steps for a new user, but it touches the whole system.
- C. A container image. Reason: a clean setup, but old hardware may lack the RAM to spare for a container.

**Q6. How the first-run check reports, and what the measurement does.**
Part 1 — the report:
- A. A short text report in the terminal, and the same data as JSON through an MCP read. Show a "can do / cannot do" line per capability, with the measured tokens per second. _(Recommended)_ Reason: a person reads the text, and a client reads the JSON, from one source.
- B. Text only. Reason: the least work.
- C. A dashboard page. Reason: friendlier, but it needs the front door that Ruling 8 puts later.

Part 2 — use of the measurement. The calibration file (§7.4) and the import-time read (§7.2) exist in both options:
- A. Calibration may set the timeouts and the context size of the profile. Static profile values are the fallback. _(Recommended)_ Reason: R1 has no CPU speed, so the machine's own number is the best input.
- B. Fixed profile values only. `doctor` reports the speed and writes the file, but `config` ignores it. Reason: simpler and fully predictable.

**Q7. Which local runtime to support first on the floor.**
- A. llama.cpp (`llama-server`) first. Ollama stays supported as is. The support changes of §7.7 and issue 7 apply. _(Recommended)_ Reason: PRD 01 §7 and the floor test already use llama.cpp with `-ngl 0`, it needs no daemon, and LocalLama can stop a server it started.
- B. Ollama first. Reason: easier install for a new user, but `releaseResources` and model limits depend on Ollama's own settings, which LocalLama does not control (§7.7).
- C. Both with equal support. Reason: widest reach, but twice the floor tests.

**Q8. Model download and licence policy.**
- A. The helper downloads only after an explicit yes. It shows size and licence first. A custom licence (LFM3) needs the user to read it and say yes. The manifest pins revision, byte length and digest (§7.3). _(Recommended)_ Reason: no surprise download on a slow link, and the licence stays the user's decision.
- B. Ship only Apache-2.0 models in profiles. Reason: no licence prompt, but it drops LFM3 as a choice.
- C. Download on first run with no prompt. Reason: the fastest start, but it breaks the "no change without a yes" rule of §8.

**Q9. Where the provider limits live.**
- A. A static `src/config/free-providers.json` in the repo, each entry with `sourceUrl` and `checkedAt`. Unknown facts stay representable (`baseUrl = null`, `dayReset = unknown`) and the build-time check blocks a first-wave entry that has one. Maintainers update it with each R1 run. _(Recommended)_ Reason: R1 says free tiers change often, and a file under review is easy to audit.
- B. Fetch limits at run time from the provider. Reason: always fresh, but R1 shows that several providers publish no numbers on a page.
- C. Both: the file as the default, a runtime override from a user file. Reason: users fix a stale value fast, but it adds a second source of truth.

**Q10. Ladder selection across providers.**
§4 and §6.5 explain the gap. Local and free lists do not compete on score. The real gap is dedupe by model id and the lack of a per-provider selection.
- A. Identity by (provider, model). Rank inside each provider by `code` score, then descriptor order. Merge round-robin across providers. Cap the merged list at `PATCH_FREE_MODELS`. Every provider keeps one entry when the cap is not smaller than the provider count. _(Recommended)_ Reason: it needs no score data and it makes the pool real.
- B. As A, but the descriptor order is the only ranking inside a provider. Reason: the maintainer controls the order and the result is predictable, but quality data from `ModelRegistry` is ignored. R1 publishes no code scores for most free models.
- C. Leave the ranking as it is. Reason: no change, but providers that serve the same model would be lost, and one provider could fill the free cap.

## Review changes

Review: `docs/prd/02-review-2026-11-01.md`.

1. Blocker 1 — #147 (dispatcher, `patch_task`, seed fixtures) is an explicit prerequisite "after #147 merges"; §2, §4 and §11 wave 0 say so; the design keeps the dependency.
2. Blocker 2 — §6.2 rewritten: atomic `reserveQuota` with model and token scope, durable per-call rows, estimate, settle and release rules, conservative interrupted calls, multi-process safety, `too_large` denial.
3. Blocker 3 — §5.2 and §6.6: entry state machine, temporary quota skips vs `exhausted`, 429 uses no attempt, wake selection, worker release and timed requeue, one `deadline_at` clock; Q3 split into order, clock and wait cap.
4. Blocker 4 — §4 and §6.3: breaker facts corrected; `ProviderRegistry.executeGuarded` owns admission and recording; callers switch to it; typed errors carried through OpenRouter.
5. Blocker 5 — §4, §6.5 and Q10: false ranking premise removed; identity by (provider, model), per-provider selection, round-robin merge, cap guarantee and tie-breaks; options revised.
6. Blocker 6 — §7.2 and §7.4: `LOCALLAMA_HARDWARE_PROFILE` avoids the existing `LOCALLAMA_PROFILE`; sync bootstrap order; streaming `measureThroughput` and usage fix; calibration file with fallbacks; Q6 split.
7. Blocker 7 — §7.7: floor health-probe behavior, `releaseResources` for servers LocalLama starts, Ollama warning, memory-under-load test; Q7 notes the support changes.
8. Blocker 8 — §11 rebuilt: 14 issues in waves with disjoint paths; one owner for `config`, `db.ts`, `patch/types.ts`, worker, OpenRouter, `src/index.ts`; migration hook; narrow hardware paths; integration after tracker and breaker.
9. Blocker 9 — §6.1: unknown `baseUrl` and `dayReset` are representable; Cloudflare and SambaNova URLs and day resets marked "to confirm at build time"; R1 refresh prerequisite and a build-time check; Q1 and Q9 updated.
10. Follow-up 10 — §7.8 and §7.6: attempt-2 fill order puts errors before hinted files; failed-then-repaired floor test; retrieval byte ceilings; Q4 no longer compares scores across models.
11. Follow-up 11 — §6.4: consent enforced inside the provider (list, availability, execute) and in `doctor`; `unknown` split from `train_or_review` with separate warnings; Q2 gains a gate-coverage part.
12. Follow-up 12 — §7.3 and §7.5: manifest with revision, byte length, digest, destination; resumable `.part` download; `bin`, `files` and `copy-assets.js` changes; `npm pack` test; Q5 and Q8 updated.
