# 12 — Verified patch tasks

`patch_task` takes a coding goal, snapshots a git repository, and tries models until the
declared checks pass or a budget ends. The client receives a diff and decides when to apply it.
The worker calls the provider registry directly, using its own ladder rather than the
`route_task` coordinator (`src/modules/patch/dispatcher/submit.ts:submitPatchTask`,
`src/modules/patch/worker/index.ts:PatchWorker.run`,
`src/modules/patch/worker/model-call.ts:PatchModelCalls`).

Intent and decisions: [PRD 01](../docs/prd/01-verified-patch-and-grind-loop.md),
[ADR 0004](../docs/adr/0004-patch-tasks-in-git-worktrees-with-edit-blocks.md).
Domain terms live in [`CONTEXT.md`](../CONTEXT.md); live verification belongs in
[`docs/OPERATIONAL_TEST_PLAN.md`](../docs/OPERATIONAL_TEST_PLAN.md).

## Submit → snapshot → dispatch → attempts → checks → diff

| Step | What the code does | Code anchor |
|------|--------------------|-------------|
| Submit | Requires `goal` and an absolute `repo_path`. Optional inputs are `file_hints`, `task_type`, `checks`, `allow_paid`, `paid_cap_usd`, `validate`, and `max_minutes`. Paid calls and the judge default to false; `max_minutes` overrides the task timeout. | `src/modules/api-integration/tool-definition/index.ts:patchTaskTool`; `src/modules/patch/dispatcher/submit.ts:parseInput` |
| Snapshot | Before returning, checks the real repository path against the allowed roots and creates a snapshot. Requires git on PATH and a repository root with a HEAD commit. A temporary index captures current tracked bytes and explicitly hinted untracked files, retaining the commit at `refs/locallama/base/<jobId>`. The source tree, index, branches and stash are preserved. | `src/modules/patch/dispatcher/submit.ts:allowedRepo`, `submitPatchTask`; `src/modules/patch/workspace/index.ts:GitWorkspaceBackend.snapshot` |
| Persist and return | Resolves checks from the snapshot, builds the ladder, and stores Task, patch Job and `patch_state` atomically. State includes the immutable base, resolved checks/settings/ladder, deadline, cursor, attempts and paid ledger. Returns `{task_id, job_id, status: "queued"}` after that preparation. | `src/modules/patch/dispatcher/submit.ts:submitPatchTask`; `src/modules/job-store/patch-store.ts:submitPatchJob`; `src/modules/patch/types.ts:PatchState` |
| Dispatch | Claims oldest queued patch Jobs atomically, up to `PATCH_MAX_CONCURRENT`, and runs one worker per Job. Startup requeues interrupted patch Jobs and cleans orphan workspaces/base refs. Recovery uses the stored base and deadline. | `src/modules/patch/dispatcher/index.ts:PatchDispatcher`; `src/modules/job-store/patch-store.ts:claimNextPatchJob`, `recoverInProgressPatchJobs`; `src/modules/patch/worker/index.ts:PatchWorker.runJob` |
| Attempt | Creates a scratch git worktree from the base. Builds a bounded prompt from goal, hinted files, last errors/edit blocks and BM25 hits. Calls a provider, parses search/replace blocks, resets to the base and applies the edits. Attempts are independent patches against that base. | `src/modules/patch/worker/index.ts:PatchWorker.runJob`; `src/modules/patch/prompt/builder.ts:buildPrompt`; `src/modules/patch/edit-blocks/parser.ts:parseEditBlocks`; `src/modules/patch/edit-blocks/applier.ts:applyEditBlocks` |
| Check | Runs commands sequentially, stopping at the first nonzero exit or timeout. Records exit code, timeout, duration and bounded output tail; failure feedback goes into the next prompt. A passing patch optionally gets a judge review (`validate: true`); explicit rejection retries, skipped/unparseable verdicts leave the checks' result standing. | `src/modules/patch/checks/runner.ts:runChecks`; `src/modules/patch/worker/index.ts:PatchWorker.runJob`; `src/modules/patch/worker/validator.ts:validatePatch` |
| Diff and finish | Git produces the diff, including new files and excluding dependency links. The public `diff` is populated only on pass; failure returns diagnosis instead. Normally removes the scratch worktree and base ref after check processes exit. | `src/modules/patch/workspace/index.ts:GitWorkspaceBackend.diff`, `dispose`; `src/modules/patch/worker/index.ts:PatchWorker.runJob` |

