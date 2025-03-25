/**
 * bm25.ts
 * Wrapper for the retriv Python library for BM25-based semantic search.
 * This module handles the interoperability between TypeScript and the Python library.
 */

import { spawn, ChildProcessWithoutNullStreams } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import fs from 'fs';
import { logger } from '../../utils/logger.js';
import { config } from '../../config/index.js';
import { execSync } from 'child_process';

// Create equivalents for __dirname and __filename in ESM
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Interfaces for Python process communication
export interface BM25Options {
  k1?: number;
  b?: number;
  epsilon?: number;
}

// Add missing type definitions
export interface TextPreprocessingOptions {
  stemming?: boolean;
  removeStopwords?: boolean;
  lowercase?: boolean;
}

export interface DenseRetrieverOptions {
  modelName?: string;
  batchSize?: number;
  deviceId?: string;
}

export interface HybridRetrieverOptions {
  weightSparse?: number;
  weightDense?: number;
  denseOptions?: DenseRetrieverOptions;
  textOptions?: TextPreprocessingOptions;
}

interface SearchResultItem {
  index: number;
  score: number;
  content: string;
  file_path?: string;
}

interface PythonResponse {
  status?: 'success' | 'warning' | 'error';
  message?: string;
  action?: string;
  error?: string;
  results?: Array<{
    index: number;
    score: number;
    content: string;
    file_path?: string;
  }>;
  time_taken?: string;
  total_files?: number;
  file_paths?: string[];
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

// Update RetrieverInitOptions to include all needed properties
export interface RetrieverInitOptions {
  retrieverType?: string;
  textPreprocessingOptions?: TextPreprocessingOptions;
  denseRetrieverOptions?: DenseRetrieverOptions;
  hybridRetrieverOptions?: HybridRetrieverOptions;
}

interface LogData {
  level: 'ERROR' | 'WARNING' | 'INFO' | 'DEBUG';
  message: string;
  timestamp?: string;
}

export class BM25Searcher {
  private pythonProcess: ChildProcessWithoutNullStreams | null = null;
  private initialized: boolean = false;
  private indexedDocuments: string[] = [];
  private options: Required<BM25Options>;
  private initPromise: Promise<void> | null = null;
  private bridgeReady: boolean = false;
  private retrieverType: string = 'sparse';
  private pythonExecutable: string = 'python';

  constructor(options: BM25Options = {}) {
    this.options = {
      k1: typeof options.k1 === 'number' ? options.k1 : 1.5,
      b: typeof options.b === 'number' ? options.b : 0.75,
      epsilon: typeof options.epsilon === 'number' ? options.epsilon : 0.25
    };

    this.pythonExecutable = this.resolvePythonExecutable();

    logger.info(`Using Python executable: ${this.pythonExecutable}`);
  }

