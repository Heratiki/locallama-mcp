# PRD 01 — Verified Patch and Grind Loop (G2 + G3)

_Status: revision 1, 2026-11-01 (after the codex review in
`docs/agents/decisions-2026-11-01.md`). Goals G2 and G3 of
`docs/prd/00-goals-roadmap.md`. Grounding:
`docs/prd/validated-patch-dag/00-repo-grounding-and-reuse-map.md`._

## 1. Summary

A client sends a code request with the new MCP tool `patch_task`. LocalLama
takes a snapshot of the target repo and makes a scratch `git worktree` of it.
A small local or free model writes search/replace edit blocks. LocalLama
applies them, runs the repo's checks in the worktree, and gives any errors
back to the model for another attempt. It returns a unified diff when every
check passes, or a diagnosis when the budget ends. It never writes the user's
working tree.

This is the patch DAG with one node. G4 (many nodes) builds on it.

## 2. Rulings this PRD obeys

From `docs/prd/00-goals-roadmap.md`, Rulings 1-9, and these rulings of
2026-11-01:

- **R-A Edit format (maintainer):** the model writes search/replace blocks.
  LocalLama applies them and makes the real diff. Whole-file output is the
  fallback for a new file and for a small file.
- **R-B MCP tool (maintainer):** a new tool `patch_task`. It uses the
  persistent Task/Job tables and returns `task_id` at once. The client polls
  the existing `get_task_status` and stops a task with the existing
  `cancel_task`. `route_task` does not change.
- **R-C Safety (maintainer):** §6 as written.
- **R-D Own model path (steward):** the patch worker calls providers through
  `ProviderRegistry` directly. It does not use `executeRouteTaskBlocking`,
  `codeTaskCoordinator` or `buildRankedTrio`. Reason: the live run of
  2026-11-01 (findings F1, F2) showed that path drops llama.cpp models and
  can give a subtask a wrong provider.

Ruling 5 (git worktree) replaces the grounding map's "no dependency on
`git apply`": patch tasks need `git` on PATH and a git repo as the target.

## 3. Scope

In scope: the `patch_task` tool, the patch dispatcher and worker, the
snapshot and worktree backend, the edit-block parser and applier, the check
runner, the patch ladder, the grind loop with budgets, cancel and diagnosis,
the paid override with accounting, persistence and recovery, defaults for the
hardware floor, and the per-task numbers G1 needs.

Out of scope: many-node DAG and task split (G4); new free providers and
quota waits (G7); hardware detection, profiles and install (G8); the G1 read
surface; the local apply-model and a front door (G6); a container backend.
This PRD does not fix findings F2, F3, F5, F6 in the `route_task` path.

## 4. Flow

1. The client calls `patch_task` (§5.1). LocalLama checks the input and the
   safety rules (§6), resolves the checks (§5.4), takes the snapshot (§5.2),
   resolves the ladder and budgets (§5.5), and writes the Task, one Job
   (`kind = 'patch'`) and its `patch_state` row (§5.6) in one transaction. It
   returns `task_id`.
2. The patch dispatcher (§5.7) claims the Job.
3. The worker makes the worktree from the snapshot.
4. **Context:** the hinted files and BM25 results from the snapshot, inside
   the prompt budget (§5.8).
5. **Attempt:** the current ladder model gets the goal, the context, the
   edit-block rules and, after attempt 1, the last errors and the last edit
   blocks. It returns a complete set of edit blocks against the base.
6. **Apply:** LocalLama resets the worktree to the base and applies the
   blocks. A block that does not apply is the error for the next attempt.
7. **Check:** the check runner runs each check (§5.4).
8. **Validate** (only when `validate` is true; §5.9).
9. Pass: LocalLama makes the diff (§5.2) and the Job completes.
10. Fail: the ladder (§5.5) picks the model for the next attempt; go to
    step 5.
11. Budget ends, ladder ends, or cancel: the Job ends with a diagnosis.
12. The worker removes the worktree after the last process has exited (§5.10).
    `PATCH_KEEP_WORKSPACE_ON_FAIL=true` keeps it for debug.

## 5. Components

### 5.1 MCP tool `patch_task`

Input:

| Field | Type | Need | Notes |
|---|---|---|---|
| `goal` | string | yes | What to change, in plain words |
| `repo_path` | string | yes | Absolute path; a git repo inside an allowed root (§6) |
| `file_hints` | string[] | no | Paths relative to `repo_path` |
| `checks` | Check[] | no | Wins over `.locallama/checks.json` (Ruling 4) |
| `allow_paid` | boolean | no | Default `false` (Ruling 3) |
| `paid_cap_usd` | number | no | Total cap for the task; default `PATCH_PAID_CAP_USD` |
| `validate` | boolean | no | Default `false` for patch tasks (§5.9) |
| `max_minutes` | number | no | Overrides the time budget |

`Check` = `{ name: string, argv: string[], timeout_ms?: number,
append_changed_files?: boolean }`. Commands are argv arrays, run with no
shell.

The response of `patch_task` and the patch part of `get_task_status` are
short: no prose (G6). The tool description tells the client to apply `diff`
with `git apply` in `repo_path`, or to ask the user first.

**Result encoding:** the Job's `result` column holds a JSON string with
`"schema": "patch_result_v1"`. `get_task_status` returns it as a parsed object
for a Job with `kind = 'patch'` (today it calls `String(parsed)`, which gives
`[object Object]`). Route Jobs do not change.

```json
{
  "schema": "patch_result_v1",
  "status": "passed | failed | cancelled",
  "reason": "passed | no_checks | budget_attempts | budget_time | ladder_exhausted | paid_cap | cancelled | snapshot_failed | internal_error",
  "diff": "unified diff; empty unless passed",
  "base": "snapshot commit id",
  "files_changed": ["src/a.ts"],
  "checks": [{ "name": "tsc", "exit_code": 0, "timed_out": false, "duration_ms": 9100, "tail": "" }],
  "attempts": 4,
  "models": [{ "model_id": "…", "provider_id": "llama-cpp", "cost_class": "local", "attempts": 3 }],
  "tokens": { "local": 21000, "free": 6000, "paid": 0 },
  "cost_usd": 0,
  "elapsed_ms": 812000,
  "diagnosis": null
}
```

`diagnosis` (when not passed): the last errors (trimmed), the best attempt's
diff (most checks passed), and per attempt: model, outcome
(`apply_error | check_failed | validator_rejected | timed_out | call_error`),
and duration.

Terminal state: `passed` → Job `completed`; `failed` → Job `failed` (no
automatic retry: `retry_count` is not used for patch Jobs); `cancelled` →
Job `cancelled`.

### 5.2 Snapshot and worktree backend

`WorkspaceBackend` interface: `snapshot(repoPath, hints, jobId) → base`,
`create(base, jobId) → Workspace`, `reset(ws)`, `diff(ws) → string`,
`dispose(ws)`. The worker uses only this interface (Ruling 5 seam).

Git backend:

- **Snapshot:** with a temporary index file (`GIT_INDEX_FILE`), read `HEAD`,
  add the tracked changes of the working tree and the hinted untracked files,
  `write-tree`, and `commit-tree` with `HEAD` as parent. The result is the
  base commit `B`. Keep it alive with the ref `refs/locallama/base/<jobId>`.
  The user's tree, index, stash list and branches do not change.
- **Create:** `git worktree add --detach <scratch>/<jobId> B`. Scratch root:
  `config.rootDir/scratch/` (`SCRATCH_DIR`), not inside the target repo.
- **Links:** after create and after each reset, symlink each `links` entry
  of `.locallama/checks.json` (default: `node_modules` and `.venv` when they
  exist in the repo) from the repo into the worktree. Never install
  dependencies in a worktree.
- **Reset:** `git reset --hard B` and `git clean -fd`, with each link path
  excluded (`-e`), then make the links again.
- **Diff:** `git add -A -- . ':(exclude)<link>'…` in the worktree, then
  `git diff --cached --binary B`. This includes new files. Changes to a
  hinted untracked file show against its snapshot bytes.
- **Dispose:** `git worktree remove --force`, `git worktree prune`, and
  delete the base ref.
- **Start-up cleanup:** remove scratch worktrees and base refs that no
  non-terminal patch Job owns.

The diff applies with `git apply` to the user's working tree when that tree
is still as it was at submit time. When the client's `git apply` fails, the
client sends a new task.

### 5.3 Edit blocks