Poll `get_task_status` with `task_id`: each patch Job's `result` is parsed as an object.
Review a passed result and apply its `diff` in the source repository with `git apply` when
authorized. `cancel_task` marks rows cancelled and aborts the corresponding workers; queued
cancelled Jobs cannot be claimed. Conditional terminal writes prevent worker completion from
overwriting cancellation (`src/modules/api-integration/routing/index.ts:getTaskStatus`,
`cancelTask`, `abortPatchWorkers`; `src/modules/api-integration/tool-definition/index.ts:patchTaskTool`;
`src/modules/job-store/patch-store.ts:finishPatchJob`, `claimNextPatchJob`).

## Safety and checks

`PATCH_TASKS_ENABLED` defaults to false: the tool is omitted from discovery, and direct
submission refuses with `patch_tasks_disabled`. `PATCH_REPO_ROOTS` has no default entries;
the real repository path must lie within a real, absolute allowed root. Submission refusals
also include `invalid_input`, `repo_not_allowed`, `snapshot_failed`, `no_checks` and
`ladder_exhausted` (`src/config/index.ts:buildConfigFromEnv`;
`src/modules/api-integration/tool-definition/index.ts:ToolDefinitionProvider.getAvailableTools`;
`src/modules/patch/dispatcher/submit.ts:PatchRefusal`, `allowedRepo`, `submitPatchTask`).

Request `checks` override the snapshot's `.locallama/checks.json`, including an explicitly
empty list (which refuses with `no_checks`). Each check has `name`, an `argv` array, optional
`timeout_ms` and `append_changed_files`. The file can also set `links` and `env_allow`.
Existing `node_modules` and `.venv` are linked by default; `links: []` disables links. The
backend installs no dependencies (`src/modules/patch/checks/loader.ts:resolveChecks`,
`loadChecksConfig`; `src/modules/patch/types.ts:CheckSpec`, `ChecksConfig`;
`src/modules/patch/workspace/index.ts:GitWorkspaceBackend.readLinks`, `makeLinks`).

Checks execute as the user in the scratch worktree with `shell: false`, a controlled
environment (PATH, HOME, locale variables plus `env_allow`) and a timeout. This is **not a
sandbox**: commands can access resources available to that user, and linked dependencies
are shared. The runner requires POSIX process groups; timeout/cancel sends SIGTERM, then
SIGKILL after five seconds, and waits for descendants before returning. Edit application
rejects paths outside the worktree, `.git` paths and link paths
(`src/modules/patch/checks/runner.ts:checkEnv`, `runCheck`, `runChecks`;
`src/modules/patch/edit-blocks/applier.ts:applyEditBlocks`;
`src/modules/api-integration/tool-definition/index.ts:patchTaskTool`).

## Auto lint (opt-in)

`.locallama/checks.json` can say `"lint": "auto"` (or `{"auto": true, "exclude": ["eslint"]}`).
After the last explicit check of an attempt passes, LocalLama finds the languages of the
files that attempt changed and runs the installed linter for each one as an extra check named
`lint:<tool>`. A failure feeds its output tail to the next attempt like any check. Without
`lint`, checks and the `no_checks` refusal are unchanged; `lint` alone does not satisfy
`no_checks`. `validate` stays opt-in. Linters are never installed: a tool is looked up in the
repo `node_modules/.bin`, `PATH`, `~/.local/bin`, `~/go/bin` and `~/.cargo/bin`, and a missing
one is skipped and listed in `lint_skipped`. Tools that cannot take a file list (`tsc`,
`go vet`, `staticcheck`, `cargo`, `dotnet format`) run on the whole package. `gofmt -l` prints
findings and exits 0, so its check sets `fail_on_stdout`: non-empty stdout fails. Each lint
check uses `PATCH_CHECK_TIMEOUT_MS`. Code: `src/modules/patch/checks/lint/registry.ts`
(table), `lint/index.ts:planLint`, `src/modules/patch/checks/runner.ts:runCheck`,
`src/modules/patch/worker/index.ts` (call site).

