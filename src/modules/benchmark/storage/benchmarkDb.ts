import { Database, open } from 'sqlite';
import sqlite3 from 'sqlite3';
import { logger } from '../../../utils/logger.js';
import { BenchmarkResult } from '../../../types/index.js';
import * as path from 'path';
import * as fs from 'fs';

const DB_PATH = process.env.BENCHMARK_DB_PATH || './data/benchmark-results.db';

/**
 * Normalize task name to a consistent format (lowercase with hyphens)
 * This ensures consistent naming across benchmark runs
 * 
 * @param taskName The task name to normalize
 * @returns Normalized task name (lowercase with hyphens)
 */
function normalizeTaskName(taskName: string): string {
  return taskName.toLowerCase().replace(/\s+/g, '-');
}

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

    // Normalize taskId for consistency
    // Check if normalization is needed
    const originalTaskId = result.taskId;
    let taskId = originalTaskId;
    
    // Normalize taskId if it contains spaces or uppercase letters
    if (/\s/.test(taskId) || /[A-Z]/.test(taskId)) {
      // Extract parts and normalize the task name part
      const parts = taskId.split('-');
      
      if (parts.length > 1) {
        // If it's already in the format "taskname-modelid", normalize the task name part
        parts[0] = normalizeTaskName(parts[0]);
        taskId = parts.join('-');
      } else {
        // If it's a simple string, normalize the whole thing
        taskId = normalizeTaskName(taskId);
      }
    }
    
    // Update taskId in the result object
    const normalizedResult = { ...result, taskId };

    // Save task information
    await db.run(
      'INSERT OR REPLACE INTO benchmark_tasks (taskId, task, contextLength, outputLength, complexity, timestamp) VALUES (?, ?, ?, ?, ?, ?)',
      [
        normalizedResult.taskId, 
        normalizedResult.task, 
        normalizedResult.contextLength, 
        normalizedResult.outputLength, 
        normalizedResult.complexity, 
        normalizedResult.timestamp
      ]
    );

    // Save local model result
    await saveModelResult(db, normalizedResult.taskId, normalizedResult.local, true, normalizedResult.timestamp);

    // Save paid model result if available
    if (normalizedResult.paid.model) {
      await saveModelResult(db, normalizedResult.taskId, normalizedResult.paid, false, normalizedResult.timestamp);
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

/**
 * Get results for a specific task, supporting both naming conventions
 */
export async function getTaskResults(taskName: string): Promise<BenchmarkResult[]> {
  const db = await initBenchmarkDb();
  if (!db) return [];

  try {
    // Normalize task name for querying
    const normalizedTaskName = normalizeTaskName(taskName);
    
    // Create pattern to match either the normalized name or the original name
    const taskPattern = `%${normalizedTaskName}%`;
    const originalTaskPattern = `%${taskName}%`;

    // Query for benchmark tasks matching either pattern
    const tasks = await db.all<Array<{taskId: string}>>(
      `SELECT taskId FROM benchmark_tasks 
       WHERE taskId LIKE ? OR taskId LIKE ?`,
      [taskPattern, originalTaskPattern]
    );

    if (!tasks || tasks.length === 0) {
      return [];
    }

    // Get all task IDs that matched
    const taskIds = tasks.map(t => t.taskId);
    
    // Define a proper type for the SQL query results
    interface SqlBenchmarkResult {
      taskId: string;
      task: string;
      contextLength: number;
      outputLength: number;
      complexity: number;
      timestamp: string;
      local_model: string;
      local_timeTaken: number;
      local_successRate: number;
      local_qualityScore: number;
      local_promptTokens: number;
      local_completionTokens: number;
      local_totalTokens: number;
      local_output: string;
      paid_model: string;
      paid_timeTaken: number;
      paid_successRate: number;
      paid_qualityScore: number;
      paid_promptTokens: number;
      paid_completionTokens: number;
      paid_totalTokens: number;
      paid_cost: number;
      paid_output: string;
    }
    
    // Build a query to fetch all results for these tasks
    const placeholders = taskIds.map(() => '?').join(',');
    const results = await db.all<SqlBenchmarkResult[]>(
      `SELECT t.*, 
        mr_local.model AS local_model,
        mr_local.timeTaken AS local_timeTaken,
        mr_local.successRate AS local_successRate,
        mr_local.qualityScore AS local_qualityScore,
        mr_local.promptTokens AS local_promptTokens,
        mr_local.completionTokens AS local_completionTokens,
        mr_local.totalTokens AS local_totalTokens,
        mr_local.output AS local_output,
        mr_paid.model AS paid_model,
        mr_paid.timeTaken AS paid_timeTaken,
        mr_paid.successRate AS paid_successRate,
        mr_paid.qualityScore AS paid_qualityScore,
        mr_paid.promptTokens AS paid_promptTokens,
        mr_paid.completionTokens AS paid_completionTokens,
        mr_paid.totalTokens AS paid_totalTokens,
        mr_paid.cost AS paid_cost,
        mr_paid.output AS paid_output
      FROM benchmark_tasks t
      LEFT JOIN model_results mr_local ON t.taskId = mr_local.taskId AND mr_local.isLocal = 1
      LEFT JOIN model_results mr_paid ON t.taskId = mr_paid.taskId AND mr_paid.isLocal = 0
      WHERE t.taskId IN (${placeholders})`,
      taskIds
    );

    return results.map(row => ({
      taskId: row.taskId,
      task: row.task,
      contextLength: row.contextLength,
      outputLength: row.outputLength,
      complexity: row.complexity,
      local: {
        model: row.local_model || '',
        timeTaken: row.local_timeTaken || 0,
        successRate: row.local_successRate || 0,
        qualityScore: row.local_qualityScore || 0,
        tokenUsage: {
          prompt: row.local_promptTokens || 0,
          completion: row.local_completionTokens || 0,
          total: row.local_totalTokens || 0
        },
        output: row.local_output || ''
      },
      paid: {
        model: row.paid_model || '',
        timeTaken: row.paid_timeTaken || 0,
        successRate: row.paid_successRate || 0,
        qualityScore: row.paid_qualityScore || 0,
        tokenUsage: {
          prompt: row.paid_promptTokens || 0,
          completion: row.paid_completionTokens || 0,
          total: row.paid_totalTokens || 0
        },
        cost: row.paid_cost || 0,
        output: row.paid_output || ''
      },
      timestamp: row.timestamp
    }));
  } catch (error) {
    logger.error('Failed to get task results:', error);
    return [];
  }
}