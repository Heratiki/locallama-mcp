import fs from 'fs/promises';
import path from 'path';
import { logger } from '../../../utils/logger.js';
import { BenchmarkResult, BenchmarkSummary } from '../../../types/index.js';
import crypto from 'crypto';

/**
 * Normalize task name to a consistent format (lowercase with hyphens)
 * This ensures consistent folder naming across benchmark runs
 * 
 * @param taskName The task name to normalize
 * @returns Normalized task name (lowercase with hyphens)
 */
function normalizeTaskName(taskName: string): string {
  return taskName.toLowerCase().replace(/\s+/g, '-');
}

/**
 * Save a benchmark result to disk
 */
export const saveResult = async (result: BenchmarkResult, baseDir: string): Promise<void> => {
  try {
    // Create a simpler folder structure: baseDir/modelId/taskType/
    const modelId = result.local.model.replace(/[/:]/g, '-');
    
    // Get the task type from taskId or infer from the task description
    // Use split('-')[0] to get the first part of normalized taskId, e.g., 'simple' from 'simple-function-modelid'
    let taskType = result.taskId.split('-')[0]; 
    
    // For backward compatibility, check if taskType needs normalization
    if (/\s/.test(taskType) || /[A-Z]/.test(taskType)) {
      // If it contains spaces or uppercase letters, it needs normalization
      taskType = normalizeTaskName(taskType);
    }
    
    // Create folder structure
    const resultDir = path.join(
      baseDir,
      modelId,
      taskType
    );
    
    await fs.mkdir(resultDir, { recursive: true });
    
    // Save with timestamp in filename, but use a hash of the test parameters 
    // to allow for detecting duplicate benchmark attempts
    const testHash = crypto.createHash('md5')
      .update(`${result.task}-${result.complexity}`)
      .digest('hex')
      .substring(0, 8);
      
    const filename = `benchmark-${testHash}.json`;
    
    await fs.writeFile(
      path.join(resultDir, filename),
      JSON.stringify(result, null, 2)
    );
  } catch (error) {
    logger.error('Error saving benchmark result:', error);
    throw error;
  }
};

/**
 * Save a benchmark summary to disk
 */
export async function saveSummary(summary: BenchmarkSummary, resultsPath: string, prefix?: string): Promise<void> {
  try {
    // Create results directory if it doesn't exist
    await fs.mkdir(resultsPath, { recursive: true });
    
    // Create a filename based on the timestamp
    const timestamp = new Date().toISOString().replace(/:/g, '-');
    const filename = `${prefix ? prefix + '-' : ''}summary-${timestamp}.json`;
    const filePath = path.join(resultsPath, filename);
    
    // Write the summary to disk
    await fs.writeFile(filePath, JSON.stringify(summary, null, 2));
    
    logger.info(`Saved benchmark summary to ${filePath}`);
  } catch (error) {
    logger.error('Error saving benchmark summary:', error);
  }
}

/**
 * Load benchmark results from disk
 */
export async function loadResults(resultsPath: string): Promise<BenchmarkResult[]> {
  try {
    // Create results directory if it doesn't exist
    await fs.mkdir(resultsPath, { recursive: true });
    
    // Get all JSON files in the directory
    const files = await fs.readdir(resultsPath);
    const resultFiles = files.filter(f => f.endsWith('.json') && !f.includes('summary'));
    
    // Load and parse each file
    const results = await Promise.all(
      resultFiles.map(async (file) => {
        const filePath = path.join(resultsPath, file);
        const content = await fs.readFile(filePath, 'utf-8');
        return JSON.parse(content) as BenchmarkResult;
      })
    );
    
    return results;
  } catch (error) {
    logger.error('Error loading benchmark results:', error);
    return [];
  }
}

/**
 * Load benchmark summaries from disk
 */
export async function loadSummaries(resultsPath: string): Promise<BenchmarkSummary[]> {
  try {
    // Create results directory if it doesn't exist
    await fs.mkdir(resultsPath, { recursive: true });
    
    // Get all summary files in the directory
    const files = await fs.readdir(resultsPath);
    const summaryFiles = files.filter(f => f.endsWith('.json') && f.includes('summary'));
    
    // Load and parse each file
    const summaries = await Promise.all(
      summaryFiles.map(async (file) => {
        const filePath = path.join(resultsPath, file);
        const content = await fs.readFile(filePath, 'utf-8');
        return JSON.parse(content) as BenchmarkSummary;
      })
    );
    
    return summaries;
  } catch (error) {
    logger.error('Error loading benchmark summaries:', error);
    return [];
  }
}

/**
 * Load results from a benchmark directory, supporting both naming conventions
 * 
 * @param baseDir Base directory for benchmarks
 * @param modelId Model ID
 * @param taskName Task name
 * @returns Array of benchmark results
 */
export async function loadTaskResults(
  baseDir: string,
  modelId: string,
  taskName: string
): Promise<BenchmarkResult[]> {
  const normalizedModelId = modelId.replace(/[/:]/g, '-');
  const normalizedTaskName = normalizeTaskName(taskName);
  
  // Check both the normalized and original task name paths
  const resultDirNormalized = path.join(baseDir, normalizedModelId, normalizedTaskName);
  const resultDirOriginal = path.join(baseDir, normalizedModelId, taskName);
  
  let resultFiles: string[] = [];
  let resultDir = '';
  
  // Try normalized path first
  try {
    resultFiles = (await fs.readdir(resultDirNormalized))
      .filter(f => f.endsWith('.json'));
    resultDir = resultDirNormalized;
  } catch {
    // If normalized path fails, try original path
    try {
      resultFiles = (await fs.readdir(resultDirOriginal))
        .filter(f => f.endsWith('.json'));
      resultDir = resultDirOriginal;
    } catch {
      // If both paths fail, return empty array
      return [];
    }
  }
  
  // Load and parse each file
  const results = await Promise.all(
    resultFiles.map(async (file) => {
      const filePath = path.join(resultDir, file);
      const content = await fs.readFile(filePath, 'utf-8');
      return JSON.parse(content) as BenchmarkResult;
    })
  );
  
  return results;
}