| Language | Tool and argv | Notes |
|---|---|---|
| TS/JS | `tsc --noEmit -p .` | only with `tsconfig.json`; package scope |
| TS/JS | `eslint --max-warnings=0 <files>`, else `biome check`, else `oxlint` | eslint and biome need the repo's own config |
| Python | `ruff check` + `ruff format --check`; else `pyflakes`; else `python3` compile check | |
| Go | `gofmt -l` (stdout = fail); `go vet ./...`; `staticcheck ./...` | vet and staticcheck run on the package |
| Rust | `cargo fmt --check`; `cargo clippy --offline -- -D warnings` | needs `Cargo.toml` |
| C/C++ | `clang-tidy <files>` (`-p .` with `compile_commands.json`, else `--`); else `gcc -fsyntax-only -Wall -Wextra` | |
| Shell | `shellcheck --severity=style` | |
| Ruby | `rubocop` | |
| PHP | `php -l` | one run per file |
| Lua | `luacheck` | |
| Kotlin | `ktlint` | |
| Swift | `swiftlint lint --strict` | |
| C# | `dotnet format --verify-no-changes` | package scope |
| Java | `javac -Xlint:all -proc:none` | only when no `pom.xml` or `build.gradle*` |
| YAML | `yamllint` | |
| Dockerfile | `hadolint` | |
| Markdown | `markdownlint` | |

Sandbox recipes the auto table reproduces (write these as explicit `checks` when a repo wants
stricter flags than the table): TS `node_modules/.bin/tsc -p .` and `eslint --max-warnings=0`;
Python `ruff check` and `ruff format --check`; Go `gofmt` via `sh -c 'test -z "$(gofmt -l .)"'`,
`go vet`, `staticcheck`; Rust `cargo fmt --check` and `cargo clippy -D warnings`; C `gcc -Werror`
with ASan/UBSan, and `clang-tidy`; Shell `shellcheck --severity=style`.

## Ladder, budgets and RAM

The ladder is local → free → opt-in paid. Within each class, benchmark-derived code scores
rank first, then parameter size (larger first) and provider order. Unknown remote prices are
excluded; paid entries require both `allow_paid: true` and `OPENROUTER_FREE_ONLY=false`.
Free providers without current rate budget are skipped rather than waited on
(`src/modules/patch/ladder/build.ts:buildLadder`, `rank`, `priceOf`;
`src/modules/patch/ladder/policy.ts:hasBudgetNow`;
`src/modules/patch/worker/index.ts:PatchWorker.runJob`).

**One model in RAM depends on the runtime:** use llama-router `--models-max 1` or Ollama's
unload behavior. Serial attempts alone do not unload models; llama.cpp resource release is
a documented no-op (`src/modules/api-integration/tool-definition/index.ts:patchTaskTool`;
`src/modules/llama-cpp/provider.ts:LlamaCppProvider.releaseResources`).

Attempts stay on a model until its allowance is used or the error signature repeats, then
advance. Stops include total attempts, original deadline, ladder exhaustion, cancellation
and paid cap. Paid generation and judge calls reserve cost before execution and settle
usage afterward; interrupted reservations are conservatively charged on recovery
(`src/modules/patch/ladder/policy.ts:nextCursor`, `sameSignature`, `stopReason`;
`src/modules/patch/worker/model-call.ts:PatchModelCalls`;
`src/modules/patch/worker/index.ts:PatchWorker.runJob`).

## Harness-driven research (#155)

When the grind loop is stuck — the same failing check with the same normalized error
signature (the normalized error tail, including traceback details) on two consecutive attempts, or an edit block that fails to apply twice — the
worker can run a short research step before the next attempt. The model does not call any
tool; the harness builds queries from the error text and touched files, runs local sources
and a user-configured SearXNG instance, and appends a bounded "## Research notes" section
to the next prompt after the errors section.

