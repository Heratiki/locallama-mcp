import sqlite3 from 'sqlite3';
import { Database, ISqlite, open } from 'sqlite';
import fs from 'fs';
import path from 'path';
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

const DB_PATH = process.env.DB_PATH || './data/jobs.db';

async function initDatabase(): Promise<Database> {
  if (!fs.existsSync(path.dirname(DB_PATH))) {
    fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
  }

  try {
    const db = await open<Database, sqlite3.Database>({
      filename: DB_PATH,
      driver: sqlite3.Database
    });

    await (db as ISqlite.Database).exec(`
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

    return db;
  } catch (error) {
    if (error instanceof Error) {
      logger.error('Failed to initialize database:', error.message);
    }
    throw error;
  }
}

async function insertJob(job: Job): Promise<void> {
  const db = await initDatabase() as ISqlite.Database;
  try {
    await db.run(
      'INSERT INTO jobs (id, description, status, progress, parent_task_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [job.id, job.description, job.status, job.progress, job.parent_task_id, job.created_at, job.updated_at]
    );
  } catch (error) {
    if (error instanceof Error) {
      logger.error('Failed to insert job:', error.message);
    }
    throw error;
  }
}

async function updateJob(job: Partial<Job> & { id: string }): Promise<void> {
  const db = await initDatabase() as ISqlite.Database;
  try {
    await db.run(
      'UPDATE jobs SET status = ?, progress = ?, updated_at = ? WHERE id = ?',
      [job.status, job.progress, job.updated_at, job.id]
    );
  } catch (error) {
    if (error instanceof Error) {
      logger.error('Failed to update job:', error.message);
    }
    throw error;
  }
}

async function getAllJobsFromDb(): Promise<Job[]> {
  const db = await initDatabase() as ISqlite.Database;
  try {
    const rows = await db.all('SELECT * FROM jobs') as Job[];
    return rows;
  } catch (error) {
    if (error instanceof Error) {
      logger.error('Failed to get all jobs:', error.message);
    }
    return [];
  }
}

async function cleanupOldJobs(): Promise<void> {
  const db = await initDatabase() as ISqlite.Database;
  try {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - 7);
    await db.run('DELETE FROM jobs WHERE created_at < ?', [cutoffDate.toISOString()]);
  } catch (error) {
    if (error instanceof Error) {
      logger.error('Failed to cleanup old jobs:', error.message);
    }
    throw error;
  }
}

export { initDatabase, insertJob, updateJob, getAllJobsFromDb, cleanupOldJobs };