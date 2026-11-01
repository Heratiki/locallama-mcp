# Patch dispatcher and submit

`submitPatchTask(args, deps?)` is the `patch_task` tool (PRD 01 §4 step 1,
§5.1, §6). In order: refuse `patch_tasks_disabled` while
`PATCH_TASKS_ENABLED` is off; check the input (`invalid_input`); require the
real path of `repo_path` to be inside the real path of a `PATCH_REPO_ROOTS`
entry (`repo_not_allowed`; no default root); snapshot (`snapshot_failed`);
resolve checks from the request, else from the snapshot's
`.locallama/checks.json` (`no_checks`); build the ladder
(`ladder_exhausted`); write Task + Job + `patch_state` in one transaction;
kick the dispatcher; return `{ task_id, job_id, status: 'queued' }`. A
refusal throws `PatchRefusal` with `code`; `src/index.ts` returns
`{ error: code, message }` as a tool error. A refusal after the snapshot
removes its base ref. `patch_state` stores the real repo path, every resolved
request value, the resolved checks config and the worker settings.

`getPatchDispatcher()` is the process-wide `PatchDispatcher`:

- `start()`: recovery before dispatch. Requeues `in_progress` patch Jobs
  (state unchanged), then for every repository named by a patch Job runs
  `cleanupOrphans` with the ids of the live (queued or in-progress) patch Jobs
  plus any submit in flight, then `kick()`.
- `kick()`: claims the oldest queued patch Job atomically while fewer than
  `PATCH_MAX_CONCURRENT` (default 1) workers run. Runs after start-up, each
  submit and each Job end. A cancelled queued Job is never claimed.
- `cancel(jobId)`: aborts the running worker; `cancel_task` calls it after it
  writes the row `cancelled`.
- A worker that throws ends its Job `failed` / `internal_error` with a
  `patch_result_v1` result (conditional write: a cancel wins).

The server starts the dispatcher only while `PATCH_TASKS_ENABLED` is on.
Orphans in a repository that no patch Job names are not found.