```
path/to/file.ts
<<<<<<< SEARCH
exact old text
=======
new text
>>>>>>> REPLACE
```

- An empty SEARCH part on a path that does not exist makes a new file.
- Whole-file fallback: a fenced block with the path on the line before it,
  for a new file or a file below `PATCH_WHOLE_FILE_MAX_LINES` (default 150).
- Matching: exact first, then a match that ignores trailing whitespace and
  indent. No other fuzzy match.
- Errors back to the model, short: the path, "SEARCH text not found" or
  "matches N places", and the 3 nearest lines of the file.
- Paths outside the worktree, in `.git/`, or on a link path are refused.
- The parser has unit tests on bad model output: missing markers, `<think>`
  blocks, text around the blocks, fences in the wrong place. It reuses the
  existing `<think>` strip.

### 5.4 Check runner

- Sources, in order: request `checks`, then `.locallama/checks.json`
  `checks` (read from the snapshot). With no checks, `patch_task` refuses at
  submit with `no_checks` (Ruling 1 needs a check).
- Each check: `spawn(argv[0], argv.slice(1), { cwd: worktree, shell: false,
  detached: true })`, so it has its own process group. Timeout:
  `timeout_ms` or `PATCH_CHECK_TIMEOUT_MS` (default 600000). On timeout or
  cancel: `SIGTERM` to the group, `SIGKILL` after 5 s, and the runner returns
  only after the group has exited.
- Env: `PATH`, `HOME`, the locale vars, and the names in `env_allow` of
  `.locallama/checks.json`. No other var from LocalLama's env (no API keys).
- Output capture with a size cap. Result per check: `{ name, exit_code,
  timed_out, duration_ms, tail }`. `tail` = the last lines of stderr and
  stdout, cut to `PATCH_ERROR_TAIL_TOKENS` (default 800).
- Checks run in order and stop at the first failure.
- `append_changed_files` adds the changed paths to the argv.

`.locallama/checks.json`:

```json
{
  "checks": [
    { "name": "tsc", "argv": ["npx", "tsc", "--noEmit"] },
    { "name": "unit", "argv": ["npx", "jest", "--findRelatedTests"], "append_changed_files": true }
  ],
  "links": ["node_modules"],
  "env_allow": ["NODE_OPTIONS"]
}
```

### 5.5 Patch ladder and grind loop

**Ladder** (built at submit, stored in `patch_state`, not changed after):

1. Local: the models that each local provider in `ProviderRegistry` reports
   now (including the llama.cpp router models), ranked by the `code` score
   from `ModelRegistry` (a model with no score ranks last). Remove
   duplicates. Keep the top `PATCH_LOCAL_MODELS` (default 2).
2. Free: the free remote models (cost 0), ranked the same way. Keep the top
   `PATCH_FREE_MODELS` (default 2). A free provider with no rate budget now
   is skipped at call time (no wait; waiting is G7).
3. Paid: only with `allow_paid` and `OPENROUTER_FREE_ONLY` off. The top
   `PATCH_PAID_MODELS` (default 1) whose prices are known.

A request with an empty ladder refuses at submit with `ladder_exhausted`.

**Attempts:** each ladder model gets `PATCH_ATTEMPTS_PER_MODEL` (default 3)
attempts in order. All attempts of one model run before the next model. The
loop moves to the next model early when an attempt gives the same error
signature (check name + first error line) as the one before it.

**Stop** at the first of: pass; `PATCH_MAX_ATTEMPTS` (default 12, counted
across the whole ladder); the deadline (`submit time + PATCH_TASK_TIMEOUT_MS`,
default 2 h, or `max_minutes`); the end of the ladder; the paid cap; cancel.

**Prompt per attempt:** a patch-specific system prompt (the edit-block rules;
not the existing "give the whole implementation" coding instruction), the
goal, the context, and after attempt 1 only the last errors and the last edit
blocks. Each attempt asks for a complete set of blocks against the base.

**Model calls:** through `ProviderRegistry.executeWithConcurrencyLimit` and
the provider's `executeTask`, with the existing context-window guard, the
patch inference timeout (§7), the cancel signal (§5.10), and an output cap
`PATCH_MAX_OUTPUT_TOKENS` (default 2000).

### 5.6 Persistence

