/**
 * codeSearch.ts
 * Implements code repository indexing and searching using retriv's algorithms.
 * This module handles scanning the workspace, indexing code files, and providing search functionality.
 */
import { BM25Options, TextPreprocessingOptions, DenseRetrieverOptions, HybridRetrieverOptions } from './bm25.js';
export type RetrieverType = 'sparse' | 'dense' | 'hybrid';

export interface CodeSearchEngineOptions {
  chunkSize?: number;
  excludePatterns?: string[];
  bm25Options?: BM25Options;
  retrieverType?: RetrieverType;
  // Add new retrievers' options
  textPreprocessingOptions?: TextPreprocessingOptions;
  denseRetrieverOptions?: DenseRetrieverOptions;
  hybridRetrieverOptions?: HybridRetrieverOptions;
  directories?: string[];
}

import * as fs from 'fs';
import * as path from 'path';
import { glob } from 'glob';
import { logger } from '../../utils/logger.js';
import { BM25Searcher, SearchResult } from './bm25.js';

export interface CodeDocument {
  content: string;       // The actual code content
  path: string;          // Path to the file
  language: string;      // Programming language
  startLine?: number;    // Starting line number (for code snippets)
  endLine?: number;      // Ending line number (for code snippets)
}

export interface CodeSearchResult extends SearchResult {
  path: string;           // Path to the file
  language: string;       // Programming language
  startLine?: number;     // Starting line number (for snippets)
  endLine?: number;       // Ending line number (for snippets)
  relativePath?: string;  // Path relative to the workspace root
}

export class CodeSearchEngine {
  private bm25Searcher: BM25Searcher;
  private documents: CodeDocument[] = [];
  private indexedPaths: Set<string> = new Set();
  private workspaceRoot: string;
  private initialized: boolean = false;
  private options: CodeSearchEngineOptions;
  private retrieverType: RetrieverType = 'sparse';
  private textPreprocessingOptions?: TextPreprocessingOptions;
  private denseRetrieverOptions?: DenseRetrieverOptions;
  private hybridRetrieverOptions?: HybridRetrieverOptions;
  private indexingStatus = {
    indexing: false,
    filesIndexed: 0,
    totalFiles: 0,
    currentFile: undefined as string | undefined,
    lastUpdate: Date.now(),
    error: undefined as string | undefined
  };
  private excludePatterns: string[] = [
    'node_modules/**',
    '.git/**',
    'dist/**',
    'build/**',
    '.venv/**',
    '**/*.min.js',
    '**/*.bundle.js',
    '**/package-lock.json',
    '**/yarn.lock'
  ];

  constructor(workspaceRoot: string, options: CodeSearchEngineOptions = {}) {
    this.workspaceRoot = workspaceRoot;
    this.options = options;
    this.retrieverType = options.retrieverType || 'sparse';
    this.textPreprocessingOptions = options.textPreprocessingOptions;
    this.denseRetrieverOptions = options.denseRetrieverOptions;
    this.hybridRetrieverOptions = options.hybridRetrieverOptions;
    this.bm25Searcher = new BM25Searcher(options.bm25Options);
    this.excludePatterns = options.excludePatterns || this.excludePatterns;
  }

  /**
   * Initialize the code search engine
   */
  public async initialize(): Promise<void> {
    if (this.initialized) {
      return;
    }

    try {
      // Pass all retriever options to the BM25 searcher
      await this.bm25Searcher.initialize({
        retrieverType: this.retrieverType,
        textPreprocessingOptions: this.textPreprocessingOptions,
        denseRetrieverOptions: this.denseRetrieverOptions,
        hybridRetrieverOptions: this.hybridRetrieverOptions
      });
      this.initialized = true;
      logger.info(`Code search engine initialized with ${this.retrieverType} retriever`);
    } catch (error) {
      logger.error('Failed to initialize code search engine', error);
      throw error;
    }
  }

