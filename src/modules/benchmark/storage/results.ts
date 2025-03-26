import fs from 'fs/promises';
import path from 'path';
import { logger } from '../../../utils/logger.js';
import { BenchmarkResult, BenchmarkSummary } from '../../../types/index.js';
import crypto from 'crypto';

/**
 * Save a benchmark result to disk
 */
export const saveResult = async (result: BenchmarkResult, baseDir: string): Promise<void> => {
  try {
    // Create a simpler folder structure: baseDir/modelId/taskType/
    const modelId = result.local.model.replace(/[/:]/g, '-');
    const taskType = result.taskId.split('-')[0]; // Gets 'simple' or 'medium'
    
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