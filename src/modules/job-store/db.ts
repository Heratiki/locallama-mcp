import { Database, open } from 'sqlite';
import sqlite3 from 'sqlite3';
import { logger } from '../../utils/logger.js';
import { config } from '../../config/index.js';
import * as path from 'path';
import * as fs from 'fs';
import type { PersistedJob, PersistedTask, JobStatus } from './types.js';

let dbInstance: Database | null = null;

/**
 * Resolve the DB path at call time so that tests can override JOB_DB_PATH
 * via process.env between test cases.
 */
function resolveDbPath(): string {
  return process.env.JOB_DB_PATH
    ? path.resolve(process.env.JOB_DB_PATH)
    : path.join(config.rootDir, 'data', 'jobs.db');
}

export async function initJobStore(): Promise<void> {
  if (dbInstance) return;

  const DB_PATH = resolveDbPath();

  // Ensure data directory exists
  const dbDir = path.dirname(DB_PATH);
  if (!fs.existsSync(dbDir)) {
    fs.mkdirSync(dbDir, { recursive: true });
  }

  try {
    const db = await open({
      filename: DB_PATH,
      driver: sqlite3.Database
    });

    await db.exec(`
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
        progress_pct INTEGER NOT NULL DEFAULT 0,
        poll_again_after_ms INTEGER,
        retry_count INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL,
        started_at INTEGER,
        completed_at INTEGER
      );

      CREATE TABLE IF NOT EXISTS tasks (
        id TEXT PRIMARY KEY,
        status TEXT NOT NULL,
        job_count INTEGER NOT NULL DEFAULT 0,
        completed_count INTEGER NOT NULL DEFAULT 0,
        failed_count INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_jobs_task_id ON jobs(task_id);
      CREATE INDEX IF NOT EXISTS idx_jobs_status ON jobs(status);
      CREATE INDEX IF NOT EXISTS idx_jobs_created_at ON jobs(created_at);
    `);

    dbInstance = db;
    logger.debug('Job store database initialized');
  } catch (error) {
    logger.error('Failed to initialize job store database:', error);
    throw error;
  }
}

function getDb(): Database {
  if (!dbInstance) {
    throw new Error('Job store not initialized. Call initJobStore() first.');
  }
  return dbInstance;
}

export async function getDbOrNull(): Promise<Database | null> {
  return dbInstance;
}

export async function getJobsByStatus(statuses: JobStatus[]): Promise<PersistedJob[]> {
  if (!dbInstance) return [];
  try {
    const placeholders = statuses.map(() => '?').join(', ');
    return await dbInstance.all<PersistedJob[]>(
      `SELECT * FROM jobs WHERE status IN (${placeholders}) ORDER BY created_at ASC`,
      statuses
    );
  } catch (error) {
    logger.error('Failed to get jobs by status:', error);
    return [];
  }
}

