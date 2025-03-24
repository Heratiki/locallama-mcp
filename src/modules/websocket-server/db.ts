import fs from 'fs';
import path from 'path';
import sqlite3 from 'sqlite3';
import { open } from 'sqlite'; // Removed Database, ISqlite due to not being used.
import { logger } from '../../utils/logger.js';

interface Job {
  id: string;
  description: string;
  status: string;
  progress: number;
  parent_task_id: string | null;
  created_at: string;
  updated_at: string;
}

interface DbRunResult {
  lastID: number;
  changes: number;
}

type SafeDB = {
  run(sql: string, params?: unknown[]): Promise<DbRunResult>;
  all<T>(sql: string, params?: unknown[]): Promise<T[]>;
  exec(sql: string): Promise<void>;
};

const DB_PATH = process.env.DB_PATH || './data/jobs.db';

async function initDatabase(): Promise<SafeDB | null> {
  if (!fs.existsSync(path.dirname(DB_PATH))) {
    fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
  }

  let dbConnection;
  try {
    dbConnection = await open({
      filename: DB_PATH,
      driver: sqlite3.Database
    });

    if (!dbConnection) {
      return null;
    }
  } catch (error) {
    if (error instanceof Error) {
      logger.error('Failed to initialize database:', error.message);
    } else {
      logger.error('Failed to initialize database:', String(error));
    }
    return null;
  }

  try {
    await dbConnection.exec(`
      CREATE TABLE IF NOT EXISTS jobs (
        id TEXT PRIMARY KEY,
        description TEXT,
        status TEXT,
        progress INTEGER,
        parent_task_id TEXT,
        created_at TEXT,
        updated_at TEXT
      )
    `);
  } catch (execError) {
    if (execError instanceof Error) {
      logger.error('Failed to create table:', execError.message);
    } else {
      logger.error('Failed to create table:', String(execError));
    }
    return null;
  }

  return dbConnection as SafeDB;
}

async function insertJob(job: Job): Promise<void> {
  const db = await initDatabase();
  if (!db) {
    logger.error('Database not initialized');
    return;
  }

  try {
    await db.run(
      'INSERT INTO jobs (id, description, status, progress, parent_task_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [job.id, job.description, job.status, job.progress, job.parent_task_id, job.created_at, job.updated_at]
    );
  } catch (error) {
    if (error instanceof Error) {
      logger.error('Failed to insert job:', error.message);
    } else {
      logger.error('Failed to insert job:', String(error));
    }
    throw error;
  }
}

async function updateJob(job: Partial<Job> & { id: string }): Promise<void> {
  const db = await initDatabase();
  if (!db) {
    logger.error('Database not initialized');
    return;
  }

  try {
    await db.run(
      'UPDATE jobs SET status = ?, progress = ?, updated_at = ? WHERE id = ?',
      [job.status, job.progress, job.updated_at, job.id]
    );
  } catch (error) {
    if (error instanceof Error) {
      logger.error('Failed to update job:', error.message);
    } else {
      logger.error('Failed to update job:', String(error));
    }
  }
}

async function getAllJobsFromDb(): Promise<Job[]> {
  const db = await initDatabase();
  if (!db) {
    logger.error('Database not initialized');
    return [];
  }

  try {
    const rows = await db.all<Job>('SELECT * FROM jobs');
    return rows;
  } catch (error) {
    if (error instanceof Error) {
      logger.error('Failed to get all jobs:', error.message);
    } else {
      logger.error('Failed to get all jobs:', String(error));
    }
    return [];
  }
}

async function cleanupOldJobs(): Promise<void> {
  const db = await initDatabase();
  if (!db) {
    logger.error('Database not initialized');
    return;
  }

  try {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - 7);
    await db.run('DELETE FROM jobs WHERE created_at < ?', [cutoffDate.toISOString()]);
  } catch (error) {
    if (error instanceof Error) {
      logger.error('Failed to cleanup old jobs:', error.message);
    } else {
      logger.error('Failed to cleanup old jobs:', String(error));
    }
  }
}

export { initDatabase, insertJob, updateJob, getAllJobsFromDb, cleanupOldJobs };