All in `jobs.db`, additive (separate `CREATE TABLE IF NOT EXISTS` and
`ALTER TABLE`, not in the main DDL block; risk R4):

- `jobs.kind TEXT` (`'route' | 'patch'`, null = route).
- `patch_state` (one row per patch Job): `job_id`, `request_json`,
  `base_commit`, `checks_json`, `ladder_json`, `settings_json` (every
  resolved budget and default), `deadline_at`, `cursor_model`,
  `attempts_used`, `paid_spent_usd`, `paid_reserved_usd`, `updated_at`.
- `patch_attempts`: `id`, `job_id`, `n`, `model_id`, `provider_id`,
  `cost_class`, `prompt_tokens`, `completion_tokens`, `cost_usd`,
  `edit_blocks`, `outcome`, `apply_error`, `checks_json`, `duration_ms`,
  `started_at`, `ended_at`.

The worker writes `attempts_used` and the cursor before each model call, so
an attempt in flight at a crash counts as used.

Terminal writes are conditional: `UPDATE … WHERE status NOT IN
('completed','failed','cancelled','permanently_failed')`, so a late write
cannot overwrite a cancel.

### 5.7 Patch dispatcher and recovery

The existing route path starts work at submit and has no queue consumer;
`recoverInProgressJobs` only changes row status. Patch Jobs get their own
dispatcher; the route path does not change.

- The dispatcher runs at start-up and after each `patch_task` submit or
  patch Job end. It claims the oldest `queued` patch Job with an atomic
  `UPDATE … SET status='in_progress' WHERE id=? AND status='queued'` (one
  changed row = claimed) and runs the worker.
- Concurrency: one patch worker at a time by default
  (`PATCH_MAX_CONCURRENT`, default 1). The provider slots still apply to
  each model call.
- **Recovery** at start-up, before the dispatcher: each `in_progress` patch
  Job goes back to `queued` with its `patch_state` unchanged. The worker
  makes a new worktree from the stored `base_commit` (never from the repo's
  current state) and goes on from the stored cursor and `attempts_used`. The
  deadline does not move. A Job past its deadline ends at once with
  `budget_time`.
- `recoverInProgressJobs` skips Jobs with `kind = 'patch'`.

### 5.8 Context budget

- Prompt budget per attempt = min(model context window, `PATCH_CONTEXT_TOKENS`
  default 6000) − `PATCH_MAX_OUTPUT_TOKENS` − the system prompt.
- Order of fill: the goal; the hinted files (whole, or cut with a note); the
  last errors and blocks (attempt 2+); BM25 results from the snapshot
  (`CodeSearchEngine` on the worktree) until the budget is full.

### 5.9 Validator

Ruling 1 keeps `OutputValidator` as an extra filter. It costs one more model
call per passing attempt on slow hardware, so for patch tasks it is opt-in:
`validate` defaults to `false`.

With `validate: true`: after the checks pass, a validator model (the next
ladder model of a different family when one exists, else the same model) gets
the goal and the diff. The call goes through the same registry path and
budgets. `passed: false` → the attempt is `validator_rejected` and its reason
is the error for the next attempt. `passed: null` or `skipped` → the result
stands (the checks are the proof) and `skipped` is recorded.

### 5.10 Cancel

- Each running patch Job has an `AbortController`. `cancel_task` on a patch
  Job sets the row to `cancelled` (as today) and aborts the controller.
- The worker checks the signal between steps.
- A model call: the signal goes in an optional `signal` field of the task
  execution options. A provider that cannot abort a call is left to finish;
  its output is discarded.
- A check: the runner kills the process group (§5.4).
- The worktree is removed only after the last check process has exited.
- A queued patch Job that is cancelled is never claimed (the claim needs
  `status='queued'`).

### 5.11 Paid accounting

Only when `allow_paid` is true:

- Before each paid call: reservation = prompt tokens × prompt price +
  `PATCH_MAX_OUTPUT_TOKENS` × completion price. If `paid_spent_usd +
  reservation > paid_cap_usd`, the loop stops with `paid_cap`. The
  reservation is written to `paid_reserved_usd` before the call.
- After the call: the actual cost from the provider's usage when it returns
  usage, else the reservation. Add it to `paid_spent_usd`; clear the
  reservation.
- A paid model with an unknown price is not put on the ladder (an unknown
  price never counts as zero).
