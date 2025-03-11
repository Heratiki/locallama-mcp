/**
 * Types for the Retriv Integration module
 */

export interface IRetrivIntegration {
  /**
   * Check if Python is available on the system
   */
  isPythonAvailable: () => boolean;
  
  /**
   * Check if a Python module is installed
   * @param moduleName Name of the Python module to check
   */
  isPythonModuleInstalled: (moduleName: string) => boolean;
  
  /**
   * Generate a requirements.txt file for Retriv dependencies
   */
  generateRequirementsTxt: () => string;
  
  /**
   * Initialize Retriv with the specified configuration
   */
  initializeRetriv: (params: RetrivInitParams) => Promise<RetrivInitResult>;
  
  /**
   * Search for documents using Retriv
   */
  search: (query: string, limit?: number) => Promise<RetrivSearchResult[]>;
  
  /**
   * Index documents in Retriv
   */
  indexDocuments: (documents: RetrivDocument[]) => Promise<void>;
  
  /**
   * Get document count in Retriv's index
   */
  getDocumentCount: () => Promise<number>;
}

export interface RetrivInitParams {
  /**
   * Array of directories to index
   */
  directories: string[];
  
  /**
   * Array of glob patterns to exclude from indexing
   */
  excludePatterns?: string[];
  
  /**
   * Size of chunks for large files (in lines)
   */
  chunkSize?: number;
  
  /**
   * Whether to force reindexing of all files
   */
  forceReindex?: boolean;
  
  /**
   * Options for the BM25 algorithm
   */
  bm25Options?: BM25Options;
  
  /**
   * Whether to automatically install required Python dependencies
   */
  installDependencies?: boolean;
}

export interface BM25Options {
  /**
   * The k1 parameter in BM25
   */
  k1?: number;
  
  /**
   * The b parameter in BM25
   */
  b?: number;
  
  /**
   * The epsilon parameter in BM25
   */
  epsilon?: number;
}

export interface RetrivInitResult {
  /**
   * Whether the initialization was successful
   */
  success: boolean;
  
  /**
   * Summary information about the indexing process
   */
  summary: {
    /**
     * Number of indexed directories
     */
    indexedDirectories: number;
    
    /**
     * Total number of files indexed
     */
    totalFiles: number;
    
    /**
     * Number of documents in the index
     */
    documentCount: number;
    
    /**
     * Total time taken for indexing (seconds)
     */
    totalTimeTaken: string;
  };
  
  /**
   * Details for each indexed directory
   */
  details: RetrivIndexingResult[];
  
  /**
   * Whether Retriv is ready for searching
   */
  searchReady: boolean;
  
  /**
   * Suggested next steps
   */
  nextSteps?: string;
}

export interface RetrivIndexingResult {
  /**
   * The directory that was indexed
   */
  directory: string;
  
  /**
   * Number of files indexed in this directory
   */
  filesIndexed?: number;
  
  /**
   * Status of the indexing operation
   */
  status: 'success' | 'warning' | 'error';
  
  /**
   * Additional message about the indexing operation
   */
  message?: string;
  
  /**
   * Time taken for indexing this directory
   */
  timeTaken?: string;
}

export interface RetrivDocument {
  /**
   * Content of the document
   */
  content: string;
  
  /**
   * Path or identifier for the document
   */
  path: string;
  
  /**
   * Language or type of the document content
   */
  language?: string;
  
  /**
   * Additional metadata
   */
  metadata?: Record<string, any>;
}

export interface RetrivSearchResult {
  /**
   * Content of the found document
   */
  content: string;
  
  /**
   * Path or identifier of the document
   */
  path: string;
  
  /**
   * Relevance score of this result
   */
  score: number;
  
  /**
   * Highlighted snippets for display
   */
  highlights?: string[];
  
  /**
   * Additional metadata
   */
  metadata?: Record<string, any>;
}

