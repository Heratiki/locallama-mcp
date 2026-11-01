# Patch worker

`new PatchWorker({ backend, registry? }).run(jobId)` runs a **claimed** patch
Job. The backend is bound to the submitted repository. The registry defaults to
the existing `ProviderRegistry`; the store defaults to `job-store`. Neither
submission nor dispatch is performed here.

The dispatcher must retain the worker instance and, after marking a Job cancelled,
call `worker.cancel(jobId)`. This aborts discovery, queued inference, active
inference, and the active check group. `run()` resolves after check descendants
have exited and workspace disposal has finished. Providers that ignore abort
retain their registry slot until they finish; their output is discarded. The
worker waits for a timed-out call to finish before calling another model.

Use `snapshotPatchWorkspace(backend, repo, hints, jobId)` at submission for the
snapshot span. The worker never snapshots again, including on recovery. It
creates from `patch_state.base_commit` and retains `deadline_at`. An expired Job
creates only a workspace handle for cleanup, with no context, inference or checks.

`request_json` contains the PRD input (`goal`, `repo_path`, `file_hints`,
`allow_paid`, `paid_cap_usd`, `validate`). `checks_json` accepts either the resolved
CheckSpec array or a complete ChecksConfig. With an array, `env_allow` is loaded
from the snapshot before any edits. `settings_json` uses the existing camelCase
config keys in `WorkerSettings`. Submission should persist every resolved value;
missing keys fall back to config for compatibility. No deadline is recalculated.

An attempt starts durably before its model call. Rejected paid reservations do
not consume attempts. On restart, missing attempt rows become interrupted-call
diagnoses; they count against the persisted model and total attempt budgets.
Existing rows restore feedback, the best diff, usage and validator details. A
durably passing attempt can finish without calling a model again.

`patch_attempts.edit_blocks` stores worker-owned JSON:

```ts
{ blocks, calls, validation?, diff, files }
```

This retains validator usage by cost class and the best diff across restarts
without changing shared tables. Legacy bare edit-block arrays are also read.
`checks_json` remains a CheckResult array. A successful attempt has outcome
`passed`; unsuccessful attempts use the shared AttemptOutcome values. The result
retains all `patch_result_v1` fields and adds `validation`, an array of judge
verdicts including null/skipped results. Judge calls use the same context guard,
inference timeout, output limit, cancellation, provider slots and paid ledger.
An unavailable or unparseable judge is recorded as skipped; explicit rejection
feeds its reason into the next prompt. Task budget and cancel override a skip.

An interrupted paid reservation is charged conservatively on recovery because
the provider may already have billed it. Normal calls reserve their maximum
output cost before execution, then settle reported usage or the reservation.
Actual provider charges are retained even if a provider reports usage beyond
the reservation; the next paid reservation is refused. This preserves the
merged ledger's accounting contract rather than hiding an upstream overcharge.

Failed and cancelled workspaces are retained only when
`patchKeepWorkspaceOnFail` is true. Backend creation/disposal errors propagate or
produce `internal_error`; the backend has no handle-free base-ref disposal API,
so a failure to create a handle requires dispatcher orphan cleanup on startup.