Research is **off by default**. It turns on only when `PATCH_RESEARCH_SEARXNG_URL` is set
to a reachable SearXNG URL and `PATCH_RESEARCH_TOKENS` is greater than 0. Local sources
(BM25 over the repo, dependency docs/types, `pydoc`, `go doc`, `man`) always run; the
SearXNG source runs only when the instance probes OK. A 403 on `format=json` means the
instance's `settings.yml` omits `json` from `search.formats`; the worker logs one warning
and disables research for the run. A down or timed-out SearXNG instance skips only the
web source; local sources still run.

SearXNG redirects fail the source without following the redirect. Its timeout covers
headers and the complete response body. Go documentation runs with automatic toolchain,
module and checksum downloads disabled (`GOENV=off`, `GOTOOLCHAIN=local`, `GOPROXY=off`,
`GOFLAGS=-mod=readonly`, `GONOSUMDB=*`, `GOSUMDB=off`). Python documentation runs as
`python3 -I -S -c <reader> <module>` from a disposable neutral directory. The reader uses
`find_spec` only for top-level names, walks submodule paths as files, and extracts source
docstrings and signatures with `ast`. Researched packages, defaults and decorators never
execute; site startup hooks and `.pth` files are disabled. Built-ins, C extensions and
namespace packages without source are skipped as `no_python_source`. Installation paths
come from `sysconfig`, with optional external search paths passed as arguments.

Queries and results are redacted before leaving the machine or being stored: absolute
paths, repo-private names, usernames, credential environment values of at least three
characters, other environment values of at least sixteen characters, bearer tokens,
provider prefixes, long hex and base64 are removed. One row per query/source is written to the new
`research_notes` table with `helped` NULL while pending. If the attempt that consumed the
note passes all checks, `helped` becomes 1 only for IDs whose complete note text survived
research assembly and prompt fitting. Cut or dropped notes resolve to 0. The using attempt's
metadata stores these IDs and the actual research prefix sent in its prompt. Restart
recovery restores past research records; pending notes without durable usage metadata
resolve to 0. An empty URL or zero token budget makes no research-store calls.
Only `helped = 1` notes are reused. Shared-scope sources (`searxng`, `deps`, `pydoc`,
`go doc`, `man`) match from any repo; `repo` notes match only within the same `repo_path`.
The BM25 index of helped notes is rebuilt from the table at first use, so it survives a
process restart. Each scope is capped to `PATCH_RESEARCH_NOTES_MAX`; oldest notes are
evicted first. Scope filtering precedes top-k ranking; index fingerprints include note IDs
and content hashes so eviction and replacement cannot leave stale documents.

Sources and records:
- Stuck detection: `src/modules/patch/research/detect.ts:detectStuck`.
- Query building and redaction: `src/modules/patch/research/queries.ts`,
  `src/modules/patch/research/redact.ts`.
- Local source adapters and doc-tool runners: `src/modules/patch/research/sources.ts`.
- SearXNG probe and snippet search: `src/modules/patch/research/searxng.ts`.
- Note reuse and BM25 index: `src/modules/patch/research/notes.ts`,
  `src/modules/cost-monitor/codeSearchEngine.ts:ResearchNotesIndex`.
- Orchestration and prompt insertion: `src/modules/patch/research/index.ts:runResearch`,
  `src/modules/patch/worker/index.ts:PatchWorker.runJob`,
  `src/modules/patch/prompt/builder.ts:buildPrompt`.
- Persistence: `src/modules/job-store/db.ts`,
  `src/modules/job-store/research-store.ts`.

## Environment defaults

These are the defaults in `src/config/index.ts:buildConfigFromEnv` (paths use `resolvePath`).
Resolved worker settings are persisted at submission
(`src/modules/patch/dispatcher/submit.ts:settingsOf`, `submitPatchTask`).

