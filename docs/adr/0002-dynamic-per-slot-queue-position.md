# Dynamic, per-slot queue position computed at read time

`queue_position` is computed fresh on every read (in `get_task_status` and the initial `route_task` response) rather than stored at enqueue time. Position counts only Jobs competing for the same execution slot as the queried Job — local Jobs count other local Jobs sharing the Local Inference Slot; remote Jobs count other Jobs on the same Provider Queue. SQLite's implicit `rowid` breaks ties when `created_at` values collide under concurrent submissions.

A new `is_local INTEGER` column on the `jobs` table records the slot category assigned at routing time. It must be updated alongside `provider_id` whenever a Routing Decision changes (initial enqueue and any retry that re-routes). The existing `queue_position INTEGER` column is left dormant — never read from or written to — rather than dropped, to avoid a DROP COLUMN migration with SQLite version risk.

`queue_position` is `null` for Jobs in any state other than `queued` (i.e. `in_progress`, `completed`, `failed`, `cancelled`, `permanently_failed`). Non-null position means "you are waiting"; null means "you are running or done."

## Why not store position at enqueue time

The original enqueue-time approach read `COUNT(active jobs)` then inserted the new Job in two separate steps. Under concurrent submissions all callers read the same count before any insert lands, so all receive `queue_position: 1`. Moving computation to read time eliminates the race entirely: position is always derived from the current DB state at the moment of the query.

## Why per-slot rather than global

A remote Job running concurrently does not occupy the Local Inference Slot and does not delay a local Job. Counting remote Jobs in a local Job's position would overstate the wait time and mislead callers making backoff decisions. In practice, local inference is the dominant use case and remote async jobs are rare, so per-slot positions behave like a global queue in the common case.

## Why rowid rather than an explicit sequence column

SQLite serializes concurrent writes internally; each INSERT receives a unique `rowid` in true insertion order. Using `rowid` as a tiebreaker requires no schema addition and no migration. An explicit `seq AUTOINCREMENT` column would carry the same semantic at the cost of a schema change.

## Considered options

**Static position at enqueue with a mutex** — serialize enqueue calls so position is computed and inserted atomically. Rejected: adds a process-level lock to the enqueue hot path; still fragile if the process restarts between reads.

**Null position in the initial `route_task` response** — omit position entirely from the enqueue response, only return it on `get_task_status` polls. Rejected: callers need an initial estimate to set their first poll interval.

**Global position across all providers** — count all active Jobs regardless of slot. Rejected: misleads local callers when remote Jobs are in the DB; position would not correspond to actual wait time.
