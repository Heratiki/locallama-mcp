# Persistent Job Store — Design Spec

**Issue:** #31  
**ADR:** docs/adr/0001-non-blocking-route-task-with-persistent-job-queue.md  
**Date:** 2026-05-19

## What we're building

Replace the in-memory `JobTracker` Map with a SQLite-backed persistent store so Jobs survive server restarts. This is the prerequisite for non-blocking `route_task` (#32) and Job Recovery (#33).

## Module: `src/modules/job-store/`

New module. Owns all SQLite interaction for jobs and tasks. Both `JobTracker` and `ws-server` import from it. Follows the same pattern as `src/modules/benchmark/storage/benchmarkDb.ts`.

### Files

- `src/modules/job-store/types.ts` — Job, Task, JobStatus, TaskStatus interfaces
- `src/modules/job-store/db.ts` — SQLite init, schema migration, CRUD operations
- `src/modules/job-store/index.ts` — barrel export

## Schema

```sql
CREATE TABLE IF NOT EXISTS jobs (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL,
  status TEXT NOT NULL,
  provider_id TEXT,
  model_id TEXT,
  task_text TEXT NOT NULL,
  result TEXT,
  error TEXT,
  queue_position INTEGER,
  progress_pct INTEGER DEFAULT 0,
  poll_again_after_ms INTEGER,
  retry_count INTEGER DEFAULT 0,
  created_at INTEGER NOT NULL,
  started_at INTEGER,
  completed_at INTEGER
);

CREATE TABLE IF NOT EXISTS tasks (
  id TEXT PRIMARY KEY,
  status TEXT NOT NULL,
  job_count INTEGER DEFAULT 0,
  completed_count INTEGER DEFAULT 0,
  failed_count INTEGER DEFAULT 0,
  created_at INTEGER NOT NULL
);
```

Status values:
- Job: `queued | in_progress | completed | failed | permanently_failed | cancelled`
- Task: `queued | in_progress | completed | partially_failed | failed | cancelled`

## DB path

```ts
path.join(config.rootDir, 'data', 'jobs.db')
```

Overridable via `JOB_DB_PATH` env var. Directory created if absent (same pattern as benchmarks.db).

## JobTracker changes

Replace `private activeJobs: Map<string, Job>` with async DB calls via `job-store/db.ts`. Public API **unchanged**:

- `createJob(id, task, model?)` → inserts row, status=queued
- `updateJobProgress(id, progress, estimatedTimeRemaining?)` → updates progress_pct, status=in_progress
- `completeJob(id, results?)` → updates status=completed, stores result as JSON string
- `failJob(id, error?)` → updates status=failed
- `cancelJob(id)` → updates status=cancelled
- `getJob(id)` → reads single row
- `getActiveJobs()` → reads rows where status NOT IN (completed, cancelled)
- `getAllJobs()` → reads all rows
- `cleanupCompletedJobs(maxAgeMs)` → deletes completed/cancelled rows older than maxAgeMs

EventEmitter events and WebSocket broadcast behavior unchanged.

## ws-server/db.ts

Deprecated in-place: re-exports `initDatabase`, `getAllJobsFromDb` from `job-store/db.ts`. No behaviour change for existing callers. Path bug fixed (was `./data/jobs.db` relative, now uses `config.rootDir`).

## Retention

`JOB_RETENTION_MS` env var, default `86400000` (24 h). `cleanupCompletedJobs` deletes completed and cancelled jobs older than TTL. Called on an interval at startup (same interval as existing cleanup call in JobTracker).

## Tests

Three new unit tests in `test/modules/job-store/db.test.ts`:

1. Job written via `createJob` is readable after simulated DB reconnect (re-open same file)
2. Status transitions (`queued → in_progress → completed`) recorded correctly in DB
3. `cleanupCompletedJobs` with TTL=0 removes completed/cancelled rows, leaves queued/in_progress

## Constraints

- `sqlite` + `sqlite3` packages already installed — no new deps
- All DB methods are async — callers that were sync must be made async
- `JobTracker` public methods already return `Promise<void>` — no API surface change
- `ws-server/db.ts` callers (`getAllJobsFromDb`, `initDatabase`) continue to work via re-export