| Key | Default | Meaning |
|-----|---------|---------|
| `PATCH_TASKS_ENABLED` | `false` | Enable tool and startup dispatcher. |
| `PATCH_REPO_ROOTS` | empty list | Allowed roots, separated by platform path delimiter (`:` on POSIX, `;` on Windows). |
| `SCRATCH_DIR` | `scratch` under `rootDir` | Scratch workspaces; must be outside the target repository. |
| `PATCH_KEEP_WORKSPACE_ON_FAIL` | `false` | Retain failed/cancelled workspaces. |
| `PATCH_LOCAL_MODELS` | `2` | Maximum local ladder entries. |
| `PATCH_FREE_MODELS` | `2` | Maximum free ladder entries. |
| `PATCH_PAID_MODELS` | `1` | Maximum paid ladder entries, when enabled. |
| `PATCH_ATTEMPTS_PER_MODEL` | `3` | Attempts before advancing a model. |
| `PATCH_MAX_ATTEMPTS` | `12` | Total generation attempt limit. |
| `PATCH_TASK_TIMEOUT_MS` | `7200000` | Task deadline budget (two hours). |
| `PATCH_MAX_OUTPUT_TOKENS` | `2000` | Per-call output cap. |
| `PATCH_CONTEXT_TOKENS` | `6000` | Context cap, also bounded by model window. |
| `PATCH_MAX_CONCURRENT` | `1` | Concurrent patch workers. |
| `PATCH_INFERENCE_TIMEOUT_MS` | `900000` | Per-call timeout (15 minutes). |
| `PATCH_CHECK_TIMEOUT_MS` | `600000` | Default per-check timeout (10 minutes). |
| `PATCH_ERROR_TAIL_TOKENS` | `800` | Error/output feedback tail budget. |
| `PATCH_WHOLE_FILE_MAX_LINES` | `150` | Existing-file whole-file replacement limit. |
| `PATCH_PAID_CAP_USD` | `0.25` | Default cap when paid calls are opted into. |
| `PATCH_RESEARCH_SEARXNG_URL` | empty | SearXNG base URL; empty disables research. Must serve `format=json`. |
| `PATCH_RESEARCH_SEARXNG_CATEGORIES` | `it,general` | Comma-separated SearXNG `categories` sent with every search and the probe. Empty sends none (old behavior). Items are trimmed; empty or non `[a-z0-9 _-]` items are dropped with one warning. Restart required. |
| `PATCH_RESEARCH_SOURCE_TIMEOUT_MS` | `5000` | Per-source timeout, also applied to SearXNG. |
| `PATCH_RESEARCH_TOKENS` | `800` | Hard token budget for the research block; 0 disables research. |
| `PATCH_RESEARCH_NOTES_MAX` | `500` | Helped notes cap per scope; oldest evicted first. Scope filtering precedes top-k ranking; index fingerprints include note IDs
and content hashes so eviction and replacement cannot leave stale documents. |
| `OPENROUTER_FREE_ONLY` | `true` | Also excludes paid patch ladder entries. |
| `SAVINGS_TOKEN_FACTOR` | `1.0` | Positive multiplier for the savings estimate below. |

Startup enabling and workspace retention/path constraints are implemented in
`src/index.ts:LocalLamaMcpServer.run`,
`src/modules/patch/worker/index.ts:PatchWorker.runJob` and
`src/modules/patch/workspace/index.ts:GitWorkspaceBackend.prepare`.

## `patch_result_v1`

The shared envelope is `src/modules/patch/types.ts:PatchResultV1`, with `CheckResult` and
`PatchDiagnosis` in the same file. The worker adds `validation` verdicts via
`src/modules/patch/worker/contracts.ts:WorkerResult`, `PatchValidation`.

