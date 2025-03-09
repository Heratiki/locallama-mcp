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
  file_path?: string;
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
  private bridgeReady: boolean = false;

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
      
      // Buffer for collecting stdout data
      let stdoutBuffer = '';
      
      this.pythonProcess.stdout.on('data', (data: Buffer) => {
        const message = data.toString().trim();
        stdoutBuffer += message;
        
        // Check for command delimitation (newlines)
        const lines = stdoutBuffer.split('\n');
        if (lines.length > 1) {
          // Process all complete lines
          for (let i = 0; i < lines.length - 1; i++) {
            this.processStdoutLine(lines[i], resolve);
          }
          // Keep the last (possibly incomplete) line in the buffer
          stdoutBuffer = lines[lines.length - 1];
        } else if (message === 'RETRIV_READY') {
          // Special case for the ready message
          logger.info('Python retriv bridge initialized successfully');
          this.initialized = true;
          this.bridgeReady = true;
          resolve();
          stdoutBuffer = '';
        }
      });
      
      // Process Python stderr for log messages
      this.pythonProcess.stderr.on('data', (data: Buffer) => {
        try {
          const errorMessage = data.toString().trim();
          
          try {
            // Try to parse as JSON log message
            const lines = errorMessage.split('\n');
            for (const line of lines) {
              if (!line.trim()) continue;
              
              try {
                const logData = JSON.parse(line);
                if (logData.level && logData.message) {
                  // This is a log message, not an error
                  switch (logData.level) {
                    case 'ERROR':
                      logger.error(`Retriv: ${logData.message}`);
                      break;
                    case 'WARNING':
                      logger.warn(`Retriv: ${logData.message}`);
                      break;
                    case 'INFO':
                      logger.info(`Retriv: ${logData.message}`);
                      // If the bridge is ready for commands, consider it initialized
                      if (logData.message === "Retriv bridge ready for commands") {
                        setTimeout(() => {
                          if (!this.bridgeReady) {
                            this.initialized = true;
                            this.bridgeReady = true;
                            resolve();
                          }
                        }, 1000); // Give a little time for the RETRIV_READY message
                      }
                      break;
                    default:
                      logger.debug(`Retriv: ${logData.message}`);
                  }
                }
              } catch (e) {
                // Not a JSON log message, could be an actual error
                if (line.includes("Error:") || 
                    line.includes("Exception:") || 
                    line.includes("Traceback")) {
                  logger.error('Python error:', line);
                  if (!this.initialized && !this.bridgeReady) {
                    reject(new Error(line));
                  }
                } else if (line.trim()) {
                  // Otherwise it's probably just output we should log
                  logger.debug('Python stderr output:', line);
                }
              }
            }
          } catch (e) {
            // If JSON parsing of the whole string failed, just log it as is
            if (errorMessage.includes("Error:") || 
                errorMessage.includes("Exception:") || 
                errorMessage.includes("Traceback")) {
              logger.error('Python error:', errorMessage);
              if (!this.initialized && !this.bridgeReady) {
                reject(new Error(errorMessage));
              }
            } else {
              // Otherwise it's probably just output we should log
              logger.debug('Python stderr output:', errorMessage);
            }
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
        this.bridgeReady = false;
        if (code !== 0) {
          logger.error(`Python process exited with code ${code}`);
          reject(new Error(`Python process exited with code ${code}`));
        }
      });

      // Set a timeout in case the Python process doesn't respond
      setTimeout(() => {
        if (!this.initialized) {
          logger.warn('Python retriv bridge initialization timeout. Assuming ready.');
          this.initialized = true;
          this.bridgeReady = true;
          resolve();
        }
      }, 10000); // 10 seconds timeout
    });

    return this.initPromise;
  }

  /**
   * Process a line from the Python process stdout
   */
  private processStdoutLine(line: string, resolveInit?: () => void): void {
    if (!line.trim()) return;
    
    if (line === 'RETRIV_READY') {
      logger.info('Python retriv bridge initialized successfully');
      this.initialized = true;
      this.bridgeReady = true;
      if (resolveInit) resolveInit();
      return;
    }
    
    try {
      // Try to parse as JSON
      const response = JSON.parse(line);
      
      if (response.status === 'success' || response.status === 'warning') {
        logger.info(`Retriv ${response.status}: ${response.message || ''}`);
      } else if (response.status === 'error') {
        logger.error(`Retriv error: ${response.message}`);
      } else if (response.action === 'search_results') {
        logger.info(`Search completed with ${response.results ? response.results.length : 0} results in ${response.time_taken || 'N/A'}`);
      } else {
        logger.debug('Python output:', response);
      }
    } catch (e) {
      // Not JSON or not the response we're looking for
      logger.debug('Non-JSON Python output:', line);
    }
  }

  /**
   * Index a collection of documents
   * @param documents Array of text documents to index
   * @returns Detailed information about the indexing process
   */
  public async indexDocuments(documents: string[]): Promise<IndexingResult> {
    if (!this.initialized) {
      await this.initialize();
    }
    
    this.indexedDocuments = documents;
    
    const message = JSON.stringify({
      action: 'index',
      documents: documents,
      options: this.options
    });
    
    logger.info(`Indexing ${documents.length} documents`);
    
    return new Promise<IndexingResult>((resolve, reject) => {
      // Buffer for collecting stdout data
      let stdoutBuffer = '';
      
      const dataHandler = (data: Buffer) => {
        const responseStr = data.toString();
        stdoutBuffer += responseStr;
        
        // Process complete lines
        const lines = stdoutBuffer.split('\n');
        if (lines.length > 1) {
          // Process all complete lines except the last one (which might be incomplete)
          for (let i = 0; i < lines.length - 1; i++) {
            try {
              const line = lines[i].trim();
              if (!line) continue;
              
              if (line === 'INDEX_COMPLETE') {
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
              
              const response = JSON.parse(line);
              
              if (response.status === 'success' || response.status === 'warning') {
                logger.info(`Indexing ${response.status}: ${response.message || ''}`);
                this.pythonProcess.stdout.removeListener('data', dataHandler);
                
                resolve({
                  status: response.status,
                  totalFiles: response.total_files || documents.length,
                  timeTaken: response.time_taken || 'N/A',
                  filePaths: response.file_paths || []
                });
                return;
              } else if (response.status === 'error') {
                logger.error(`Indexing error: ${response.message}`);
                this.pythonProcess.stdout.removeListener('data', dataHandler);
                reject(new Error(response.message));
                return;
              }
            } catch (e) {
              // Not a valid JSON response or not the response we're looking for
            }
          }
          
          // Keep the last (possibly incomplete) line in the buffer
          stdoutBuffer = lines[lines.length - 1];
        }
      };
      
      this.pythonProcess.stdout.on('data', dataHandler);
      
      this.pythonProcess.stdin.write(message + '\n', (err: Error | null) => {
        if (err) {
          logger.error('Error writing to Python process:', err);
          this.pythonProcess.stdout.removeListener('data', dataHandler);
          reject(err);
          return;
        }
      });

      // Set a timeout for indexing
      setTimeout(() => {
        if (this.pythonProcess.stdout.listeners('data').includes(dataHandler)) {
          logger.warn('Indexing timeout. Assuming indexing completed but response was not recognized.');
          this.pythonProcess.stdout.removeListener('data', dataHandler);
          resolve({
            status: 'success',
            totalFiles: documents.length,
            timeTaken: 'Timed out after 30 seconds',
            filePaths: []
          });
        }
      }, 30000); // 30 seconds timeout
    });
  }

  /**
   * Index documents from directories
   * @param directories Array of directory paths to index
   */
  public async indexDirectories(directories: string[]): Promise<IndexingResult> {
    if (!this.initialized) {
      await this.initialize();
    }
    
    const message = JSON.stringify({
      action: 'index',
      directories: directories,
      options: this.options
    });
    
    logger.info(`Indexing directories: ${directories.join(', ')}`);
    
    return new Promise<IndexingResult>((resolve, reject) => {
      // Buffer for collecting stdout data
      let stdoutBuffer = '';
      
      const dataHandler = (data: Buffer) => {
        const responseStr = data.toString();
        stdoutBuffer += responseStr;
        
        // Process complete lines
        const lines = stdoutBuffer.split('\n');
        if (lines.length > 1) {
          // Process all complete lines except the last one (which might be incomplete)
          for (let i = 0; i < lines.length - 1; i++) {
            try {
              const line = lines[i].trim();
              if (!line) continue;
              
              const response = JSON.parse(line);
              
              if (response.status === 'success' || response.status === 'warning') {
                logger.info(`Indexing ${response.status}: ${response.message || ''}`);
                this.pythonProcess.stdout.removeListener('data', dataHandler);
                
                if (response.file_paths) {
                  // Store the indexed documents content if available
                  this.indexedDocuments = response.file_paths;
                }
                
                resolve({
                  status: response.status,
                  totalFiles: response.total_files || 0,
                  timeTaken: response.time_taken || 'N/A',
                  filePaths: response.file_paths || []
                });
                return;
              } else if (response.status === 'error') {
                logger.error(`Indexing error: ${response.message}`);
                this.pythonProcess.stdout.removeListener('data', dataHandler);
                reject(new Error(response.message));
                return;
              }
            } catch (e) {
              // Not a valid JSON response or not the response we're looking for
            }
          }
          
          // Keep the last (possibly incomplete) line in the buffer
          stdoutBuffer = lines[lines.length - 1];
        }
      };
      
      this.pythonProcess.stdout.on('data', dataHandler);
      
      this.pythonProcess.stdin.write(message + '\n', (err: Error | null) => {
        if (err) {
          logger.error('Error writing to Python process:', err);
          this.pythonProcess.stdout.removeListener('data', dataHandler);
          reject(err);
          return;
        }
      });

      // Set a timeout for indexing
      setTimeout(() => {
        if (this.pythonProcess.stdout.listeners('data').includes(dataHandler)) {
          logger.warn('Indexing timeout. Assuming indexing completed but response was not recognized.');
          this.pythonProcess.stdout.removeListener('data', dataHandler);
          resolve({
            status: 'success',
            totalFiles: 0,
            timeTaken: 'Timed out after 30 seconds',
            filePaths: []
          });
        }
      }, 30000); // 30 seconds timeout
    });
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
    
    const message = JSON.stringify({
      action: 'search',
      query,
      topK
    });
    
    logger.info(`Searching for: "${query}" (top ${topK} results)`);
    
    return new Promise<SearchResult[]>((resolve, reject) => {
      // Buffer for collecting stdout data
      let stdoutBuffer = '';
      
      const dataHandler = (data: Buffer) => {
        const responseStr = data.toString();
        stdoutBuffer += responseStr;
        
        // Process complete lines
        const lines = stdoutBuffer.split('\n');
        if (lines.length > 1) {
          // Process all complete lines except the last one (which might be incomplete)
          for (let i = 0; i < lines.length - 1; i++) {
            try {
              const line = lines[i].trim();
              if (!line) continue;
              
              const response = JSON.parse(line);
              
              if (response.action === 'search_results') {
                this.pythonProcess.stdout.removeListener('data', dataHandler);
                
                if (response.error) {
                  logger.error(`Search error: ${response.error}`);
                  reject(new Error(response.error));
                  return;
                }
                
                logger.info(`Search completed with ${response.results.length} results in ${response.time_taken || 'N/A'}`);
                
                // Format the results
                const results: SearchResult[] = response.results.map((result: any) => ({
                  index: result.index,
                  score: result.score,
                  content: result.content || '',
                  file_path: result.file_path || 'Unknown'
                }));
                
                resolve(results);
                return;
              }
            } catch (e) {
              // Not a valid JSON response or not the response we're looking for
            }
          }
          
          // Keep the last (possibly incomplete) line in the buffer
          stdoutBuffer = lines[lines.length - 1];
        }
      };
      
      this.pythonProcess.stdout.on('data', dataHandler);
      
      this.pythonProcess.stdin.write(message + '\n', (err: Error | null) => {
        if (err) {
          logger.error('Error writing to Python process:', err);
          this.pythonProcess.stdout.removeListener('data', dataHandler);
          reject(err);
          return;
        }
      });

      // Set a timeout for search
      setTimeout(() => {
        if (this.pythonProcess.stdout.listeners('data').includes(dataHandler)) {
          logger.warn('Search timeout. No response received from Python bridge.');
          this.pythonProcess.stdout.removeListener('data', dataHandler);
          resolve([]);
        }
      }, 10000); // 10 seconds timeout
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
      this.bridgeReady = false;
      this.initPromise = null;
    }
  }
}