- The generation call and the validator call both count.

### 5.12 Telemetry and G1 inputs

`withSpan` on: snapshot, worktree create, each attempt, each check, diff. Per
task: tokens per cost class, `cost_usd`, `elapsed_ms`, attempts, outcome.
Local and free providers that do not return usage: count tokens with the
existing `js-tiktoken` counter on prompt and output. G1 reads
`patch_attempts`; this PRD adds no G1 surface.

## 6. Safety

**Ruled 2026-11-01 (maintainer): approved as written below.**

- `patch_task` is off unless the operator sets `PATCH_TASKS_ENABLED=true`.
  The tool is not listed while it is off.
- `repo_path` must be inside a root in `PATCH_REPO_ROOTS` (a path list). No
  default root.
- LocalLama writes only in the scratch root and the base ref. The user's tree
  changes only when the client applies the diff (Ruling 2).
- Checks run as the user, in the worktree, with no shell, a timeout and the
  controlled env of §5.4. This is not a sandbox; the container backend
  (later) is the sandbox. The tool description says so.
- The edit applier refuses paths outside the worktree, in `.git/` and on a
  link path.

## 7. Hardware floor (Ruling 9)

- **Inference timeout:** patch model calls use `PATCH_INFERENCE_TIMEOUT_MS`
  (default 900000), not the global 120 s default.
- **One model in RAM:** the attempts of one model run together (§5.5), so a
  run changes the local model at most `PATCH_LOCAL_MODELS − 1` times. LocalLama
  cannot unload a llama.cpp router model itself (`releaseResources` is a
  no-op), so it depends on the runtime: llama-router with `--models-max 1`,
  or Ollama's own unload. The tool description and `wiki/12-patch-tasks.md`
  say so. G8's first-run check will warn when the runtime can keep more than
  one model.
- Checks run one at a time and stop at the first failure.
- The live seed test (§9) runs once in a simulation of the floor:
  llama.cpp with `-ngl 0` (no GPU), the process limited to 8 GB with
  `systemd-run --user --scope -p MemoryMax=8G`. The report names it a
  simulation and records RAM peak and time.

## 8. Docs that change with the code

- `CONTEXT.md`: Patch Task, Snapshot, Scratch Workspace, Edit Block, Check,
  Attempt, Patch Ladder, Diagnosis.
- `wiki/10-glossary.md`: short entries that point to `CONTEXT.md`.
- New wiki page `wiki/12-patch-tasks.md`; links from `wiki/README.md` and
  `wiki/02-mcp-surface.md`.
- ADR `docs/adr/0004-patch-tasks-in-git-worktrees-with-edit-blocks.md`
  (Rulings 5, R-A, R-B, R-D and the `git` need).
- `docs/OPERATIONAL_TEST_PLAN.md`: the live seed results.

## 9. Acceptance criteria

G2:
1. `patch_task` with a valid input returns a `task_id` in under 1 s.
2. On a fixture repo, a passing result's `diff` applies with `git apply` in
   the repo and the same checks pass there. A diff that adds a new file also
   applies.
3. The user's working tree, index, stash list and branches are the same
   before and after a task (test with a dirty tree and a hinted untracked
   file).
4. With no checks from either source, `patch_task` refuses with `no_checks`.
5. An edit block on a path outside the worktree, in `.git/` or on a link
   path is refused and reported to the model.
6. With `PATCH_TASKS_ENABLED` off, the tool is not listed and a call fails.
7. No scratch worktree or base ref is left after a pass, a failure, a cancel,
   or a restart (except with `PATCH_KEEP_WORKSPACE_ON_FAIL`).
8. `get_task_status` returns the `patch_result_v1` object, not a string.
9. With llama.cpp router models available, the ladder includes them.

G3:
10. A failed check's `tail` is in the next attempt's prompt.
11. The loop obeys each stop condition of §5.5; `reason` names it.
12. With `allow_paid` false, no paid model is called (test with paid models
    available).
13. With `allow_paid` true, `paid_spent_usd` never goes above `paid_cap_usd`
    (test with a fake provider that reports usage and one that does not).
14. After a restart mid-task, the task goes on from the stored base, cursor
    and attempt count; the deadline does not move.
