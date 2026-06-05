# 05 — Job store, execution & recovery

This is where Tasks and Jobs become durable rows and actually run. The design goal (ADR-0001):
`route_task` must return instantly and the queue must survive a server restart.

## Two views of a Job

There are two representations, and it helps to keep them distinct:

- **Persisted shape** — `PersistedJob` / `PersistedTask` (`src/modules/job-store/types.ts:4` and
  `:25`), with `JobStatus`/`TaskStatus` string unions (`types.ts:1-2`). This is the SQLite row.
- **Live tracker shape** — `Job` interface + `JobStatus` enum (`src/modules/decision-engine/
  services/jobTracker.ts:39` and `:18`), used by the in-memory `JobTracker` that drives execution
  and emits progress events.

The job store (`src/modules/job-store/`) is the source of truth on disk; the `JobTracker`
(`jobTracker.ts:63`, an `EventEmitter`) is the runtime coordinator. Access it via
`getJobTracker()` (`jobTracker.ts:585`) / `getJobTrackerSync()` (`:603`); shut down with
`shutdownJobTracker()` (`:607`).

## Lifecycle

```
queued ──▶ in_progress ──▶ completed
                │
                ├──▶ failed ──▶ (one auto-retry) ──▶ permanently_failed
                └──▶ cancelled
```

A **Task** aggregates its Jobs: `completed` (all Jobs done), `partially_failed` (some fail), or
`failed` (all fail). Definitions are canonical in [`CONTEXT.md`](../CONTEXT.md).

## Queue position is computed at read time, not stored

**Queue Position** is *not* a stored counter — it is computed when you ask (`CONTEXT.md`; ADR-0002
`docs/adr/0002-dynamic-per-slot-queue-position.md`). For a **local** Job it counts other local
Jobs in `queued`/`in_progress` with an earlier insertion order (by `rowid` when `created_at`
ties). For a **remote** Job it counts other Jobs on the **same Provider Queue**. It is `null`
once the Job leaves `queued`. This is why position is per-slot and always current, even after
re-routing — there is no stale stored number to drift.

## Execution

`taskExecutor.ts` pulls queued Jobs as slots free (slot rules: [04-providers](04-providers.md))
and runs them through the chosen provider. Progress events flow from the `JobTracker` to the
WebSocket side channel and dashboard ([08](08-telemetry-monitoring.md)). The executor also drives
the validation loop / retry ladder ([03](03-decision-engine.md)).

## Recovery (startup)

`recoverInProgressJobs()` (`src/modules/job-store/recovery.ts`, re-exported from
`job-store/index.ts:20`) runs at startup. Any Job still `in_progress` (i.e. the server died
mid-run) gets **exactly one** automatic retry. A second failure → `permanently_failed`, which
requires a manual re-queue. **A Job never auto-retries more than once.** Spec:
`docs/archive/superpowers/specs/2026-05-19-job-recovery-design.md` (archived historical design).

## Boot-time alerts (push without polling)

The alert subsystem (`job-store/alert.ts`: `refreshAlertState`, `isAlertActive`,
`buildQueueAlert`, re-exported at `job-store/index.ts:21`) surfaces queue trouble. When any Job is
`failed`/`permanently_failed` (or stale/recovering), an alert is attached as the ambient
`_queue_alert` field on the **next** tool response — so the agent finds out on its next call
without explicit polling. The alert **auto-clears** when no `failed`/`permanently_failed` Jobs
remain; healthy `queued`/`in_progress` Jobs do not sustain it (`CONTEXT.md`, Boot-time Alert).

## See also
- Why non-blocking + persistent → [`docs/adr/0001-...`](../docs/adr/0001-non-blocking-route-task-with-persistent-job-queue.md)
- Why dynamic queue position → [`docs/adr/0002-...`](../docs/adr/0002-dynamic-per-slot-queue-position.md)
- Persistent store design (archived) → [`docs/archive/superpowers/specs/2026-05-19-persistent-job-store-design.md`](../docs/archive/superpowers/specs/2026-05-19-persistent-job-store-design.md)
