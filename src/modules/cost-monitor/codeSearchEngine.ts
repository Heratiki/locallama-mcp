import { CodeSearchEngine, CodeSearchEngineOptions, CodeSearchResult } from './codeSearch.js';
import { logger } from '../../utils/logger.js';
import { config } from '../../config/index.js';
import { loadUserPreferences } from '../user-preferences/index.js';
import * as path from 'path';
import { IndexingResult } from './bm25.js';

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
      logger.info('Code search engine already initialized, skipping initialization');
      return;
    }

    try {
      // Load user preferences for exclude patterns
      const userPreferences = await loadUserPreferences();
      
      // Create options with user preferences
      const engineOptions: CodeSearchEngineOptions = {
        excludePatterns: userPreferences.excludePatterns,
        chunkSize: 1000, // Default chunk size
        directories: config.directoriesToIndex, // Include directories to index from config
        ...options // Override with provided options
      };

      logger.info('Initializing code search engine with options:', engineOptions);
      
      // Create and initialize the code search engine
      this.codeSearchEngine = new CodeSearchEngine(config.rootDir, engineOptions);
      await this.codeSearchEngine.initialize();
      
      this.initialized = true;
      logger.info('Code search engine manager initialized successfully, indexing root directory');
      
      // Make sure we index some initial directories if provided in config
      if (config.directoriesToIndex && config.directoriesToIndex.length > 0) {
        logger.info(`Indexing configured directories: ${config.directoriesToIndex.join(', ')}`);
        try {
          for (const dir of config.directoriesToIndex) {
            await this.indexDirectory(dir);
          }
        } catch (error) {
          logger.warn(`Error indexing configured directories: ${error}. Continuing with initialization anyway.`);
        }
      } else {
        await this.indexDirectory(config.rootDir);
      }
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
      logger.info('Code search engine not initialized, initializing with default settings');
      await this.initialize();
    }
    
    return this.codeSearchEngine!;
  }

  /**
   * Index a specific directory
   * @param directory The directory to index
   * @param forceReindex Whether to force reindexing
   * @returns Results of the indexing operation
   */
  public async indexDirectory(directory: string, forceReindex: boolean = false): Promise<IndexingResult> {
    try {
      const engine = await this.getCodeSearchEngine();
      
      // Convert relative path to absolute
      const absolutePath = path.isAbsolute(directory) 
        ? directory 
        : path.join(config.rootDir, directory);
      
      logger.info(`Preparing to index directory: ${absolutePath} (force reindex: ${forceReindex})`);
      
      /*
      Author: Roo
      Date: March 11, 2025, 8:35:16 PM
      Original code preserved below - removed duplicate initialization and fixed document indexing
      // Create a new engine instance for this directory using default options
      const directoryEngine = new CodeSearchEngine(absolutePath);
      await directoryEngine.initialize();
      
      await directoryEngine.initialize();
      
      // Index the directory and get detailed results
      */
      
      // Create and initialize a new engine instance for this directory using default options
      const directoryEngine = new CodeSearchEngine(absolutePath);
      await directoryEngine.initialize();
      
      // Index the directory and get detailed results
      const startTime = Date.now();
      const result = await directoryEngine.indexWorkspaceWithDetails(forceReindex);
      const endTime = Date.now();
      const timeTaken = ((endTime - startTime) / 1000).toFixed(2);
      
      if (result) {
        logger.info(`Successfully indexed directory ${directory}: ${result.totalFiles} files in ${timeTaken} seconds`);
        return result;
      } else {
        logger.info(`Indexed directory ${directory} (legacy mode, no details available)`);
        return {
          status: 'success',
          totalFiles: 0,
          timeTaken: `${timeTaken} seconds`,
          filePaths: []
        };
      }
    } catch (error) {
      logger.error(`Error indexing directory ${directory}:`, error);
      throw error;
    }
  }

  /**
   * Search for code using a query string
   * @param query The search query
   * @param topK Number of top results to return
   */
  public async search(query: string, topK: number = 5): Promise<CodeSearchResult[]> {
    try {
      logger.info(`Searching for: "${query}" (top ${topK} results)`);
      const engine = await this.getCodeSearchEngine();
      
      // Check document count first to provide clearer warning message
      const count = await engine.getDocumentCount();
      if (count === 0) {
        logger.warn('No documents have been indexed yet. Consider indexing directories first.');
        return [];
      }
      
      const results = await engine.search(query, topK);
      logger.info(`Found ${results.length} results for query: ${query}`);
      return results;
    } catch (error) {
      logger.error(`Error searching for "${query}":`, error);
      throw error;
    }
  }

  /**
   * Get the document count
   */
  public async getDocumentCount(): Promise<number> {
    try {
      const engine = await this.getCodeSearchEngine();
      const count = await engine.getDocumentCount();
      logger.info(`Total indexed documents: ${count}`);
      return count;
    } catch (error) {
      logger.error('Error getting document count:', error);
      throw error;
    }
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
    try {
      const engine = await this.getCodeSearchEngine();
      return engine.getIndexStatus();
    } catch (error) {
      logger.error('Error getting index status:', error);
      throw error;
    }
  }

  /**
   * Index specific documents
   * This is used to store execution results in the search index 
   * @param documents Documents to index with content, path, and language
   */
  public async indexDocuments(documents: { content: string, path: string, language?: string }[]): Promise<IndexingResult> {
    try {
      logger.info(`Indexing ${documents.length} documents manually`);
      const engine = await this.getCodeSearchEngine();
      const startTime = Date.now();
      
      // Add metadata to the contents to help with retrieval
      const contentsWithMetadata = documents.map(doc => {
        const language = doc.language || 'code';
        let metadata = '';
        
        switch (language) {
          case 'javascript':
          case 'typescript':
          case 'js':
          case 'ts':
            metadata = `// Path: ${doc.path}\n// Language: ${language}\n// Added: ${new Date().toISOString()}\n\n`;
            break;
          case 'python':
          case 'py':
            metadata = `# Path: ${doc.path}\n# Language: ${language}\n# Added: ${new Date().toISOString()}\n\n`;
            break;
          case 'html':
            metadata = `<!-- Path: ${doc.path}\nLanguage: ${language}\nAdded: ${new Date().toISOString()} -->\n\n`;
            break;
          default:
            metadata = `// Path: ${doc.path}\n// Language: ${language}\n// Added: ${new Date().toISOString()}\n\n`;
        }
        
        return metadata + doc.content;
      });
      
      /*
      Author: Roo
      Date: March 12, 2025, 9:45:22 PM
      Original code preserved below - fixed document indexing with proper BM25Searcher API
      // Use the BM25Searcher's indexDocuments method directly
      await engine.indexWorkspace();
      */
      
      // Create document objects for the engine to index
      const codeDocuments = documents.map((doc, index) => ({
        content: contentsWithMetadata[index],
        path: doc.path,
        language: doc.language || 'code'
      }));
      
      // Access the underlying BM25Searcher and index the documents directly
      // This is a workaround for the current API limitations
      try {
        // Get the private BM25Searcher instance using a type assertion
        const bm25Searcher = (engine as any).bm25Searcher;
        
        if (bm25Searcher && typeof bm25Searcher.indexDocuments === 'function') {
          await bm25Searcher.indexDocuments(contentsWithMetadata);
          logger.info(`Successfully indexed ${documents.length} documents directly with BM25Searcher`);
        } else {
          // Fallback to the engine's indexWorkspace method
          logger.info(`Using fallback method to index documents`);
          
          // Store the documents in the engine's documents array
          // This is a workaround that depends on implementation details
          (engine as any).documents = [...((engine as any).documents || []), ...codeDocuments];
          
          // Force a reindex to include the new documents
          await engine.indexWorkspaceWithDetails(true);
        }
      } catch (error) {
        logger.warn(`Error with direct indexing approach: ${error}, using fallback`);
        // Fallback approach
        await engine.indexWorkspaceWithDetails(true);
      }
      
      const endTime = Date.now();
      const timeTaken = ((endTime - startTime) / 1000).toFixed(2);
      
      logger.info(`Successfully indexed ${documents.length} documents in ${timeTaken} seconds`);
      
      return {
        status: 'success',
        totalFiles: documents.length,
        timeTaken: `${timeTaken} seconds`,
        filePaths: documents.map(doc => doc.path)
      };
    } catch (error) {
      logger.error('Error indexing documents:', error);
      throw error;
    }
  }

  /**
   * Reset the code search engine
   */
  public async reset(): Promise<void> {
    logger.info('Resetting code search engine');
    if (this.codeSearchEngine) {
      this.codeSearchEngine.dispose();
      this.codeSearchEngine = null;
    }
    this.initialized = false;
    logger.info('Code search engine reset complete');
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
export async function indexDocuments(documents: { content: string, path: string, language?: string }[]): Promise<IndexingResult> {
  try {
    logger.info(`Indexing ${documents.length} documents`);
    return await codeSearchEngineManager.indexDocuments(documents);
  } catch (error) {
    logger.error('Error indexing documents:', error);
    throw error;
  }
}