  /**
   * Index all code files in the workspace
   * @param forceReindex Whether to force reindexing even if files have been indexed before
   */
  public async indexWorkspace(forceReindex: boolean = false): Promise<void> {
    if (!this.initialized) {
      await this.initialize();
    }

    try {
      this.indexingStatus.indexing = true;
      this.indexingStatus.lastUpdate = Date.now();

      // Find all code files in the workspace
      const codeFiles = await this.findCodeFiles();
      this.indexingStatus.totalFiles = codeFiles.length;
      
      const newOrUpdatedFiles = forceReindex ? codeFiles : await this.filterNewOrUpdatedFiles(codeFiles);

      if (newOrUpdatedFiles.length === 0) {
        logger.info('No new or updated files to index');
        this.indexingStatus.indexing = false;
        return;
      }

      logger.info(`Indexing ${newOrUpdatedFiles.length} code files using ${this.retrieverType} retriever`);

      // Read and process each code file
      for (const file of newOrUpdatedFiles) {
        this.indexingStatus.currentFile = file;
        this.indexingStatus.filesIndexed++;
        this.indexingStatus.lastUpdate = Date.now();
      }
      const newDocuments = await this.readCodeFiles(newOrUpdatedFiles);
      this.documents = [...this.documents.filter(doc => 
        !newOrUpdatedFiles.includes(doc.path)), ...newDocuments];

      // Update the indexedPaths set
      newOrUpdatedFiles.forEach(path => this.indexedPaths.add(path));

      // Index the documents with the BM25 searcher
      const documentContents = this.documents.map(doc => doc.content);
      await this.bm25Searcher.indexDocuments(documentContents);

      logger.info(`Indexed ${this.documents.length} code documents successfully`);
      this.indexingStatus.indexing = false;
      this.indexingStatus.error = undefined;
    } catch (error) {
      logger.error('Failed to index workspace', error);
      this.indexingStatus.error = error instanceof Error ? error.message : 'Unknown error';
      this.indexingStatus.indexing = false;
      throw error;
    }
  }

  /**
   * Index specific directory or directories 
   * @param directories Array of directory paths to index
   * @returns Detailed information about the indexing process
   */
  public async indexDirectories(
    directories: string[]
  ): Promise<{
    status: string;
    totalFiles: number;
    timeTaken: string;
    filePaths: string[];
  }> {
    if (!this.initialized) {
      await this.initialize();
    }
    
    try {
      this.indexingStatus.indexing = true;
      this.indexingStatus.lastUpdate = Date.now();
      
      logger.info(`Starting indexing directories: ${directories.join(', ')}`);
      
      // Use the BM25 searcher's built-in directory indexing
      const result = await this.bm25Searcher.indexDirectories(
        directories.map(dir => path.resolve(this.workspaceRoot, dir))
      );
      
      this.indexingStatus.indexing = false;
      this.indexingStatus.error = undefined;
      
      return {
        status: result.status,
        totalFiles: result.totalFiles,
        timeTaken: result.timeTaken,
        filePaths: result.filePaths
      };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Unknown error';
      logger.error(`Failed to index directories: ${errorMsg}`, error);
      this.indexingStatus.error = errorMsg;
      this.indexingStatus.indexing = false;
      
      throw error;
    }
  }

