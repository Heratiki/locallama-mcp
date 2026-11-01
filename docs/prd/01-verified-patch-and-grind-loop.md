# PRD 01 — Verified Patch and Grind Loop (G2 + G3)

_Status: draft, 2026-11-01. Goals G2 and G3 of `docs/prd/00-goals-roadmap.md`.
Grounding: `docs/prd/validated-patch-dag/00-repo-grounding-and-reuse-map.md`._

## 1. Summary

A client sends a code request with the new MCP tool `patch_task`. LocalLama
makes a scratch `git worktree` of the target repo. A small local or free model
writes search/replace edit blocks. LocalLama applies them, runs the repo's
checks in the worktree, and gives any errors back to the model for another
attempt. It returns a unified diff when every check passes, or a diagnosis when
the budget ends. It never writes the user's working tree.

This is the patch DAG with one node. G4 (many nodes) builds on it.

## 2. Rulings this PRD obeys

From `docs/prd/00-goals-roadmap.md`, Rulings 1-9, and two rulings of
2026-11-01 for this PRD:

- **R-A Edit format:** the model writes search/replace blocks. LocalLama
  applies them and makes the real diff with `git diff`. Whole-file output is
  the fallback for a new file and for a file below a size limit.
- **R-B MCP tool:** a new tool `patch_task`. It uses the persistent Task/Job
  queue and returns `task_id` at once. The client polls the existing
  `get_task_status` and stops a task with the existing `cancel_task`.
  `route_task` does not change.

The grounding map says "no dependency on `git apply`". Ruling 5 (git worktree)
replaces that: patch tasks need `git` on PATH and a git repo as the target.

## 3. Scope

In scope:
- `patch_task` tool, worker, result shape.
- Scratch workspace with a backend seam; the git worktree backend.
- Edit-block parser and applier.
- Check runner.
- Grind loop: error feedback, retries, model ladder, budgets, diagnosis,
  paid override.
- Persistence of attempts, and recovery after a restart.
- Defaults for the hardware floor (Ruling 9).
- The per-task numbers that G1 needs (tokens per cost class, dollars, time).

Out of scope (other goals):
- Many-node DAG, task split (G4).
- New free providers, quota-wait queue (G7). This PRD uses the providers that
  exist now.
- Hardware detection, profiles, one-command install (G8). This PRD only sets
  defaults that work on the floor.
- The G1 read surface (the MCP read and `get_system_state` fields).
- The local apply-model and a built-in front door (G6).
- A container backend (later, behind the seam of §5.2).

## 4. Flow

1. The client calls `patch_task` (§5.1). LocalLama checks the input, makes a
   Task and one Job, and returns `task_id`.
2. The worker takes the Job when a provider slot is free (existing slot rules).
3. **Workspace:** the backend makes a scratch worktree of the repo's current
   state, including uncommitted changes to tracked files (§5.2).
4. **Context:** LocalLama reads the hinted files and adds BM25 results from the
   repo (`CodeSearchEngine`), inside a token budget for the chosen model.
5. **Attempt:** the chosen model gets the goal, the context, the edit-block
   rules and (after attempt 1) the errors of the last attempt. It returns edit
   blocks.
6. **Apply:** LocalLama applies the blocks in the worktree. A block that does
   not match is an error for the next attempt.
7. **Check:** the check runner runs each check in the worktree (§5.4).
8. All checks pass: LocalLama runs `OutputValidator` as an extra filter
   (Ruling 1; skip with `validate: false`), takes `git diff`, and the Job
   completes with the diff.
9. A check fails: LocalLama resets the worktree to the base state and goes to
   step 5 with the errors. The ladder (§5.5) chooses the model.
10. Budget ends: the Job completes with status `failed` and a diagnosis
    (Ruling 3).
11. The workspace is removed in every case, but stays for
    `PATCH_KEEP_WORKSPACE_ON_FAIL` (debug).

## 5. Components

### 5.1 MCP tool `patch_task`

Input:

