import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { logger } from '../../../utils/logger.js';
import { BM25Options } from '../../cost-monitor/bm25.js';
import { codeSearchEngineManager, getCodeSearchEngine } from '../../cost-monitor/codeSearchEngine.js';
import { IRetrivIntegration, RetrivInitParams, RetrivInitResult, RetrivDocument, RetrivSearchResult, RetrivIndexingResult } from './types.js';

export class RetrivIntegration implements IRetrivIntegration {
  /**
   * Check if Python is available on the system
   */
  isPythonAvailable(): boolean {
    try {
      execSync('python --version', { stdio: 'pipe' });
      return true;
    } catch {
      try {
        execSync('python3 --version', { stdio: 'pipe' });
        return true;
      } catch {
        return false;
      }
    }
  }
  
  /**
   * Check if a Python module is installed
   */
  isPythonModuleInstalled(moduleName: string): boolean {
    try {
      execSync(`python -c "import ${moduleName}"`, { stdio: 'pipe' });
      return true;
    } catch {
      return false;
    }
  }
  
  /**
   * Generate a requirements.txt file for Retriv dependencies
   */
  generateRequirementsTxt(): string {
    const requirementsPath = path.join(process.cwd(), 'retriv-requirements.txt');
    const dependencies = [
      'retriv>=0.3.1',
      'numpy>=1.22.0',
      'scikit-learn>=1.0.2',
      'scipy>=1.8.0'
    ];
    fs.writeFileSync(requirementsPath, dependencies.join('\n'));
    return requirementsPath;
  }
  
  /**
   * Initialize Retriv with the specified configuration
   */
  async initializeRetriv(params: RetrivInitParams): Promise<RetrivInitResult> {
    const startTime = Date.now();
    const indexResults = [];
    let totalFiles = 0;
    
    if (!this.isPythonAvailable()) {
      throw new Error('Python is not installed or not available in PATH. Python is required for Retriv functionality.');
    }
    
    const retrivInstalled = this.isPythonModuleInstalled('retriv');
    if (!retrivInstalled) {
      if (params.installDependencies) {
        logger.info('Installing Retriv Python package...');
        try {
          const requirementsPath = this.generateRequirementsTxt();
          execSync(`pip install -r ${requirementsPath}`, { stdio: 'inherit' });
          logger.info('Successfully installed Retriv and dependencies');
          fs.unlinkSync(requirementsPath);
        } catch (error) {
          throw new Error(`Failed to install Retriv Python package: ${error instanceof Error ? error.message : String(error)}`);
        }
      } else {
        throw new Error('The Retriv Python package is required but not installed. Set installDependencies to true or install manually.');
      }
    }
    
    // Initialize the code search engine with BM25 options
    await codeSearchEngineManager.initialize({
      excludePatterns: params.excludePatterns,
      chunkSize: params.chunkSize,
      bm25Options: (params.bm25Options || {
        k1: 1.5,
        b: 0.75
      }) as BM25Options,
    });
    
    // Index the specified directories
    for (const directory of params.directories) {
      logger.info(`Indexing directory: ${directory}`);
      try {
        const result = await codeSearchEngineManager.indexDirectory(directory, params.forceReindex || false);
        if (result && typeof result === 'object') {
          const fileCount = result.totalFiles || 0;
          totalFiles += fileCount;
          indexResults.push({
            directory,
            filesIndexed: fileCount,
            status: 'success' as const, // Fix status to use literal type
            timeTaken: result.timeTaken || 'N/A'
          });
          logger.info(`Successfully indexed ${fileCount} files in ${directory}`);
        } else {
          indexResults.push({
            directory,
            status: 'warning' as const, // Fix status to use literal type
            message: 'Directory indexed but no result details available'
          });
          logger.warn(`Directory indexed but no result details available for ${directory}`);
        }
      } catch (error) {
        indexResults.push({
          directory,
          status: 'error' as const, // Fix status to use literal type
          message: (error as Error).message
        });
        logger.error(`Error indexing directory ${directory}:`, error);
      }
    }
    
    // Get document count and additional statistics
    const documentCount = await this.getDocumentCount();
    const endTime = Date.now();
    const totalTimeTaken = ((endTime - startTime) / 1000).toFixed(2);
    
    return {
      success: indexResults.some(r => r.status === 'success'),
      summary: {
        indexedDirectories: params.directories.length,
        totalFiles,
        documentCount,
        totalTimeTaken: `${totalTimeTaken} seconds`
      },
      details: indexResults as RetrivIndexingResult[], // Properly imported now
      searchReady: documentCount > 0,
      nextSteps: documentCount > 0 
        ? 'You can now use the search method to search through indexed documents'
        : 'No documents were indexed. Please check your directories and try again.'
    };
  }
  
  /**
   * Search for documents using Retriv
   */
  async search(query: string, limit = 5): Promise<RetrivSearchResult[]> {
    try {
      const codeSearchEngine = await getCodeSearchEngine();
      const results = await codeSearchEngine.search(query, limit);
      
      // Convert to the expected format with optional properties
      return results.map(result => ({
        content: result.content,
        path: result.path,
        score: result.score,
        // Add empty arrays for highlights if they don't exist
        highlights: [], // CodeSearchResult doesn't have highlights
        // Add empty object for metadata if it doesn't exist
        metadata: {} // CodeSearchResult doesn't have metadata
      }));
    } catch (error) {
      logger.error(`Error searching with Retriv: ${(error as Error).message}`);
      throw error;
    }
  }
  
  /**
   * Index documents in Retriv
   */
  async indexDocuments(documents: RetrivDocument[]): Promise<void> {
    try {
      await codeSearchEngineManager.indexDocuments(documents);
      logger.info(`Successfully indexed ${documents.length} documents in Retriv`);
    } catch (error) {
      logger.error(`Error indexing documents in Retriv: ${(error as Error).message}`);
      throw error;
    }
  }
  
  /**
   * Get document count in Retriv's index
   */
  async getDocumentCount(): Promise<number> {
    try {
      return await codeSearchEngineManager.getDocumentCount();
    } catch (error) {
      logger.error(`Error getting document count from Retriv: ${(error as Error).message}`);
      throw error;
    }
  }
}

// Create singleton instance
const retrivIntegration = new RetrivIntegration();

// Export the singleton instance
export { retrivIntegration };

// Export individual methods for backward compatibility
export const isPythonAvailable = retrivIntegration.isPythonAvailable.bind(retrivIntegration);
export const isPythonModuleInstalled = retrivIntegration.isPythonModuleInstalled.bind(retrivIntegration);
export const generateRequirementsTxt = retrivIntegration.generateRequirementsTxt.bind(retrivIntegration);
export const initializeRetriv = retrivIntegration.initializeRetriv.bind(retrivIntegration);
export const search = retrivIntegration.search.bind(retrivIntegration);
export const indexDocuments = retrivIntegration.indexDocuments.bind(retrivIntegration);
export const getDocumentCount = retrivIntegration.getDocumentCount.bind(retrivIntegration);