  /**
   * Try to detect Python virtual environment
   * @returns Path to Python executable in virtual environment or null
   */
  private detectVirtualEnvironment(): string | null {
    try {
      // First check explicitly configured paths
      if (config.python?.path) {
        const configuredPath = path.resolve(config.python.path);
        if (fs.existsSync(configuredPath)) {
          try {
            execSync(`${configuredPath} -c "import retriv"`, { stdio: 'pipe' });
            logger.info(`Using configured Python path: ${configuredPath}`);
            return configuredPath;
          } catch {
            logger.warn(`Configured Python path exists but cannot import retriv: ${configuredPath}`);
          }
        } else {
          logger.warn(`Configured Python path does not exist: ${configuredPath}`);
        }
      }

      // Check if running in a virtual environment
      if (process.env.VIRTUAL_ENV) {
        const venvPythonPath = path.join(
          process.env.VIRTUAL_ENV,
          process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python'
        );

        if (fs.existsSync(venvPythonPath)) {
          try {
            execSync(`${venvPythonPath} -c "import retriv"`, { stdio: 'pipe' });
            logger.info(`Using active virtual environment Python: ${venvPythonPath}`);
            return venvPythonPath;
          } catch {
            logger.warn(`Active virtual environment Python cannot import retriv: ${venvPythonPath}`);
          }
        }
      }

      // Check configured virtual environment path
      if (config.python?.virtualEnv) {
        const venvPythonPath = path.join(
          config.python.virtualEnv,
          process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python'
        );

        if (fs.existsSync(venvPythonPath)) {
          try {
            execSync(`${venvPythonPath} -c "import retriv"`, { stdio: 'pipe' });
            logger.info(`Using configured virtual environment Python: ${venvPythonPath}`);
            return venvPythonPath;
          } catch {
            logger.warn(`Configured virtual environment Python cannot import retriv: ${venvPythonPath}`);
          }
        }
      }

      // Check common virtual environment locations
      // Determine project root - handle both running from src and dist
      let projectRoot = process.cwd();
      if (projectRoot.includes('/dist') || projectRoot.includes('\\dist')) {
        // If running from dist, go up one level
        projectRoot = path.resolve(projectRoot, '..');
        logger.debug(`Detected running from dist, using parent directory as project root: ${projectRoot}`);
      }
      
      const possibleVenvPaths = [
        // Project root venvs
        path.join(projectRoot, 'venv', 'bin', 'python'),
        path.join(projectRoot, 'env', 'bin', 'python'),
        path.join(projectRoot, '.venv', 'bin', 'python'),
        // Absolute paths for clarity
        path.resolve(projectRoot, 'venv/bin/python'),
        path.resolve(projectRoot, 'env/bin/python'),
        path.resolve(projectRoot, '.venv/bin/python'),
      ];

      // Add Windows-specific paths
      if (process.platform === 'win32') {
        possibleVenvPaths.push(
          path.join(projectRoot, 'venv', 'Scripts', 'python.exe'),
          path.join(projectRoot, 'env', 'Scripts', 'python.exe'),
          path.join(projectRoot, '.venv', 'Scripts', 'python.exe'),
          path.resolve(projectRoot, 'venv/Scripts/python.exe'),
          path.resolve(projectRoot, 'env/Scripts/python.exe'),
          path.resolve(projectRoot, '.venv/Scripts/python.exe')
        );
      }

      // Check each possible path
      for (const venvPath of possibleVenvPaths) {
        if (fs.existsSync(venvPath)) {
          try {
            execSync(`${venvPath} -c "import retriv"`, { stdio: 'pipe' });
            logger.info(`Found working virtual environment with retriv: ${venvPath}`);
            return venvPath;
          } catch (err) {
            logger.debug(`Virtual environment at ${venvPath} exists but cannot import retriv: ${err instanceof Error ? err.message : String(err)}`);
          }
        }
      }

      logger.warn('No suitable virtual environment with retriv found');
      return null;
    } catch (err: unknown) {
      logger.error('Error while detecting virtual environment:', err instanceof Error ? err.message : String(err));
      return null;
    }
  }

  private getPythonScriptPath(): string {
    const scriptName = 'retriv_bridge.py';
    const possiblePaths = [
      path.join(__dirname, scriptName),
      path.resolve(__dirname, `../../../src/modules/cost-monitor/${scriptName}`),
      path.join(process.cwd(), 'src/modules/cost-monitor', scriptName),
      path.join(process.cwd(), 'modules/cost-monitor', scriptName),
      path.join(process.cwd(), 'cost-monitor', scriptName)
    ];

    for (const scriptPath of possiblePaths) {
      if (fs.existsSync(scriptPath)) {
        logger.debug(`Found Python bridge script at: ${scriptPath}`);
        return scriptPath;
      }
    }

    throw new Error(`Python bridge script ${scriptName} not found in any of the expected locations`);
  }

