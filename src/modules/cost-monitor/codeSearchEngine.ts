import { CodeSearchEngine, CodeSearchEngineOptions, CodeSearchResult } from './codeSearch.js';
import { logger } from '../../utils/logger.js';
import { config } from '../../config/index.js';
import { loadUserPreferences } from '../user-preferences/index.js';
import * as path from 'path';

/**
 * Singleton wrapper for CodeSearchEngine to ensure consistent access across the application
 */
class CodeSearchEngineManager {
  private static instance: CodeSearchEngineManager;
  private codeSearchEngine: CodeSearchEngine | null = null;
  private initialized: boolean = false;

  private constructor() {}

  static getInstance(): CodeSearchEngineManager {
    if (!CodeSearchEngineManager.instance) {
      CodeSearchEngineManager.instance = new CodeSearchEngineManager();
    }
    return CodeSearchEngineManager.instance;
  }

  /**
   * Initialize the code search engine with user preferences
   */
  public async initialize(options?: CodeSearchEngineOptions): Promise<void> {
    if (this.initialized && this.codeSearchEngine) {
      return;
    }

    try {
      // Load user preferences for exclude patterns
      const userPreferences = await loadUserPreferences();
      
      // Create options with user preferences
      const engineOptions: CodeSearchEngineOptions = {
        excludePatterns: userPreferences.excludePatterns,
        chunkSize: 1000, // Default chunk size
        ...options // Override with provided options
      };

      // Create and initialize the code search engine
      this.codeSearchEngine = new CodeSearchEngine(config.rootDir, engineOptions);
      await this.codeSearchEngine.initialize();
      
      this.initialized = true;
      logger.info('Code search engine manager initialized');
    } catch (error) {
      logger.error('Failed to initialize code search engine manager', error);
      throw error;
    }
  }

  /**
   * Get the code search engine instance
   * Initializes with default settings if not already initialized
   */
  public async getCodeSearchEngine(): Promise<CodeSearchEngine> {
    if (!this.initialized || !this.codeSearchEngine) {
      await this.initialize();
    }
    
    return this.codeSearchEngine!;
  }

  /**
   * Index a specific directory
   * @param directory The directory to index
   * @param forceReindex Whether to force reindexing
   */
  public async indexDirectory(directory: string, forceReindex: boolean = false): Promise<void> {
    const engine = await this.getCodeSearchEngine();
    
    // Convert relative path to absolute
    const absolutePath = path.isAbsolute(directory) 
      ? directory 
      : path.join(config.rootDir, directory);
    
    // Create a new engine instance for this directory
    const directoryEngine = new CodeSearchEngine(absolutePath, {
      excludePatterns: engine['excludePatterns'],
      chunkSize: engine['options'].chunkSize
    });
    
    await directoryEngine.initialize();
    await directoryEngine.indexWorkspace(forceReindex);
    
    logger.info(`Indexed directory: ${directory}`);
  }

  /**
   * Search for code using a query string
   * @param query The search query
   * @param topK Number of top results to return
   */
  public async search(query: string, topK: number = 5): Promise<CodeSearchResult[]> {
    const engine = await this.getCodeSearchEngine();
    return engine.search(query, topK);
  }

  /**
   * Get the document count
   */
  public async getDocumentCount(): Promise<number> {
    const engine = await this.getCodeSearchEngine();
    return engine.getDocumentCount();
  }

  /**
   * Get the indexing status
   */
  public async getIndexStatus(): Promise<{
    indexing: boolean;
    filesIndexed: number;
    totalFiles: number;
    currentFile?: string;
    lastUpdate: number;
    error?: string;
  }> {
    const engine = await this.getCodeSearchEngine();
    return engine.getIndexStatus();
  }

  /**
   * Reset the code search engine
   */
  public async reset(): Promise<void> {
    if (this.codeSearchEngine) {
      this.codeSearchEngine.dispose();
      this.codeSearchEngine = null;
    }
    this.initialized = false;
  }
}

export const codeSearchEngineManager = CodeSearchEngineManager.getInstance();

/**
 * Get the code search engine
 * This is a convenience function for use in other modules
 */
export async function getCodeSearchEngine(): Promise<CodeSearchEngine> {
  return codeSearchEngineManager.getCodeSearchEngine();
}

/**
 * Index documents with the code search engine
 * @param documents Array of documents to index
 */
export async function indexDocuments(documents: { content: string, path: string, language: string }[]): Promise<void> {
  const engine = await getCodeSearchEngine();
  await engine['bm25Searcher'].indexDocuments(documents.map(doc => doc.content));
}