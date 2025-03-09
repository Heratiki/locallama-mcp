/**
 * bm25.ts
 * Wrapper for the retriv Python library for BM25-based semantic search.
 * This module handles the interoperability between TypeScript and the Python retriv library.
 */

import { spawn } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import fs from 'fs';
import { logger } from '../../utils/logger.js';

// Create equivalents for __dirname and __filename in ESM
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export interface BM25Options {
  k1?: number; // Term saturation parameter (default: 1.5)
  b?: number;  // Document length normalization (default: 0.75)
  epsilon?: number; // BM25+ parameter
}

export interface SearchResult {
  index: number;
  score: number;
  content: string;
}

export interface IndexingResult {
  status: string;
  totalFiles: number;
  timeTaken: string;
  filePaths: string[];
}

export class BM25Searcher {
  private pythonProcess: any = null;
  private initialized: boolean = false;
  private indexedDocuments: string[] = [];
  private options: BM25Options;
  private initPromise: Promise<void> | null = null;

  constructor(options: BM25Options = {}) {
    this.options = {
      k1: options.k1 || 1.5,
      b: options.b || 0.75,
      epsilon: options.epsilon || 0.25
    };
  }

  /**
   * Get the path to the Python bridge script, ensuring it exists
   */
  private getPythonScriptPath(): string {
    // Try direct path from the compiled code
    let scriptPath = path.join(__dirname, 'retriv_bridge.py');
    
    // If not found, look for the script in the source directory
    if (!fs.existsSync(scriptPath)) {
      // Check if we're in the dist directory and navigate to src
      const srcPath = path.resolve(__dirname, '../../../src/modules/cost-monitor/retriv_bridge.py');
      if (fs.existsSync(srcPath)) {
        scriptPath = srcPath;
      } else {
        // If we're already in src or another location, try to find the file relative to the project root
        const projectRootPath = path.resolve(__dirname, '../../../');
        const possiblePaths = [
          path.join(projectRootPath, 'src/modules/cost-monitor/retriv_bridge.py'),
          path.join(projectRootPath, 'modules/cost-monitor/retriv_bridge.py'),
          path.join(projectRootPath, 'cost-monitor/retriv_bridge.py')
        ];
        
        for (const p of possiblePaths) {
          if (fs.existsSync(p)) {
            scriptPath = p;
            break;
          }
        }
      }
    }
    
    logger.debug(`Using Python bridge script at: ${scriptPath}`);
    return scriptPath;
  }

  /**
   * Initialize the Python retriv process
   */
  public async initialize(): Promise<void> {
    if (this.initialized) {
      return Promise.resolve();
    }

    if (this.initPromise) {
      return this.initPromise;
    }

    this.initPromise = new Promise<void>((resolve, reject) => {
      // Get the Python script path
      const scriptPath = this.getPythonScriptPath();
      
      if (!fs.existsSync(scriptPath)) {
        const error = new Error(`Python bridge script not found at: ${scriptPath}`);
        logger.error(error.message);
        reject(error);
        return;
      }
      
      logger.info(`Initializing Python retriv bridge at ${scriptPath}`);
      
      // Spawn a Python process
      this.pythonProcess = spawn('python', [scriptPath]);
      
      this.pythonProcess.stdout.on('data', (data: Buffer) => {
        const message = data.toString().trim();
        if (message === 'RETRIV_READY') {
          logger.info('Python retriv bridge initialized successfully');
          this.initialized = true;
          resolve();
        } else {
          try {
            // Parse other responses as JSON
            const response = JSON.parse(message);
            
            if (response.status === 'success' && response.total_files !== undefined) {
              logger.info(`Successfully indexed ${response.total_files} files in ${response.time_taken}`);
            } else if (response.action === 'search_results') {
              logger.info(`Search completed with ${response.results.length} results in ${response.time_taken || 'N/A'}`);
            } else if (response.error) {
              logger.error(`Python error: ${response.error}`);
              if (response.stack_trace) {
                logger.debug(`Stack trace: ${response.stack_trace}`);
              }
            }
          } catch (e) {
            logger.debug('Python output:', message);
          }
        }
      });
      
      // Process Python stderr for log messages
      this.pythonProcess.stderr.on('data', (data: Buffer) => {
        try {
          const errorMessage = data.toString().trim();
          try {
            // Try to parse as JSON log message
            const logData = JSON.parse(errorMessage);
            if (logData.level && logData.message) {
              switch (logData.level) {
                case 'ERROR':
                  logger.error(`Retriv: ${logData.message}`);
                  break;
                case 'WARNING':
                  logger.warn(`Retriv: ${logData.message}`);
                  break;
                case 'INFO':
                  logger.info(`Retriv: ${logData.message}`);
                  break;
                default:
                  logger.debug(`Retriv: ${logData.message}`);
              }
              return;
            }
          } catch (e) {
            // Not a JSON log message, treat as regular error
          }
          
          logger.error('Python error:', errorMessage);
          if (!this.initialized) {
            reject(new Error(errorMessage));
          }
        } catch (e) {
          logger.error('Error processing Python stderr:', e);
        }
      });
      
      this.pythonProcess.on('error', (err: Error) => {
        logger.error('Failed to start Python process:', err);
        reject(err);
      });
      
      this.pythonProcess.on('exit', (code: number) => {
        this.initialized = false;
        if (code !== 0) {
          logger.error(`Python process exited with code ${code}`);
          reject(new Error(`Python process exited with code ${code}`));
        }
      });
    });

    return this.initPromise;
  }

