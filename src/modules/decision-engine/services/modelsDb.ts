import path from 'path';
import fs from 'fs/promises';
import { mkdir } from 'fs/promises';
import { config } from '../../../config/index.js';
import { logger } from '../../../utils/logger.js';
import { ModelPerformanceData } from '../../../types/index.js';

interface ModelsDatabase {
  models: Record<string, ModelPerformanceData>;
  lastUpdate: number;
}

class ModelsDbService {
  private static instance: ModelsDbService;
  private database: ModelsDatabase = {
    models: {},
    lastUpdate: 0
  };

  private constructor() {}

  static getInstance(): ModelsDbService {
    if (!ModelsDbService.instance) {
      ModelsDbService.instance = new ModelsDbService();
    }
    return ModelsDbService.instance;
  }

  async initialize(): Promise<void> {
    logger.debug('Initializing models database');
    // Initialize with empty database if none exists
    if (Object.keys(this.database.models).length === 0) {
      this.database = {
        models: {},
        lastUpdate: Date.now()
      };
    }
  }

  getDatabase(): ModelsDatabase {
    return this.database;
  }

  updateModelData(modelId: string, data: Partial<ModelPerformanceData>): void {
    const existing = this.database.models[modelId] || {
      avgResponseTime: 0,
      qualityScore: 0
    };
    
    this.database.models[modelId] = {
      ...existing,
      ...data
    };
    
    this.database.lastUpdate = Date.now();
  }

  clearDatabase(): void {
    this.database = {
      models: {},
      lastUpdate: Date.now()
    };
  }
}

export const modelsDbService = ModelsDbService.getInstance();