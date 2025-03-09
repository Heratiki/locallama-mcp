/**
 * bm25.ts
 * Wrapper for the retriv Python library for BM25-based semantic search.
 * This module handles the interoperability between TypeScript and the Python retriv library.
 */

import { spawn } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
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
   * Initialize the Python retriv process
   */
  public async initialize(): Promise<void> {
    if (this.initialized) {
      return Promise.resolve(); // Or simply: return;
    }

    if (this.initPromise) {
      return this.initPromise;
    }

    this.initPromise = new Promise<void>((resolve, reject) => {
      // Create a Python script that uses retriv
      const scriptPath = path.join(__dirname, 'retriv_bridge.py');
      
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
            logger.debug('Python response:', response);
          } catch (e) {
            logger.debug('Python output:', message);
          }
        }
      });
      
      this.pythonProcess.stderr.on('data', (data: Buffer) => {
        const errorMessage = data.toString();
        logger.error('Python error:', errorMessage);
        reject(new Error(errorMessage));
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
   * Index a collection of documents
   * @param documents Array of text documents to index
   */
  public async indexDocuments(documents: string[]): Promise<void> {
    if (!this.initialized) {
      await this.initialize();
    }
    
    this.indexedDocuments = documents;
    
    const message = JSON.stringify({
      action: 'index',
      documents,
      options: this.options
    });
    
    return new Promise<void>((resolve, reject) => {
      this.pythonProcess.stdin.write(message + '\n', (err: Error | null) => {
        if (err) {
          reject(err);
          return;
        }
        
        // Wait for confirmation from Python
        const dataHandler = (data: Buffer) => {
          const response = data.toString().trim();
          if (response === 'INDEX_COMPLETE') {
            this.pythonProcess.stdout.removeListener('data', dataHandler);
            resolve();
          }
        };
        
        this.pythonProcess.stdout.on('data', dataHandler);
      });
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
    
    if (this.indexedDocuments.length === 0) {
      return [];
    }
    
    const message = JSON.stringify({
      action: 'search',
      query,
      topK
    });
    
    return new Promise<SearchResult[]>((resolve, reject) => {
      this.pythonProcess.stdin.write(message + '\n', (err: Error | null) => {
        if (err) {
          reject(err);
          return;
        }
        
        // Wait for search results from Python
        const dataHandler = (data: Buffer) => {
          try {
            const response = JSON.parse(data.toString().trim());
            if (response.action === 'search_results') {
              this.pythonProcess.stdout.removeListener('data', dataHandler);
              
              // Map indices to actual documents
              const results: SearchResult[] = response.results.map((result: any) => ({
                index: result.index,
                score: result.score,
                content: this.indexedDocuments[result.index]
              }));
              
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
      this.pythonProcess.stdin.end();
      this.pythonProcess = null;
      this.initialized = false;
      this.initPromise = null;
    }
  }
}