15. `cancel_task` on a running patch Job stops the check process group and
    the Job ends `cancelled`; no later write changes that.
16. **Seed set:** the fixed set of §9.1. Live, local and free models only:
    the pass rate with `PATCH_MAX_ATTEMPTS=12` is higher than with
    `PATCH_MAX_ATTEMPTS=1`, at $0, over the protocol of §9.1.
17. Criterion 16 runs once in the floor simulation of §7 and finishes.

All: `npx tsc --noEmit` passes; the full suite passes; unit tests exist for
the parser, the applier, the snapshot and diff (in a temp git repo), the check
runner (with a fake command and a process that ignores `SIGTERM`), the
ladder, the loop and recovery (with a fake provider).

### 9.1 Seed protocol

- Two fixture repos in `test/fixtures/patch-seed/`: one TypeScript (with
  `tsc` and a jest test), one Python (with `pytest`).
- 10 requests, each with: the goal, the checks, and a hidden acceptance test
  that the model does not see. A pass needs the task checks and the hidden
  test to pass. Requests go from easy (one function) to medium (two files).
- The model list, runtime and settings are fixed and recorded before the run.
- Each request runs 3 times per condition. Report the pass rate per
  condition, and time and tokens per pass.

## 10. Issues (wave order)

Each issue owns its paths. Issues in one wave own disjoint paths. `src/index.ts`
and `src/modules/api-integration/routing/index.ts` change in one issue only
(issue 8).

| # | Issue | Owns | Wave |
|---|---|---|---|
| 1 | Contracts: shared types and interfaces (`WorkspaceBackend`, `EditBlock`, `CheckSpec`, `CheckResult`, `PatchState`, `LadderEntry`, `PatchResultV1`), config keys and safety flags | `src/modules/patch/types.ts`, `src/config/index.ts`, `.env.example` | 1 |
| 2 | Docs: `CONTEXT.md` terms, glossary, ADR 0004 | `CONTEXT.md`, `wiki/10-glossary.md`, `docs/adr/0004-*` | 1 |
| 3 | Edit-block parser and applier | `src/modules/patch/edit-blocks/**`, `test/modules/patch/edit-blocks*` | 2 |
| 4 | Check runner and `checks.json` loader | `src/modules/patch/checks/**`, `test/modules/patch/checks*` | 2 |
| 5 | Snapshot and git worktree backend | `src/modules/patch/workspace/**`, `test/modules/patch/workspace*` | 2 |
| 6 | Persistence: `jobs.kind`, `patch_state`, `patch_attempts`, conditional terminal writes; `recoverInProgressJobs` skips patch Jobs | `src/modules/job-store/**`, `test/modules/job-store/*` | 2 |
| 7 | Patch ladder, prompt builder, context budget, paid accounting | `src/modules/patch/ladder/**`, `src/modules/patch/prompt/**`, their tests | 2 |
| 8 | Optional `signal` in task execution options; providers pass it where they can | `src/modules/core/provider/types.ts`, `src/modules/*/provider.ts`, their tests | 2 |
| 9 | Patch worker and grind loop, validator wrapper, cancel | `src/modules/patch/worker/**`, its tests | 3 (after 3-8) |
| 10 | Dispatcher, recovery, start-up cleanup, `patch_task` tool, `get_task_status` / `cancel_task` patch branch | `src/modules/patch/dispatcher/**`, `src/index.ts`, `src/modules/api-integration/tool-definition/index.ts`, `src/modules/api-integration/routing/index.ts`, their tests | 4 (after 9) |
| 11 | Seed set, fixture repos, live runs, floor simulation, wiki page | `test/fixtures/patch-seed/**`, `scripts/patch-seed/**`, `wiki/12-patch-tasks.md`, `wiki/README.md`, `wiki/02-mcp-surface.md`, `docs/OPERATIONAL_TEST_PLAN.md` | 5 (after 10) |

Issue 1 lands first, so that wave-2 lanes build against the same contracts.
Wave-2 lanes run one at a time on the opencode runner (one lane at a time),
in this order: 6, 3, 4, 5, 7, 8.

## 11. Open questions

1. Default ladder on the floor before G7/G8: which local (1-3B) and free
   models? Research lane R1 answers this; until then the ladder rules of §5.5
   apply.
2. Does a repo without git get a copy backend before the container backend?