  private processStdoutLine(line: string, resolve: (value: void | PromiseLike<void>) => void): void {
    if (!line.trim()) return;

    if (line === 'RETRIV_READY') {
      this.bridgeReady = true;
      this.initialized = true;
      logger.info('Python retriv bridge is ready');
      resolve();
      return;
    }

    try {
      const response = JSON.parse(line) as PythonResponse;
      if (response.status === 'error') {
        logger.error(`Error from Python bridge: ${response.message || response.error || 'Unknown error'}`);
        // We don't throw here as this might not be related to initialization
        // Just log the error but don't reject the initialization promise
      } else if (response.status === 'success') {
        logger.debug(`Received success response from Python bridge: ${response.message || 'No message'}`);
      }
    } catch {
      // This is likely just a debug or info message, not JSON
      logger.debug(`Unhandled stdout line: ${line}`);
    }
  }

  public async initialize(retrieverOptions?: RetrieverInitOptions): Promise<void> {
    // Prevent multiple concurrent initializations
    if (this.initPromise) {
      return this.initPromise;
    }

    // Reset state if already initialized
    if (this.initialized) {
      this.dispose();
    }

    this.initPromise = new Promise<void>((resolve, reject) => {
      try {
        const scriptPath = this.getPythonScriptPath();
        logger.info(`Initializing Python retriv bridge at ${scriptPath} using executor: ${this.pythonExecutable}`);

        const pythonProcess = spawn(this.pythonExecutable, [scriptPath]);
        this.pythonProcess = pythonProcess;

        let errorBuffer = '';
        let stdoutBuffer = '';
        const initTimeout = setTimeout(() => {
          if (!this.initialized) {
            const timeoutError = new Error('Python retriv bridge initialization timeout');
            logger.error(timeoutError.message);
            cleanupListeners();
            this.dispose();
            reject(timeoutError);
          }
        }, 30000);

        if (retrieverOptions?.retrieverType) {
          this.retrieverType = retrieverOptions.retrieverType;
        }

        const cleanupListeners = () => {
          if (this.pythonProcess) {
            this.pythonProcess.stdout.removeAllListeners();
            this.pythonProcess.stderr.removeAllListeners();
            this.pythonProcess.removeAllListeners('error');
            this.pythonProcess.removeAllListeners('exit');
          }
          clearTimeout(initTimeout);
        };

        if (!this.pythonProcess) {
          throw new Error('Failed to start Python process');
        }

        this.pythonProcess.stdout.on('data', (data: Buffer) => {
          const message = data.toString();
          stdoutBuffer += message;

          const lines = stdoutBuffer.split('\n');
          if (lines.length > 1) {
            for (let i = 0; i < lines.length - 1; i++) {
              try {
                this.processStdoutLine(lines[i], resolve);
              } catch (error) {
                logger.error('Error processing stdout:', error instanceof Error ? error.message : String(error));
              }
            }
            stdoutBuffer = lines[lines.length - 1];
          }
        });

        pythonProcess.stderr.on('data', (data: Buffer) => {
          const errorMessage = data.toString();
          errorBuffer += errorMessage;

          try {
            const logData = JSON.parse(errorMessage) as LogData;
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
                case 'DEBUG':
                  logger.debug(`Retriv: ${logData.message}`);
                  break;
              }
            }
          } catch {
            if (errorMessage.includes('Error:') || 
                errorMessage.includes('Exception:') || 
                errorMessage.includes('Traceback')) {
              logger.error('Python error:', errorMessage);
              if (!this.initialized) {
                cleanupListeners();
                reject(new Error(errorMessage));
              }
            }
          }
        });

        pythonProcess.on('error', (err: Error) => {
          logger.error('Failed to start Python process:', err);
          cleanupListeners();
          reject(err);
        });

        pythonProcess.on('exit', (code: number) => {
          this.initialized = false;
          this.bridgeReady = false;
          // Reject promise on exit codes other than 0
          if (code !== 0) {
            const error = new Error(`Python process exited with code ${code}\nError: ${errorBuffer}`);
            logger.error(error.message);
            cleanupListeners();
            reject(error);
          }
        });

      } catch (error) {
        logger.error('Error during initialization:', error instanceof Error ? error.message : String(error));
        this.dispose();
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    }).finally(() => {
      this.initPromise = null;
    });

    return this.initPromise;
  }

