import { Database, open } from 'sqlite';
import sqlite3 from 'sqlite3';
import { logger } from '../../../utils/logger.js';
import { BenchmarkResult } from '../../../types/index.js';
import * as path from 'path';
import * as fs from 'fs';

const DB_PATH = process.env.BENCHMARK_DB_PATH || './data/benchmark-results.db';

interface TokenUsage {
  prompt: number;
  completion: number;
  total: number;
}

interface ModelResult {
  model: string;
  timeTaken: number;
  successRate: number;
  qualityScore: number;
  tokenUsage: TokenUsage;
  cost?: number;
  output?: string;
}

interface ModelStats {
  benchmarkCount: number;
  avgSuccessRate: number;
  avgQualityScore: number;
  lastBenchmarked: string;
}

let dbInstance: Database | null = null;

export async function initBenchmarkDb(): Promise<Database | null> {
  if (dbInstance) return dbInstance;

  // Ensure directory exists
  const dbDir = path.dirname(DB_PATH);
  if (!fs.existsSync(dbDir)) {
    fs.mkdirSync(dbDir, { recursive: true });
  }

  try {
    const db = await open({
      filename: DB_PATH,
      driver: sqlite3.Database
    });

    // Create tables if they don't exist
    await db.exec(`
      CREATE TABLE IF NOT EXISTS benchmark_tasks (
        taskId TEXT PRIMARY KEY,
        task TEXT NOT NULL,
        contextLength INTEGER NOT NULL,
        outputLength INTEGER NOT NULL,
        complexity REAL NOT NULL,
        timestamp TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS model_results (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        taskId TEXT NOT NULL,
        model TEXT NOT NULL,
        isLocal BOOLEAN NOT NULL,
        timeTaken INTEGER NOT NULL,
        successRate REAL NOT NULL,
        qualityScore REAL NOT NULL,
        promptTokens INTEGER NOT NULL,
        completionTokens INTEGER NOT NULL,
        totalTokens INTEGER NOT NULL,
        cost REAL,
        output TEXT,
        timestamp TEXT NOT NULL,
        FOREIGN KEY (taskId) REFERENCES benchmark_tasks(taskId)
      );

      CREATE INDEX IF NOT EXISTS idx_model_results_model ON model_results(model);
      CREATE INDEX IF NOT EXISTS idx_model_results_timestamp ON model_results(timestamp);
    `);

    dbInstance = db;
    return db;
  } catch (error) {
    logger.error('Failed to initialize benchmark database:', error);
    return null;
  }
}

export async function saveBenchmarkResult(result: BenchmarkResult): Promise<void> {
  const db = await initBenchmarkDb();
  if (!db) return;

  try {
    await db.run('BEGIN TRANSACTION');

    // Save task information
    await db.run(
      'INSERT OR REPLACE INTO benchmark_tasks (taskId, task, contextLength, outputLength, complexity, timestamp) VALUES (?, ?, ?, ?, ?, ?)',
      [result.taskId, result.task, result.contextLength, result.outputLength, result.complexity, result.timestamp]
    );

    // Save local model result
    await saveModelResult(db, result.taskId, result.local, true, result.timestamp);

    // Save paid model result if available
    if (result.paid.model) {
      await saveModelResult(db, result.taskId, result.paid, false, result.timestamp);
    }

    await db.run('COMMIT');
  } catch (error) {
    await db.run('ROLLBACK');
    logger.error('Failed to save benchmark result:', error);
  }
}

async function saveModelResult(
  db: Database,
  taskId: string,
  result: ModelResult,
  isLocal: boolean,
  timestamp: string
): Promise<void> {
  await db.run(
    `INSERT INTO model_results 
    (taskId, model, isLocal, timeTaken, successRate, qualityScore, 
     promptTokens, completionTokens, totalTokens, cost, output, timestamp)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      taskId,
      result.model,
      isLocal ? 1 : 0,
      result.timeTaken,
      result.successRate,
      result.qualityScore,
      result.tokenUsage.prompt,
      result.tokenUsage.completion,
      result.tokenUsage.total,
      result.cost || 0,
      result.output || '',
      timestamp
    ]
  );
}

export async function getRecentModelResults(model: string, days: number = 7): Promise<ModelStats | null> {
  const db = await initBenchmarkDb();
  if (!db) return null;

  try {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - days);

    const results = await db.get<ModelStats>(`
      SELECT 
        COUNT(*) as benchmarkCount,
        AVG(successRate) as avgSuccessRate,
        AVG(qualityScore) as avgQualityScore,
        MAX(timestamp) as lastBenchmarked
      FROM model_results
      WHERE model = ? AND timestamp > ?
    `, [model, cutoff.toISOString()]);

    if (!results || !results.benchmarkCount) {
      return null;
    }

    return {
      benchmarkCount: Number(results.benchmarkCount),
      avgSuccessRate: Number(results.avgSuccessRate),
      avgQualityScore: Number(results.avgQualityScore),
      lastBenchmarked: results.lastBenchmarked
    };
  } catch (error) {
    logger.error('Failed to get recent model results:', error);
    return null;
  }
}

export async function cleanupOldResults(days: number = 30): Promise<void> {
  const db = await initBenchmarkDb();
  if (!db) return;

  try {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - days);

    await db.run('BEGIN TRANSACTION');

    // Delete old model results
    await db.run('DELETE FROM model_results WHERE timestamp < ?', [cutoff.toISOString()]);

    // Delete orphaned tasks
    await db.run(`
      DELETE FROM benchmark_tasks 
      WHERE taskId NOT IN (SELECT DISTINCT taskId FROM model_results)
    `);

    await db.run('COMMIT');
  } catch (error) {
    await db.run('ROLLBACK');
    logger.error('Failed to cleanup old results:', error);
  }
}