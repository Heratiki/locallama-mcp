import sqlite3 from 'sqlite3';
import { open } from 'sqlite';
import fs from 'fs';
import path from 'path';

const DB_PATH = process.env.DB_PATH || './data/jobs.db';

async function initDatabase() {
  if (!fs.existsSync(path.dirname(DB_PATH))) {
    fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
  }

  const db = await open({
    filename: DB_PATH,
    driver: sqlite3.Database,
  });

  await db.exec(`
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
}

async function insertJob(job) {
  const db = await initDatabase();
  await db.run(
    'INSERT INTO jobs (id, description, status, progress, parent_task_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    job.id, job.description, job.status, job.progress, job.parent_task_id, job.created_at, job.updated_at
  );
}

async function updateJob(job) {
  const db = await initDatabase();
  await db.run(
    'UPDATE jobs SET status = ?, progress = ?, updated_at = ? WHERE id = ?',
    job.status, job.progress, job.updated_at, job.id
  );
}

async function getAllJobsFromDb() {
  const db = await initDatabase();
  const jobs = await db.all('SELECT * FROM jobs');
  return jobs;
}

async function cleanupOldJobs() {
  const db = await initDatabase();
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - 7);
  await db.run('DELETE FROM jobs WHERE created_at < ?', cutoffDate.toISOString());
}

export { initDatabase, insertJob, updateJob, getAllJobsFromDb, cleanupOldJobs };