  public async indexDocuments(documents: string[]): Promise<IndexingResult> {
    if (!this.initialized) {
      await this.initialize();
    }

    this.indexedDocuments = documents;

    const message = JSON.stringify({
      action: 'index',
      documents: documents,
      options: { ...this.options },
      retriever_type: this.retrieverType
    });

    logger.info(`Indexing ${documents.length} documents using ${this.retrieverType} retriever`);

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
                if (this.pythonProcess?.stdout) {
                  this.pythonProcess.stdout.removeListener('data', dataHandler);
                }
                resolve({
                  status: 'success',
                  totalFiles: documents.length,
                  timeTaken: 'N/A',
                  filePaths: []
                });
                return;
              }

              const response = JSON.parse(line) as PythonResponse;

              if (response.status === 'success' || response.status === 'warning') {
                logger.info(`Indexing ${response.status}: ${response.message ?? ''}`);
                if (this.pythonProcess?.stdout) {
                  this.pythonProcess.stdout.removeListener('data', dataHandler);
                }

                resolve({
                  status: response.status,
                  totalFiles: response.total_files ?? documents.length,
                  timeTaken: response.time_taken ?? 'N/A',
                  filePaths: response.file_paths ?? []
                });
                return;
              } else if (response.status === 'error') {
                logger.error(`Indexing error: ${response.message}`);
                if (this.pythonProcess?.stdout) {
                  this.pythonProcess.stdout.removeListener('data', dataHandler);
                }
                reject(new Error(response.message ?? 'Retriever configuration failed'));
                return;
              }
            } catch {
              // Not a valid JSON response or not the response we're looking for
            }
          }

          // Keep the last (possibly incomplete) line in the buffer
          stdoutBuffer = lines[lines.length - 1];
        }
      };

      if (!this.pythonProcess) {
        reject(new Error('Python process is not initialized'));
        return;
      }

      this.pythonProcess.stdout.on('data', dataHandler);

      this.pythonProcess.stdin.write(message + '\n', (error?: Error | null) => {
        if (error) {
          logger.error('Error writing to Python process:', error);
          if (this.pythonProcess?.stdout) {
            this.pythonProcess.stdout.removeListener('data', dataHandler);
          }
          reject(new Error(error.message));
          return;
        }
      });

      // Set a timeout for indexing
      setTimeout(() => {
        if (this.pythonProcess?.stdout && this.pythonProcess.stdout.listeners('data').includes(dataHandler)) {
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

    if (!this.pythonProcess?.stdin || !this.pythonProcess?.stdout) {
      throw new Error('Python process not properly initialized');
    }

    const message = JSON.stringify({
      action: 'index',
      directories: directories,
      options: { ...this.options }
    });

    logger.info(`Indexing directories: ${directories.join(', ')}`);

    return new Promise<IndexingResult>((resolve, reject) => {
      let stdoutBuffer = '';
      const pythonProcess = this.pythonProcess;

      if (!pythonProcess?.stdout || !pythonProcess?.stdin) {
        reject(new Error('Python process streams not available'));
        return;
      }

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

              const response = JSON.parse(line) as PythonResponse;

              if (response.status === 'success' || response.status === 'warning') {
                logger.info(`Indexing ${response.status}: ${response.message ?? ''}`);
                pythonProcess.stdout?.removeListener('data', dataHandler);

                if (response.file_paths) {
                  // Store the indexed documents content if available
                  this.indexedDocuments = response.file_paths;
                }

                resolve({
                  status: response.status,
                  totalFiles: response.total_files || 0,
                  timeTaken: response.time_taken ?? 'N/A',
                  filePaths: response.file_paths ?? []
                });
                return;
              } else if (response.status === 'error') {
                logger.error(`Indexing error: ${response.message}`);
                this.pythonProcess?.stdout?.removeListener('data', dataHandler);
                reject(new Error(response.message ?? 'Retriever configuration failed'));
                return;
              }
            } catch {
              // Not a valid JSON response or not the response we're looking for
              continue;
            }
          }

          // Keep the last (possibly incomplete) line in the buffer
          stdoutBuffer = lines[lines.length - 1];
        }
      };

      pythonProcess.stdout.on('data', dataHandler);

      pythonProcess.stdin.write(message + '\n', (error?: Error | null) => {
        if (error) {
          logger.error('Error writing to Python process:', error);
          this.pythonProcess?.stdout?.removeListener('data', dataHandler);
          reject(new Error(error.message));
          return;
        }
      });

      setTimeout(() => {
        const stdout = this.pythonProcess?.stdout;
        if (stdout?.listeners('data').includes(dataHandler)) {
          logger.warn('Indexing timeout. Assuming indexing completed but response was not recognized.');
          stdout.removeListener('data', dataHandler);
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

  public dispose(): void {
    try {
      if (this.pythonProcess) {
        logger.info('Disposing Python retriv bridge');

        // Send exit command to Python process
        try {
          this.pythonProcess.stdin.write(JSON.stringify({ action: 'exit' }) + '\n');
        } catch (e) {
          logger.debug('Error sending exit command:', e);
        }

        // Kill process after a short delay if it hasn't exited
        setTimeout(() => {
          try {
            if (this.pythonProcess?.kill) {
              this.pythonProcess.kill();
            }
          } catch (e) {
            logger.debug('Error killing Python process:', e);
          }
        }, 1000);

        this.pythonProcess = null;
      }
    } catch (e) {
      logger.error('Error during disposal:', e);
    } finally {
      this.initialized = false;
      this.bridgeReady = false;
      this.initPromise = null;
    }
  }

  public async search(query: string, topK: number = 5): Promise<SearchResult[]> {
    if (!this.initialized || !this.pythonProcess?.stdin || !this.pythonProcess?.stdout) {
      await this.initialize();
    }

    const pythonProcess = this.pythonProcess;
    if (!pythonProcess?.stdin || !pythonProcess?.stdout) {
      throw new Error('Python process not properly initialized');
    }

    const message = JSON.stringify({
      action: 'search',
      query,
      topK,
      retriever_type: this.retrieverType
    });

    logger.info(`Searching for: "${query}" (top ${topK} results) using ${this.retrieverType} retriever`);

    return new Promise<SearchResult[]>((resolve, reject) => {
      let stdoutBuffer = '';

      const dataHandler = (data: Buffer) => {
        const responseStr = data.toString();
        stdoutBuffer += responseStr;

        const lines = stdoutBuffer.split('\n');
        if (lines.length > 1) {
          for (let i = 0; i < lines.length - 1; i++) {
            try {
              const line = lines[i].trim();
              if (!line) continue;

              const response = JSON.parse(line) as PythonResponse;

              if (response.action === 'search_results') {
                pythonProcess.stdout?.removeListener('data', dataHandler);

                if (response.error) {
                  logger.error(`Search error: ${response.error}`);
                  reject(new Error(response.error));
                  return;
                }

                logger.info(`Search completed with ${response.results?.length ?? 0} results in ${response.time_taken || 'N/A'}`);

                const results: SearchResult[] = response.results ?
                  response.results.map((result: SearchResultItem) => ({
                    index: typeof result.index === 'number' ? result.index : 0,
                    score: typeof result.score === 'number' ? result.score : 0,
                    content: String(result.content || ''),
                    file_path: result.file_path ? String(result.file_path) : undefined,
                  })) :
                  [];

                resolve(results);
                return;
              }
            } catch {
              // Not a valid JSON response or not the response we're looking for
              continue;
            }
          }

          stdoutBuffer = lines[lines.length - 1];
        }
      };

      // Safe access to stdout after null check
      if (!pythonProcess?.stdout) {
        reject(new Error('Python process stdout not available'));
        return;
      }

      pythonProcess.stdout.on('data', dataHandler);

      // Safe access to stdin after null check
      if (!pythonProcess?.stdin) {
        pythonProcess.stdout.removeListener('data', dataHandler);
        reject(new Error('Python process stdin not available'));
        return;
      }

      pythonProcess.stdin.write(message + '\n', (error?: Error | null) => {
        if (error) {
          logger.error('Error writing to Python process:', error);
          pythonProcess.stdout?.removeListener('data', dataHandler);
          reject(new Error(error.message));
          return;
        }
      });

      setTimeout(() => {
        const stdout = pythonProcess?.stdout;
        if (stdout?.listeners('data').includes(dataHandler)) {
          logger.warn('Search timeout. No response received from Python bridge.');
          stdout.removeListener('data', dataHandler);
          resolve([]);
        }
      }, 10000);
    });
  }

  private resolvePythonExecutable(): string {
    let pythonExecutable = 'python';
    
    logger.debug(`Current working directory: ${process.cwd()}`);
    const isRunningFromDist = process.cwd().endsWith('/dist') || process.cwd().endsWith('\\dist');
    if (isRunningFromDist) {
      logger.info(`Detected running from dist directory, will check parent directory for Python environment`);
    }
    
    // Try to find Python in this order:
    // 1. RETRIV_PYTHON_PATH environment variable
    // 2. config.python.path
    // 3. Detected virtual environment
    // 4. System Python with retriv installed
    // 5. Fallback to default 'python' command
    if (process.env.RETRIV_PYTHON_PATH) {
      pythonExecutable = process.env.RETRIV_PYTHON_PATH.trim();
      logger.info(`Using Python executable from RETRIV_PYTHON_PATH: ${pythonExecutable}`);
      return pythonExecutable;
    }
    
    if (config.python?.path) {
      pythonExecutable = config.python.path.trim();
      logger.info(`Using Python executable from config: ${pythonExecutable}`);
      return pythonExecutable;
    }
    
    // Try to detect virtual environment
    try {
      const virtualEnvPath = this.detectVirtualEnvironment();
      if (virtualEnvPath) {
        pythonExecutable = virtualEnvPath;
        return pythonExecutable;
      }
    } catch (err) {
      logger.debug('Failed to auto-detect Python virtual environment:', err instanceof Error ? err.message : String(err));
    }
    
    // Special handling when running from dist directory
    if (isRunningFromDist) {
      const projectRoot = path.resolve(process.cwd(), '..');
      logger.debug(`Checking for Python in parent directory: ${projectRoot}`);
      
      // Check specific Python paths in the parent directory
      const parentVenvPaths = [
        path.join(projectRoot, '.venv', 'bin', 'python'),
        path.join(projectRoot, 'venv', 'bin', 'python'),
        path.join(projectRoot, 'env', 'bin', 'python')
      ];
      
      // Add Windows-specific paths
      if (process.platform === 'win32') {
        parentVenvPaths.push(
          path.join(projectRoot, '.venv', 'Scripts', 'python.exe'),
          path.join(projectRoot, 'venv', 'Scripts', 'python.exe'),
          path.join(projectRoot, 'env', 'Scripts', 'python.exe')
        );
      }
      
      // Check each path specifically for retriv module
      for (const venvPath of parentVenvPaths) {
        if (fs.existsSync(venvPath)) {
          try {
            execSync(`${venvPath} -c "import retriv"`, { stdio: 'pipe' });
            logger.info(`Found Python with retriv module in parent directory: ${venvPath}`);
            return venvPath;
          } catch {
            logger.debug(`Python exists at ${venvPath} but retriv module not found`);
          }
        }
      }
    }
    
    // Try common Python commands if no virtual environment found
    const pythonCommands = ['python3', 'python', 'py'];
    for (const cmd of pythonCommands) {
      try {
        execSync(`${cmd} -c "import retriv"`, { stdio: 'pipe' });
        logger.info(`Found retriv module using system Python: ${cmd}`);
        return cmd;
      } catch {
        continue;
      }
    }

    // If nothing else works, return default and let it fail with a clear error
    logger.warn('Could not find Python with retriv installed, falling back to default "python" command');
    return pythonExecutable;
  }
}