| Field | Shape / meaning |
|-------|-----------------|
| `schema` | Literal `"patch_result_v1"`. |
| `status` | `"passed"`, `"failed"` or `"cancelled"`. |
| `reason` | `passed`, `no_checks`, `budget_attempts`, `budget_time`, `ladder_exhausted`, `paid_cap`, `cancelled`, `snapshot_failed` or `internal_error`. |
| `diff`, `base`, `files_changed` | Unified diff (empty unless passed), snapshot identifier, changed path array. |
| `checks` | Array of `{name, exit_code: number \| null, timed_out, duration_ms, tail}` for the last attempt. |
| `attempts`, `models` | Total attempts; array of `{model_id, provider_id, cost_class, attempts}`. |
| `tokens` | `{local, free, paid}` prompt + completion token totals, including judge usage. |
| `cost_usd`, `elapsed_ms` | Paid ledger total and elapsed milliseconds. |
| `diagnosis` | Null on pass; otherwise `{last_errors, best_diff, attempts}`. Diagnosis attempts contain `{model_id, provider_id, outcome, duration_ms}`; outcomes are `apply_error`, `check_failed`, `validator_rejected`, `timed_out`, `call_error`. |
| `research` | Absent when research never ran; otherwise array of `patch_research_v1` records used by attempts, in order. |
| `validation` | Additive array of `{model_id, provider_id, passed: boolean \| null, skipped, reason}`. |
| `lint_skipped` | Present only when `lint` is on: array of `{tool, reason}` for linters that were not run (missing, no repo config, excluded). The diagnosis `last_errors` of a failed job also ends with a `lint skipped:` line. |

Result assembly, token accounting, last checks and diagnosis selection are in
`src/modules/patch/worker/index.ts:PatchWorker.runJob`.

## `get_savings`

This read-only tool reports finished patch Jobs from `jobs`, `patch_state` and
`patch_attempts`. Optional `since` is an ISO date/timestamp or unix-millisecond string;
`group_by` is `day` (UTC, default) or `task_type` (missing labels become `unspecified`).
Returns `{group_by, since, groups, totals}`. Each group has `key`; statistics include
`tasks`, `accepted`, `pass_rate`, `cost_usd`, `tokens: {local, free, paid}`,
`est_frontier_tokens_saved`, `avg_elapsed_ms`, and `factor`. Acceptance means result status
`passed`, and pass rate is null with no finished Jobs
(`src/modules/api-integration/tool-definition/index.ts:ToolDefinitionProvider.getAvailableTools`;
`src/index.ts:LocalLamaMcpServer`; `src/modules/patch/stats/index.ts:getSavings`, `SavingsReport`,
`SavingsStats`, `taskTypeOf`, `statsOf`).

Costs and tokens sum all attempts of finished Jobs. Estimated frontier tokens saved sum
`max(0, round(accepted_attempt_tokens × SAVINGS_TOKEN_FACTOR − agent_tokens))` per accepted
Job. Agent tokens count goal + file hints and one reading of the returned diff. This is an
estimate, not measured frontier usage; failed Jobs contribute zero savings
(`src/modules/patch/stats/index.ts:getSavings`, `estimateSaved`, `agentTokensOf`).


### 2026-11-01 — Issue #155 fix round 1

Hardened redirect and body-timeout handling, offline doc-tool configuration, redaction of
filenames/environment literals/check names, traceback comparison, scoped BM25 reuse and
note-credit recovery. Regression tests cover the HTTP, subprocess, orchestration and worker
boundaries; validation is recorded in the lane report.


### 2026-11-01 — Issue #155 fix round 2

Replaced Python package imports with static AST documentation extraction and lowered the
credential environment-value redaction threshold to three characters. Regression tests
cover installed-package/submodule import markers, missing source, query redaction and
persisted research rows and metadata.


### 2026-11-01 — Issue #159 stacked apply fallback

Every attempt starts from the base commit, and the prompt now says the last edit blocks were
not kept. A weak model can still write SEARCH text against its own discarded last attempt. When
the new blocks fail against the base with "SEARCH text not found", the worker tries once more:
the last attempt's effective blocks, then the new blocks, against the base. If that applies,
the checks run on the result and the attempt record's `edit_blocks` JSON carries
`stacked: true` and `effective_blocks`; stacking chains because the next prompt uses the
effective list. If it also fails, the attempt reports the original base apply error. Stacking
is within one job only; diffs come from the worktree and contain both sets of edits.