export async function insertJob(job: PersistedJob): Promise<void> {
  const db = getDb();
  try {
    await db.run(
      `INSERT INTO jobs (id, task_id, status, provider_id, model_id, task_text, result, error,
        queue_position, progress_pct, poll_again_after_ms, retry_count, created_at, started_at, completed_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        job.id,
        job.task_id,
        job.status,
        job.provider_id,
        job.model_id,
        job.task_text,
        job.result,
        job.error,
        job.queue_position,
        job.progress_pct,
        job.poll_again_after_ms,
        job.retry_count,
        job.created_at,
        job.started_at,
        job.completed_at
      ]
    );
  } catch (error) {
    logger.error(`Failed to insert job ${job.id}:`, error);
    throw error;
  }
}

export async function updateJob(job: Partial<PersistedJob> & { id: string }): Promise<void> {
  const db = getDb();
  try {
    // Build dynamic SET clause from provided fields
    const fields: string[] = [];
    const values: unknown[] = [];

    if (job.status !== undefined) { fields.push('status = ?'); values.push(job.status); }
    if (job.provider_id !== undefined) { fields.push('provider_id = ?'); values.push(job.provider_id); }
    if (job.model_id !== undefined) { fields.push('model_id = ?'); values.push(job.model_id); }
    if (job.task_text !== undefined) { fields.push('task_text = ?'); values.push(job.task_text); }
    if (job.result !== undefined) { fields.push('result = ?'); values.push(job.result); }
    if (job.error !== undefined) { fields.push('error = ?'); values.push(job.error); }
    if (job.queue_position !== undefined) { fields.push('queue_position = ?'); values.push(job.queue_position); }
    if (job.progress_pct !== undefined) { fields.push('progress_pct = ?'); values.push(job.progress_pct); }
    if (job.poll_again_after_ms !== undefined) { fields.push('poll_again_after_ms = ?'); values.push(job.poll_again_after_ms); }
    if (job.retry_count !== undefined) { fields.push('retry_count = ?'); values.push(job.retry_count); }
    if (job.started_at !== undefined) { fields.push('started_at = ?'); values.push(job.started_at); }
    if (job.completed_at !== undefined) { fields.push('completed_at = ?'); values.push(job.completed_at); }

    if (fields.length === 0) return;

    values.push(job.id);
    await db.run(
      `UPDATE jobs SET ${fields.join(', ')} WHERE id = ?`,
      values
    );
  } catch (error) {
    logger.error(`Failed to update job ${job.id}:`, error);
    throw error;
  }
}

export async function getJob(id: string): Promise<PersistedJob | undefined> {
  const db = getDb();
  try {
    return await db.get<PersistedJob>('SELECT * FROM jobs WHERE id = ?', [id]);
  } catch (error) {
    logger.error(`Failed to get job ${id}:`, error);
    return undefined;
  }
}

export async function getJobsByTaskId(taskId: string): Promise<PersistedJob[]> {
  const db = getDb();
  try {
    return await db.all<PersistedJob[]>(
      'SELECT * FROM jobs WHERE task_id = ? ORDER BY created_at ASC',
      [taskId]
    );
  } catch (error) {
    logger.error(`Failed to get jobs for task ${taskId}:`, error);
    return [];
  }
}

export async function getAllJobs(): Promise<PersistedJob[]> {
  const db = getDb();
  try {
    return await db.all<PersistedJob[]>('SELECT * FROM jobs ORDER BY created_at DESC');
  } catch (error) {
    logger.error('Failed to get all jobs:', error);
    return [];
  }
}

export async function cancelJobsForTask(taskId: string, completedAt: number = Date.now()): Promise<number> {
  const db = getDb();
  try {
    const result = await db.run(
      `UPDATE jobs
       SET status = 'cancelled', completed_at = ?
       WHERE task_id = ? AND status IN ('queued', 'in_progress')`,
      [completedAt, taskId]
    );
    return result.changes ?? 0;
  } catch (error) {
    logger.error(`Failed to cancel jobs for task ${taskId}:`, error);
    throw error;
  }
}

export async function getActiveJobs(): Promise<PersistedJob[]> {
  const db = getDb();
  try {
    return await db.all<PersistedJob[]>(
      `SELECT * FROM jobs WHERE status IN ('queued', 'in_progress') ORDER BY created_at ASC`
    );
  } catch (error) {
    logger.error('Failed to get active jobs:', error);
    return [];
  }
}

export async function deleteOldJobs(maxAgeMs: number): Promise<void> {
  const db = getDb();
  try {
    const cutoff = Date.now() - maxAgeMs;
    await db.run(
      `DELETE FROM jobs WHERE status IN ('completed', 'cancelled', 'failed', 'permanently_failed')
       AND created_at < ?`,
      [cutoff]
    );
  } catch (error) {
    logger.error('Failed to delete old jobs:', error);
    throw error;
  }
}

export async function insertTask(task: PersistedTask): Promise<void> {
  const db = getDb();
  try {
    await db.run(
      `INSERT INTO tasks (id, status, job_count, completed_count, failed_count, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [
        task.id,
        task.status,
        task.job_count,
        task.completed_count,
        task.failed_count,
        task.created_at
      ]
    );
  } catch (error) {
    logger.error(`Failed to insert task ${task.id}:`, error);
    throw error;
  }
}

export async function updateTask(task: Partial<PersistedTask> & { id: string }): Promise<void> {
  const db = getDb();
  try {
    const fields: string[] = [];
    const values: unknown[] = [];

    if (task.status !== undefined) { fields.push('status = ?'); values.push(task.status); }
    if (task.job_count !== undefined) { fields.push('job_count = ?'); values.push(task.job_count); }
    if (task.completed_count !== undefined) { fields.push('completed_count = ?'); values.push(task.completed_count); }
    if (task.failed_count !== undefined) { fields.push('failed_count = ?'); values.push(task.failed_count); }

    if (fields.length === 0) return;

    values.push(task.id);
    await db.run(
      `UPDATE tasks SET ${fields.join(', ')} WHERE id = ?`,
      values
    );
  } catch (error) {
    logger.error(`Failed to update task ${task.id}:`, error);
    throw error;
  }
}

export async function getTask(id: string): Promise<PersistedTask | undefined> {
  const db = getDb();
  try {
    return await db.get<PersistedTask>('SELECT * FROM tasks WHERE id = ?', [id]);
  } catch (error) {
    logger.error(`Failed to get task ${id}:`, error);
    return undefined;
  }
}

/**
 * Close the DB connection and reset the singleton.
 * Useful in tests to allow cleanup of temp DB files.
 */
export async function closeJobStore(): Promise<void> {
  if (dbInstance) {
    await dbInstance.close();
    dbInstance = null;
  }
}

// Export types for convenience
export type { PersistedJob, PersistedTask, JobStatus };