  /**
   * Index all code files in the workspace with detailed results
   * @param forceReindex Whether to force reindexing even if files have been indexed before
   * @returns Detailed information about the indexing process
   */
  public async indexWorkspaceWithDetails(forceReindex: boolean = false): Promise<{
    status: string;
    totalFiles: number;
    timeTaken: string;
    filePaths: string[];
  }> {
    if (!this.initialized) {
      await this.initialize();
    }
    
    const indexStart = Date.now();
    const indexedFiles: string[] = [];
    
    try {
      this.indexingStatus.indexing = true;
      this.indexingStatus.lastUpdate = Date.now();
      
      // Find all code files in the workspace
      const codeFiles = await this.findCodeFiles();
      this.indexingStatus.totalFiles = codeFiles.length;
      
      logger.info(`Found ${codeFiles.length} code files in workspace`);
      
      const newOrUpdatedFiles = forceReindex ? codeFiles : await this.filterNewOrUpdatedFiles(codeFiles);
      
      if (newOrUpdatedFiles.length === 0) {
        logger.info('No new or updated files to index');
        this.indexingStatus.indexing = false;
        
        const endTime = Date.now();
        const elapsedTime = ((endTime - indexStart) / 1000).toFixed(2);
        
        return {
          status: 'success',
          totalFiles: 0,
          timeTaken: `${elapsedTime} seconds`,
          filePaths: []
        };
      }
      
      logger.info(`Indexing ${newOrUpdatedFiles.length} code files using ${this.retrieverType} retriever`);
      
      // Read and process each code file
      for (const file of newOrUpdatedFiles) {
        this.indexingStatus.currentFile = file;
        this.indexingStatus.filesIndexed++;
        this.indexingStatus.lastUpdate = Date.now();
        indexedFiles.push(file);
        
        logger.debug(`Processing file: ${file}`);
      }
      
      const newDocuments = await this.readCodeFiles(newOrUpdatedFiles);
      
      logger.info(`Loaded ${newDocuments.length} documents from ${newOrUpdatedFiles.length} files`);
      
      this.documents = [...this.documents.filter(doc => 
        !newOrUpdatedFiles.includes(doc.path)), ...newDocuments];
      
      // Update the indexedPaths set
      newOrUpdatedFiles.forEach(path => this.indexedPaths.add(path));
      
      // Index the documents with the BM25 searcher
      const documentContents = this.documents.map(doc => doc.content);
      logger.info(`Sending ${documentContents.length} documents to retriv indexer`);
      
      // Use the enhanced indexDocuments method that returns details
      const indexResult = await this.bm25Searcher.indexDocuments(documentContents);
      
      logger.info(`Indexed ${this.documents.length} code documents successfully`);
      this.indexingStatus.indexing = false;
      this.indexingStatus.error = undefined;

      return {
        status: 'success',
        totalFiles: newOrUpdatedFiles.length,
        timeTaken: indexResult.timeTaken || `${((Date.now() - indexStart) / 1000).toFixed(2)} seconds`,
        filePaths: indexedFiles
      };
    } catch (error) {
      logger.error('Failed to index workspace', error);
      this.indexingStatus.error = error instanceof Error ? error.message : 'Unknown error';
      this.indexingStatus.indexing = false;
      
      throw error;
    }
  }

  /**
   * Search for code using a query string
   * @param query The search query
   * @param topK Number of top results to return
   * @returns Array of code search results
   */
  public async search(query: string, topK: number = 5): Promise<CodeSearchResult[]> {
    if (!this.initialized) {
      await this.initialize();
    }

    if (this.documents.length === 0) {
      logger.warn('No documents have been indexed yet');
      return [];
    }

    try {
      // Perform the search using the BM25 searcher
      const results = await this.bm25Searcher.search(query, topK);

      // Map the results to CodeSearchResult objects
      return results.map(result => {
        const document = this.documents[result.index];
        return {
          ...result,
          path: document ? document.path : result.file_path || 'Unknown',
          language: document ? document.language : this.getLanguageFromPath(result.file_path || ''),
          startLine: document ? document.startLine : undefined,
          endLine: document ? document.endLine : undefined,
          relativePath: document ? path.relative(this.workspaceRoot, document.path) : 
                       result.file_path ? path.relative(this.workspaceRoot, result.file_path) : 'Unknown'
        };
      });
    } catch (error) {
      logger.error('Error searching code', error);
      return [];
    }
  }

