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

## Ladder, budgets and RAM

The ladder is local → free → opt-in paid. Within each class, benchmark-derived code scores
rank first, then parameter size (larger first) and provider order. Unknown remote prices are
excluded; paid entries require both `allow_paid: true` and `OPENROUTER_FREE_ONLY=false`.
Free providers without current rate budget are skipped rather than waited on
(`src/modules/patch/ladder/build.ts:buildLadder`, `rank`, `priceOf`;
`src/modules/patch/ladder/policy.ts:hasBudgetNow`;
`src/modules/patch/worker/index.ts:PatchWorker.runJob`).

Attempts stay on a model until its allowance is used or the error signature repeats, then
advance. Stops include total attempts, original deadline, ladder exhaustion, cancellation
and paid cap. Paid generation and judge calls reserve cost before execution and settle
usage afterward; interrupted reservations are conservatively charged on recovery
(`src/modules/patch/ladder/policy.ts:nextCursor`, `sameSignature`, `stopReason`;
`src/modules/patch/worker/model-call.ts:PatchModelCalls`;
`src/modules/patch/worker/index.ts:PatchWorker.runJob`).

**One model in RAM depends on the runtime:** use llama-router `--models-max 1` or Ollama's
unload behavior. Serial attempts alone do not unload models; llama.cpp resource release is
a documented no-op (`src/modules/api-integration/tool-definition/index.ts:patchTaskTool`;
`src/modules/llama-cpp/provider.ts:LlamaCppProvider.releaseResources`).

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
| `validation` | Additive array of `{model_id, provider_id, passed: boolean \| null, skipped, reason}`. |

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
