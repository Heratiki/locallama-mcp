import path from 'path';
import fs from 'fs/promises';
import { mkdir } from 'fs/promises';
import { logger } from '../../../utils/logger.js';
import { ModelPerformanceData } from '../../../types/index.js';

interface ModelsDatabase {
  models: Record<string, ModelPerformanceData>;
  lastUpdate: number;
}

// Define the structure for comprehensive benchmark results
interface ComprehensiveBenchmarkResults {
  timestamp: string;
  models: {
    [modelId: string]: {
      successRate?: number;
      qualityScore?: number;
      avgResponseTime?: number;
      benchmarkCount?: number;
      complexityScore?: number;
    };
  };
  summary?: {
    totalModels: number;
    averageSuccessRate: number;
    averageQualityScore: number;
  };
}

class ModelsDbService {
  private static instance: ModelsDbService;
  private database: ModelsDatabase = {
    models: {},
    lastUpdate: 0
  };
  private dbFilePath: string;
  private initialized = false;

  private constructor() {
    const dbDir = process.env.DB_DIR || path.join(process.cwd(), '.cache');
    this.dbFilePath = path.join(dbDir, 'models-db.json');
  }

  static getInstance(): ModelsDbService {
    if (!ModelsDbService.instance) {
      ModelsDbService.instance = new ModelsDbService();
    }
    return ModelsDbService.instance;
  }

  async initialize(): Promise<void> {
    if (this.initialized) {
      return;
    }

    logger.debug('Initializing models database');
    
    try {
      // Ensure directory exists
      const dbDir = path.dirname(this.dbFilePath);
      await mkdir(dbDir, { recursive: true });
      
      // Try to load existing database
      try {
        const data = await fs.readFile(this.dbFilePath, 'utf-8');
        const parsedData = JSON.parse(data) as ModelsDatabase;
        this.database = parsedData;
        logger.info(`Loaded models database with ${Object.keys(this.database.models).length} models`);
      } catch {
        // If file doesn't exist or can't be parsed, use empty database
        logger.info('No existing models database found, creating new one');
        this.database = {
          models: {},
          lastUpdate: Date.now()
        };
        
        // Create the file
        await this.saveDatabase();
      }
      
      // Additionally, load data from benchmark results to ensure all benchmarked models are represented
      await this.loadBenchmarkData();
      
      this.initialized = true;
    } catch (error) {
      logger.error('Error initializing models database:', error);
      // Fallback to in-memory database
      this.database = {
        models: {},
        lastUpdate: Date.now()
      };
    }
  }

  async loadBenchmarkData(): Promise<void> {
    try {
      const benchmarkDir = path.join(process.cwd(), 'benchmark-results');
      
      // Check if directory exists
      try {
        await fs.access(benchmarkDir);
      } catch {
        logger.info('No benchmark-results directory found');
        return;
      }
      
      // Find the most recent comprehensive results file
      const files = await fs.readdir(benchmarkDir);
      const comprehensiveFiles = files.filter(file => file.startsWith('comprehensive-results-'));
      
      if (comprehensiveFiles.length > 0) {
        // Sort by name (which includes timestamp) to get most recent
        comprehensiveFiles.sort().reverse();
        const latestFile = comprehensiveFiles[0];
        
        // Load the comprehensive results
        const filePath = path.join(benchmarkDir, latestFile);
        const data = await fs.readFile(filePath, 'utf-8');
        const results = JSON.parse(data) as ComprehensiveBenchmarkResults;
        
        // Update the database with model data from comprehensive results
        if (results && results.models) {
          let importedCount = 0;
          
          for (const [modelId, modelStats] of Object.entries(results.models)) {
            if (!this.database.models[modelId]) {
              // Only add if not already in database
              this.database.models[modelId] = {
                id: modelId,
                name: modelId,
                provider: modelId.split('-')[0] || 'unknown',
                lastSeen: new Date().toISOString(),
                contextWindow: 4096, // Default
                successRate: modelStats.successRate ?? 0,
                qualityScore: modelStats.qualityScore ?? 0,
                avgResponseTime: modelStats.avgResponseTime ?? 0,
                complexityScore: modelStats.complexityScore ?? 0,
                lastBenchmarked: new Date().toISOString(),
                benchmarkCount: modelStats.benchmarkCount ?? 1,
                isFree: true // Assuming these are free models from benchmark results
              } as ModelPerformanceData;
              
              importedCount++;
            }
          }
          
          logger.info(`Imported ${importedCount} models from benchmark results`);
          
          // Save the updated database
          if (importedCount > 0) {
            await this.saveDatabase();
          }
        }
      } else {
        logger.info('No comprehensive benchmark results found');
      }
    } catch (error) {
      logger.error('Error loading benchmark data:', error);
    }
  }

  getDatabase(): ModelsDatabase {
    return this.database;
  }

  async updateModelData(modelId: string, data: Partial<ModelPerformanceData>): Promise<void> {
    const existing = this.database.models[modelId] || {
      avgResponseTime: 0,
      qualityScore: 0
    };
    
    this.database.models[modelId] = {
      ...existing,
      ...data
    };
    
    this.database.lastUpdate = Date.now();
    
    // Save to disk whenever data is updated
    await this.saveDatabase();
  }

  async saveDatabase(): Promise<void> {
    try {
      await fs.writeFile(this.dbFilePath, JSON.stringify(this.database, null, 2));
      logger.debug('Models database saved to disk');
    } catch (error) {
      logger.error('Error saving models database:', error);
    }
  }

  async clearDatabase(): Promise<void> {
    this.database = {
      models: {},
      lastUpdate: Date.now()
    };
    
    // Also clear the file
    await this.saveDatabase();
  }
}

export const modelsDbService = ModelsDbService.getInstance();