  /**
   * Get the language based on file path
   * @param filePath Path to the file
   * @returns The programming language
   */
  private getLanguageFromPath(filePath: string): string {
    if (!filePath) return 'Unknown';
    const ext = path.extname(filePath).toLowerCase();
    return this.getLanguageFromExtension(ext);
  }

  /**
   * Find all code files in the workspace
   * @returns Array of file paths
   */
  private findCodeFiles(): Promise<string[]> {
    return new Promise<string[]>((resolve, reject) => {
      // Define patterns for code files
      const codeFilePatterns = [
        '**/*.ts', '**/*.js', '**/*.tsx', '**/*.jsx',
        '**/*.py', '**/*.java', '**/*.c', '**/*.cpp', '**/*.h',
        '**/*.cs', '**/*.go', '**/*.rb', '**/*.php', '**/*.swift',
        '**/*.kt', '**/*.rs', '**/*.scala', '**/*.sh', '**/*.html',
        '**/*.css', '**/*.scss', '**/*.less', '**/*.json', '**/*.yml',
        '**/*.yaml', '**/*.md', '**/*.xml'
      ];

      const options = {
        cwd: this.workspaceRoot,
        ignore: this.excludePatterns,
        absolute: true,
        nodir: true
      };

      // Use glob to find all files matching the patterns
      glob(`{${codeFilePatterns.join(',')}}`, options)
        .then(files => {
          resolve(files);
        })
        .catch(error => {
          reject(new Error(`Failed to find code files: ${String(error)}`));
        });
    });
  }

  /**
   * Filter out files that have already been indexed and haven't changed
   * @param filePaths Array of file paths
   * @returns Array of file paths that need to be indexed
   */
  private async filterNewOrUpdatedFiles(filePaths: string[]): Promise<string[]> {
    const newFiles: string[] = [];
    
    // Process files in chunks to avoid blocking the event loop
    const chunkSize = 100;
    for (let i = 0; i < filePaths.length; i += chunkSize) {
      const chunk = filePaths.slice(i, i + chunkSize);
      
      // Process each chunk of files
      await Promise.all(chunk.map(async (filePath) => {
        try {
          // If the file hasn't been indexed before, include it
          if (!this.indexedPaths.has(filePath)) {
            newFiles.push(filePath);
            return;
          }
          
          // Check if the file has been modified since last indexing
          const stats = await fs.promises.stat(filePath);
          const indexedDoc = this.documents.find(doc => doc.path === filePath);
          
          // If we can't find the document or the file has been modified, include it
          if (!indexedDoc || stats.mtimeMs > Date.now() - 60000) {
            newFiles.push(filePath);
          }
        } catch (err) {
          // If there's an error checking the file, assume it needs to be indexed
          logger.warn(`Error checking file ${filePath}:`, err);
          newFiles.push(filePath);
        }
      }));
    }
    
    return newFiles;
  }

  /**
   * Read and process code files
   * @param filePaths Array of file paths
   * @returns Array of CodeDocument objects
   */
  private async readCodeFiles(filePaths: string[]): Promise<CodeDocument[]> {
    const documents: CodeDocument[] = [];
    const readPromises: Promise<void>[] = [];

    for (const filePath of filePaths) {
      const promise = new Promise<void>((resolve) => {
        try {
          // Read the file content
          const content = fs.readFileSync(filePath, 'utf-8');

          // Determine the language from the file extension
          const ext = path.extname(filePath).toLowerCase();
          const language = this.getLanguageFromExtension(ext);

          // Create a document for the whole file
          documents.push({
            content,
            path: filePath,
            language
          });

          // Chunk large files into smaller documents
          const chunkSize = this.options.chunkSize || 1000; // Define chunk size (number of lines)
          const lines = content.split('\n');
          for (let i = 0; i < lines.length; i += chunkSize) {
            const chunkContent = lines.slice(i, i + chunkSize).join('\n');
            documents.push({
              content: chunkContent,
              path: filePath,
              language,
              startLine: i + 1,
              endLine: Math.min(i + chunkSize, lines.length)
            });
          }
          resolve();
        } catch (err) {
          logger.warn(`Failed to read file ${filePath}`, err);
          resolve(); // Continue with the next file even if this one fails
        }
      });

      readPromises.push(promise);
    }

    // Wait for all files to be processed
    await Promise.all(readPromises);
    return documents;
  }

