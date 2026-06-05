# Job Recovery — Design Spec

**Issue:** #33  
**ADR:** docs/adr/0001-non-blocking-route-task-with-persistent-job-queue.md  
**Date:** 2026-05-19

## What we're building

On server startup, detect Jobs left in `in_progress` state from a prior session, recover them with one automatic retry, and surface a Boot-time Alert to the user and MCP clients when failed Jobs need attention.

## New files

### `src/modules/job-store/recovery.ts`

Single exported function: `recoverInProgressJobs(): Promise<{ recovering: number; permanentlyFailed: number }>`

Logic:
1. Query all Jobs with `status = 'in_progress'` from the DB.
2. For each:
   - `retry_count === 0` → `updateJob({ id, status: 'queued', retry_count: 1 })`. The Provider Queue will pick it up naturally on next dispatch.
   - `retry_count >= 1` → `updateJob({ id, status: 'permanently_failed' })`. No further retry.
3. Return counts of each outcome.

No provider/model selection happens here — re-queued Jobs use their stored `provider_id` and `model_id`. If those are no longer available, the dispatch layer handles the fallback (circuit breaker / routing decision).

### `src/modules/job-store/alert.ts`

In-memory cached alert state to avoid a DB query on every tool call.

```ts
export async function refreshAlertState(): Promise<void>
export function isAlertActive(): boolean
export async function buildQueueAlert(): Promise<{ failed: number; permanently_failed: number } | null>
```

- `refreshAlertState()` queries `SELECT COUNT(*) FROM jobs WHERE status IN ('failed', 'permanently_failed')` and caches the result in a module-level variable.
- `isAlertActive()` returns the cached boolean synchronously.
- `buildQueueAlert()` queries counts per status and returns the payload, or `null` if both are zero.

Alert refreshes:
- After `recoverInProgressJobs()` completes at startup.
- After any `failJob()` or permanently-failed transition in `JobTracker`.
- After any `cancelJob()` that might clear the last failure (refresh covers this).

## Modified files

### `src/modules/decision-engine/services/jobTracker.ts`

- Import `refreshAlertState` from `../../job-store/alert.js`.
- Call `await refreshAlertState()` at the end of `failJob()` and at the end of `cancelJob()`.
- Call `await refreshAlertState()` at the end of `initializeTracker()` (after `initJobStore()`).

### `src/index.ts`

**Startup wiring** — after `JobTracker` is initialized (inside the `LocalLamaMcpServer` init sequence, after `registry.initAll()` or alongside it):
```ts
const { recoverInProgressJobs } = await import('./modules/job-store/recovery.js');
const { refreshAlertState } = await import('./modules/job-store/alert.js');
const recovery = await recoverInProgressJobs();
await refreshAlertState();
if (recovery.recovering > 0 || recovery.permanentlyFailed > 0) {
  logger.warn(
    `[locallama] Job Queue alert: ${recovery.recovering} recovering, ` +
    `${recovery.permanentlyFailed} permanently failed. ` +
    `Call get_task_status to inspect or cancel.`
  );
}
```

**Tool response wiring** — add `_queue_alert` to every tool result when active. Alongside the existing `attachMonitoringInfo` call in the tool handler:
```ts
async function attachQueueAlert(result: unknown): Promise<unknown> {
  if (!isAlertActive()) return result;
  const alert = await buildQueueAlert();
  if (!alert) return result;
  if (result && typeof result === 'object' && !Array.isArray(result)) {
    return { ...result, _queue_alert: alert };
  }
  return { result, _queue_alert: alert };
}
```

Call `attachQueueAlert` on the final result before returning from the tool handler.

## Tests

Three new tests in `test/modules/job-store/recovery.test.ts`:

1. `recoverInProgressJobs` with `retry_count=0` job → status becomes `queued`, `retry_count` becomes 1, function returns `{ recovering: 1, permanentlyFailed: 0 }`.
2. `recoverInProgressJobs` with `retry_count=1` job → status becomes `permanently_failed`, function returns `{ recovering: 0, permanentlyFailed: 1 }`.
3. `isAlertActive()` returns `false` after `refreshAlertState()` with no failed jobs, `true` after inserting a `failed` job and refreshing.

## Constraints

- Recovery runs once at startup only — no re-run mechanism needed.
- `permanently_failed` jobs stay in the DB for manual inspection; they are not auto-deleted by TTL cleanup until `JOB_RETENTION_MS` elapses.
- `_queue_alert` is synchronous-check (`isAlertActive()`) to avoid async overhead on every tool call; only `buildQueueAlert()` hits the DB (called when constructing the payload, not on the guard check).
- No new npm dependencies.
