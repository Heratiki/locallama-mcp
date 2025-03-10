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
        ...options // Override with provided options
      };

      logger.info('Initializing code search engine with options:', engineOptions);
      
      // Create and initialize the code search engine
      this.codeSearchEngine = new CodeSearchEngine(config.rootDir, engineOptions);
      await this.codeSearchEngine.initialize();
      
      this.initialized = true;
      logger.info('Code search engine manager initialized successfully');
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
      
      // Create a new engine instance for this directory
      const directoryEngine = new CodeSearchEngine(absolutePath, {
        excludePatterns: engine['excludePatterns'],
        chunkSize: engine['options'].chunkSize
      });
      
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
      
      if (!engine.indexDocuments) {
        // If the method doesn't exist on the engine, we'll implement it here
        const startTime = Date.now();
        
        // Add metadata to the contents to help with retrieval
        const contentsWithMetadata = documents.map(doc => {
          // Add metadata as comments based on the language
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
        
        // Call the underlying BM25 searcher to index the documents
        // We need to access the internal BM25 searcher directly
        const results = await engine['bm25Searcher'].addDocuments(contentsWithMetadata);
        
        const endTime = Date.now();
        const timeTaken = ((endTime - startTime) / 1000).toFixed(2);
        
        logger.info(`Successfully indexed ${documents.length} documents in ${timeTaken} seconds`);
        
        return {
          status: 'success',
          totalFiles: documents.length,
          timeTaken: `${timeTaken} seconds`,
          filePaths: documents.map(doc => doc.path)
        };
      } else {
        // If the method exists, use it
        return await engine.indexDocuments(documents);
      }
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