  /**
   * Index a collection of documents or directories
   * @param documents Array of text documents to index or directories to scan
   * @param isDirectories Whether the input is a list of directories (true) or documents (false)
   */
  public async indexDocuments(documents: string[], isDirectories: boolean = false): Promise<IndexingResult> {
    if (!this.initialized) {
      await this.initialize();
    }
    
    if (!isDirectories) {
      this.indexedDocuments = documents;
    }
    
    const message = JSON.stringify({
      action: 'index',
      [isDirectories ? 'directories' : 'documents']: documents,
      options: this.options
    });
    
    logger.info(`Indexing ${isDirectories ? 'directories' : 'documents'}: ${documents.length} items`);
    
    return new Promise<IndexingResult>((resolve, reject) => {
      this.pythonProcess.stdin.write(message + '\n', (err: Error | null) => {
        if (err) {
          logger.error('Error writing to Python process:', err);
          reject(err);
          return;
        }
        
        // Wait for indexing result from Python
        const dataHandler = (data: Buffer) => {
          const responseStr = data.toString().trim();
          
          if (responseStr === 'INDEX_COMPLETE') {
            logger.info('Indexing completed successfully (legacy format)');
            this.pythonProcess.stdout.removeListener('data', dataHandler);
            resolve({
              status: 'success',
              totalFiles: documents.length,
              timeTaken: 'N/A',
              filePaths: []
            });
            return;
          }
          
          try {
            const response = JSON.parse(responseStr);
            
            if (response.status === 'success' || response.status === 'warning') {
              logger.info(`Indexing ${response.status}: ${response.message || ''}`);
              this.pythonProcess.stdout.removeListener('data', dataHandler);
              
              if (response.file_paths && isDirectories) {
                // Store the indexed documents content if available
                this.indexedDocuments = response.file_paths;
              }
              
              resolve({
                status: response.status,
                totalFiles: response.total_files || 0,
                timeTaken: response.time_taken || 'N/A',
                filePaths: response.file_paths || []
              });
            } else if (response.status === 'error') {
              logger.error(`Indexing error: ${response.message}`);
              this.pythonProcess.stdout.removeListener('data', dataHandler);
              reject(new Error(response.message));
            }
          } catch (e) {
            // Not JSON or not the response we're looking for
          }
        };
        
        this.pythonProcess.stdout.on('data', dataHandler);
      });
    });
  }

  /**
   * Index documents from directories
   * @param directories Array of directory paths to index
   */
  public async indexDirectories(directories: string[]): Promise<IndexingResult> {
    return this.indexDocuments(directories, true);
  }

  /**
   * Search for documents using a query string
   * @param query The search query
   * @param topK Number of top results to return
   * @returns Array of search results with scores and document content
   */
  public async search(query: string, topK: number = 5): Promise<SearchResult[]> {
    if (!this.initialized) {
      await this.initialize();
    }
    
    if (this.indexedDocuments.length === 0) {
      logger.warn('No documents have been indexed yet');
      return [];
    }
    
    const message = JSON.stringify({
      action: 'search',
      query,
      topK
    });
    
    logger.info(`Searching for: "${query}" (top ${topK} results)`);
    
    return new Promise<SearchResult[]>((resolve, reject) => {
      this.pythonProcess.stdin.write(message + '\n', (err: Error | null) => {
        if (err) {
          logger.error('Error writing to Python process:', err);
          reject(err);
          return;
        }
        
        // Wait for search results from Python
        const dataHandler = (data: Buffer) => {
          try {
            const response = JSON.parse(data.toString().trim());
            if (response.action === 'search_results') {
              this.pythonProcess.stdout.removeListener('data', dataHandler);
              
              if (response.error) {
                logger.error(`Search error: ${response.error}`);
                reject(new Error(response.error));
                return;
              }
              
              logger.info(`Search completed with ${response.results.length} results in ${response.time_taken || 'N/A'}`);
              
              // Map indices to actual documents
              const results: SearchResult[] = response.results.map((result: any) => {
                const docIndex = result.index;
                const content = docIndex < this.indexedDocuments.length 
                  ? this.indexedDocuments[docIndex]
                  : `[Document #${docIndex} not available]`;
                
                return {
                  index: docIndex,
                  score: result.score,
                  content: content
                };
              });
              
              resolve(results);
            }
          } catch (e) {
            // Ignore non-JSON messages
          }
        };
        
        this.pythonProcess.stdout.on('data', dataHandler);
      });
    });
  }

  /**
   * Clean up resources when done
   */
  public dispose(): void {
    if (this.pythonProcess) {
      logger.info('Disposing Python retriv bridge');
      this.pythonProcess.stdin.end();
      this.pythonProcess = null;
      this.initialized = false;
      this.initPromise = null;
    }
  }
}