| Field | Type | Need | Notes |
|---|---|---|---|
| `goal` | string | yes | What to change, in plain words |
| `repo_path` | string | yes | Absolute path; must be a git repo inside an allowed root (§6) |
| `file_hints` | string[] | no | Paths relative to `repo_path` |
| `checks` | Check[] | no | Wins over `.locallama/checks.json` (Ruling 4) |
| `allow_paid` | boolean | no | Default `false` (Ruling 3) |
| `paid_cap_usd` | number | no | Per-task cap when `allow_paid`; default from config |
| `validate` | boolean | no | Default `true`; turns off the `OutputValidator` filter only |
| `max_minutes` | number | no | Overrides the time budget |

`Check` = `{ name: string, argv: string[], timeout_ms?: number }`. Commands are
argv arrays, run with `execFile` and no shell.

Result (in `get_task_status`, on the Job's `result`):

```json
{
  "status": "passed | failed | cancelled",
  "diff": "unified diff, empty when failed",
  "base": "commit id the diff applies to",
  "files_changed": ["src/a.ts"],
  "checks": [{ "name": "tsc", "exit_code": 0, "duration_ms": 9100, "tail": "" }],
  "attempts": 4,
  "models": [{ "model_id": "…", "provider_id": "ollama", "cost_class": "local", "attempts": 3 }],
  "tokens": { "local": 21000, "free": 6000, "paid": 0 },
  "cost_usd": 0,
  "elapsed_ms": 812000,
  "diagnosis": null
}
```

`diagnosis` (when failed): the last check errors (trimmed), the best attempt's
diff (most checks passed), the models tried and why the loop stopped
(`budget_attempts`, `budget_time`, `ladder_exhausted`, `paid_cap`).

The response is short: no prose (G6). The tool description tells the client:
apply `diff` with `git apply` at `base`, or ask the user first.

### 5.2 Scratch workspace

`WorkspaceBackend` interface: `create(repoPath, jobId) → Workspace`,
`reset(ws)`, `diff(ws) → string`, `dispose(ws)`. The worker uses only this
interface (Ruling 5 seam).

Git worktree backend:
- Base = `git stash create` (a commit object of the tracked uncommitted
  changes; the user's tree does not change), or `HEAD` when the tree is
  clean. Untracked files are not in the base, except files in `file_hints`,
  which LocalLama copies in.
- `git worktree add --detach <scratch>/<jobId> <base>`; remove with
  `git worktree remove --force`, then `git worktree prune`.
- Scratch root: `config.rootDir/scratch/` (`SCRATCH_DIR`). Not inside the
  target repo.
- Links: folders from `links` in `.locallama/checks.json` (default
  `node_modules`, `.venv` when present) are symlinked from the repo into the
  worktree. Never install dependencies in a worktree.
- `reset` = `git checkout -- . && git clean -fd` in the worktree, then copy the
  hinted untracked files again.
- On start-up, LocalLama removes scratch worktrees that no live Job owns.

### 5.3 Edit blocks

Format the model writes (one or more):

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
  indent. No fuzzy match beyond that.
- Errors go back to the model in short form: the path, "SEARCH text not
  found" or "matches N places", and the 3 nearest lines of the file.
- Paths outside the worktree, and paths in `.git/`, are refused.
- The parser lives in its own module with unit tests on bad model output
  (missing markers, `<think>` blocks, text around the blocks). It reuses the
  existing `<think>` strip.

### 5.4 Check runner

- Order of sources: request `checks` → `.locallama/checks.json` `checks` →
  none. With no checks, the task fails at once with `no_checks` (Ruling 1
  needs a check).
- Each check runs with `execFile(argv[0], argv.slice(1), { cwd: worktree })`,
  a timeout (`PATCH_CHECK_TIMEOUT_MS`, default 600000 for the floor), output
  capture with a size cap, and a controlled env: `PATH`, `HOME`, the lang
  vars, plus `env_allow` names from `.locallama/checks.json`. No API keys
  from LocalLama's own env.
- Result per check: `{ name, exit_code, timed_out, duration_ms, tail }`.
  `tail` = the last lines of stderr and stdout, cut to `PATCH_ERROR_TAIL_TOKENS`
  (default 800) so it fits a small model's context.
- Checks run in order, and the run stops at the first failure (saves CPU
  time on the floor).
- The timeout error reuses the `InferenceTimeoutError` pattern.

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

`append_changed_files` adds the changed paths to the argv, for scoped tests.

### 5.5 Grind loop and ladder

- The ladder is the existing ranked trio (`buildRankedTrio`): `good` →
  `better` → `best`, local tier first, then free tier.
- Each model gets `PATCH_ATTEMPTS_PER_MODEL` attempts (default 3) before the
  loop moves to the next model.
- After a failed attempt, the next prompt has the errors and the last edit
  blocks, not the full history (small contexts).
- **Stop** at the first of: all checks pass; `PATCH_MAX_ATTEMPTS` (default
  12); the time budget (`PATCH_TASK_TIMEOUT_MS`, default 2 h for the floor);
  the ladder ends; `cancel_task`.
- **Same error twice:** if an attempt gives the same check error as the one
  before it, the loop moves to the next model early.
- **Paid override:** with `allow_paid: true` and `OPENROUTER_FREE_ONLY` off,
  the ladder adds the paid tier after the free tier. The loop stops before a
  call whose estimate goes above `paid_cap_usd`. Default: no paid tier.
- Every model call goes through `ProviderRegistry` (slots, circuit breaker,
  rate limiter). The existing context-window guard runs before each call.
- Free-tier rate limits: when a free provider has no budget, the loop moves to
  the next model. It does not wait (waiting is G7).
- Model choice uses the `code` category score.

### 5.6 Persistence and recovery

- New table `patch_attempts` in `jobs.db` (additive; a separate
  `CREATE TABLE IF NOT EXISTS`, not in the main DDL block, risk R4):
  `id, job_id, n, model_id, provider_id, cost_class, prompt_tokens,
  completion_tokens, cost_usd, edit_blocks, apply_error, checks_json,
  passed, created_at`.
- New nullable column `jobs.kind` (`'route' | 'patch'`), via `ALTER TABLE`.
- Patch input is stored as JSON in `task_text`.
- The ranked trio is stored with the Job (risk R8), so a restart does not
  lose the ladder.
- Recovery: an `in_progress` patch Job is put back in the queue. The worker
  makes a new workspace and goes on from the attempt count in
  `patch_attempts`, with the last stored errors.

### 5.7 Telemetry and G1 inputs

- `withSpan` on: workspace create, each attempt, each check, diff.
- Per task: tokens per cost class, `cost_usd`, `elapsed_ms`, attempts,
  passed. G1 reads these from `patch_attempts`; this PRD adds no G1 surface.

## 6. Safety

Risk R5 (file change needs an approval path) and R6 (no isolation):

- `patch_task` is off unless the operator sets `PATCH_TASKS_ENABLED=true`.
  The tool is not listed while it is off.
- `repo_path` must be inside a root in `PATCH_REPO_ROOTS` (a path list). No
  default root.
- LocalLama writes only in the scratch root. The user's tree changes only when
  the client applies the diff (Ruling 2).
- Checks run as the user, in the worktree, with no shell, a timeout and the
  controlled env of §5.4. This is not a sandbox; the container backend (later)
  is the sandbox. The tool description says so.
- The edit applier refuses paths outside the worktree and in `.git/`.

## 7. Hardware floor (Ruling 9)

- Timeouts default long (§5.4, §5.5) and are settings.
- The context budget for each attempt fits the model's declared window, with
  a default cap of `PATCH_CONTEXT_TOKENS` = 6000.
- One local model in RAM at a time: the shared local slot already serializes
  local calls; the ladder must not hold two local models.
- Checks run one at a time and stop at the first failure.
- The live seed test (§9) runs once on a CPU-only, 8 GB machine.

## 8. Docs that change with the code

- `CONTEXT.md`: Patch Task, Scratch Workspace, Edit Block, Check, Attempt,
  Diagnosis.
- `wiki/10-glossary.md`: short entries that point to `CONTEXT.md`.
- New wiki page `wiki/12-patch-tasks.md`; links from `wiki/README.md` and
  `wiki/02-mcp-surface.md`.
- ADR `docs/adr/0004-patch-tasks-in-git-worktrees-with-edit-blocks.md`
  (Rulings 5, R-A, R-B and the `git` need).
- `docs/OPERATIONAL_TEST_PLAN.md`: the live seed results.

## 9. Acceptance criteria

G2:
1. `patch_task` with a valid input returns a `task_id` in under 1 s and the
   Job enters the queue.
2. On a fixture repo, a passing result's `diff` applies with `git apply` at
   `base` and the same checks pass in the real tree.
3. The user's working tree, index and stash list are the same before and
   after a task (test with a dirty tree).
4. With no checks from either source, the task fails with `no_checks`.
5. A path outside the worktree or in `.git/` in an edit block is refused and
   reported to the model.
6. With `PATCH_TASKS_ENABLED` off, the tool is not listed and a call fails.
7. No scratch worktree is left after a pass, a failure, a cancel or a restart
   (except with `PATCH_KEEP_WORKSPACE_ON_FAIL`).

G3:
8. A failed check's `tail` is in the next attempt's prompt.
9. The loop obeys each stop condition of §5.5; the diagnosis names the
   reason.
10. With `allow_paid` false, no paid model is called (test with paid models
    available).
11. With `allow_paid` true, total paid cost stays under `paid_cap_usd`.
12. After a restart in mid-task, the task goes on from the stored attempt
    count.
13. **Seed set:** 10 requests on two fixture repos (TypeScript, Python),
    from easy to medium. Live, local and free models only: the pass rate with
    the loop is higher than with `PATCH_MAX_ATTEMPTS=1`, at $0. Results go in
    `docs/OPERATIONAL_TEST_PLAN.md`.
14. Criterion 13 runs once on the hardware floor (8 GB, CPU only) and
    finishes.

All: `npx tsc --noEmit` passes; the full suite passes; unit tests exist for
the edit parser, the applier, the check runner (with a fake command) and the
loop (with a fake provider).

## 10. Proposed issues (wave order)

Each issue owns its paths. Issues in the same wave own disjoint paths.

| # | Issue | Owns | Wave |
|---|---|---|---|
| 1 | `CONTEXT.md` terms, glossary, ADR 0004 | `CONTEXT.md`, `wiki/10-glossary.md`, `docs/adr/0004-*` | 1 |
| 2 | Edit-block parser and applier | `src/modules/patch/edit-blocks/**`, its tests | 1 |
| 3 | Check runner and `.locallama/checks.json` loader | `src/modules/patch/checks/**`, its tests | 1 |
| 4 | Workspace seam and git worktree backend | `src/modules/patch/workspace/**`, its tests | 1 |
| 5 | Persistence: `patch_attempts`, `jobs.kind`, stored trio | `src/modules/job-store/**` | 1 |
| 6 | Config keys and safety flags | `src/config/index.ts`, `.env.example` | 1 |
| 7 | Patch worker and grind loop | `src/modules/patch/worker/**`, its tests | 2 (after 2-6) |
| 8 | `patch_task` tool and registration | `src/modules/api-integration/tool-definition/index.ts`, routing glue | 3 (after 7) |
| 9 | Recovery of patch Jobs, start-up scratch cleanup | `src/modules/job-store/recovery.ts`, `src/modules/patch/workspace/**` | 3 |
| 10 | Seed set, fixture repos, live runs, wiki page | `test/fixtures/patch-seed/**`, `wiki/12-patch-tasks.md`, `docs/OPERATIONAL_TEST_PLAN.md` | 4 |

Issue 9 changes `patch/workspace/**` after issue 4 merges.

## 11. Open questions

1. Default ladder on the floor before G7/G8: which local models (1-3B) and
   which free models? R1 research answers this. Until then, the existing
   trio choice applies.
2. Does `OutputValidator` stay on by default for patch tasks? It costs one
   more model call per passing attempt on slow hardware.
3. Does a repo without git get a copy backend before the container backend?