  /**
   * Determine the programming language from a file extension
   * @param extension The file extension (including the dot)
   * @returns The programming language name
   */
  private getLanguageFromExtension(extension: string): string {
    const langMap: Record<string, string> = {
      '.ts': 'TypeScript',
      '.js': 'JavaScript',
      '.tsx': 'TypeScript',
      '.jsx': 'JavaScript',
      '.py': 'Python',
      '.java': 'Java',
      '.c': 'C',
      '.cpp': 'C++',
      '.h': 'C/C++',
      '.cs': 'C#',
      '.go': 'Go',
      '.rb': 'Ruby',
      '.php': 'PHP',
      '.swift': 'Swift',
      '.kt': 'Kotlin',
      '.rs': 'Rust',
      '.scala': 'Scala',
      '.sh': 'Shell',
      '.html': 'HTML',
      '.css': 'CSS',
      '.scss': 'SCSS',
      '.less': 'Less',
      '.json': 'JSON',
      '.yml': 'YAML',
      '.yaml': 'YAML',
      '.md': 'Markdown',
      '.xml': 'XML'
    };

    return langMap[extension] || 'Unknown';
  }

  /**
   * Set the retriever type and options
   * @param retrieverType The type of retriever to use
   * @param options The options for the specified retriever
   */
  public setRetrieverOptions(
    retrieverType: RetrieverType,
    options?: TextPreprocessingOptions | DenseRetrieverOptions | HybridRetrieverOptions
  ): void {
    this.retrieverType = retrieverType;
    
    // Set the appropriate options based on the retriever type
    switch (retrieverType) {
      case 'sparse':
        if (options) {
          this.textPreprocessingOptions = options as TextPreprocessingOptions;
        }
        break;
      case 'dense':
        if (options) {
          this.denseRetrieverOptions = options as DenseRetrieverOptions;
        }
        break;
      case 'hybrid':
        if (options) {
          this.hybridRetrieverOptions = options as HybridRetrieverOptions;
        }
        break;
    }
    
    logger.info(`Retriever type set to ${retrieverType} with custom options`);
  }

  /**
   * Get the current retriever options
   * @returns The current retriever options based on retriever type
   */
  public getRetrieverOptions(): TextPreprocessingOptions | DenseRetrieverOptions | HybridRetrieverOptions | undefined {
    switch (this.retrieverType) {
      case 'sparse':
        return this.textPreprocessingOptions;
      case 'dense':
        return this.denseRetrieverOptions;
      case 'hybrid':
        return this.hybridRetrieverOptions;
      default:
        return undefined;
    }
  }

  /**
   * Get the current retriever type
   * @returns The current retriever type
   */
  public getRetrieverType(): RetrieverType {
    return this.retrieverType;
  }

  /**
   * Get the total number of indexed documents
   * @returns The number of indexed documents
   */
  public getDocumentCount(): number {
    return this.documents.length;
  }

  /**
   * Get the current indexing status
   * @returns Status of the indexing process
   */
  public getIndexStatus(): {
    indexing: boolean;
    filesIndexed: number;
    totalFiles: number;
    currentFile?: string;
    lastUpdate: number;
    error?: string;
  } {
    return { ...this.indexingStatus };
  }

  /**
   * Clean up resources when done
   */
  public dispose(): void {
    this.bm25Searcher.dispose();
    this.documents = [];
    this.indexedPaths.clear();
    this.initialized = false;
  }
}