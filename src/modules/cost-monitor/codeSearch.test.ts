/**
 * codeSearch.test.ts
 * Example script demonstrating how to use the CodeSearchEngine with retriv
 */

import path from 'path';
import { CodeSearchEngine } from './codeSearch';
import { logger } from '../../utils/logger';

/**
 * Main function to demonstrate using the code search engine
 */
async function demonstrateCodeSearch() {
  logger.info('Starting code search demonstration');

  try {
    // Create a code search engine for the current project
    const workspaceRoot = path.resolve(process.cwd());
    logger.info(`Using workspace root: ${workspaceRoot}`);

    // Initialize the code search engine with custom exclude patterns
    const searchEngine = new CodeSearchEngine(workspaceRoot, {
      excludePatterns: [
        'node_modules/**',
        '.git/**',
        'dist/**',
        'build/**',
        '.venv/**',
        '**/*.min.js',
        '**/*.bundle.js',
        '**/package-lock.json',
        '**/yarn.lock'
      ]
    });

    // Initialize the engine
    logger.info('Initializing code search engine...');
    await searchEngine.initialize();

    // Index all code files in the workspace
    logger.info('Indexing workspace files...');
    await searchEngine.indexWorkspace(true); // Force reindexing

    const documentCount = searchEngine.getDocumentCount();
    logger.info(`Indexed ${documentCount} code documents`);

    // Define some example search queries
    const queries = [
      'retrieve code snippets using BM25',
      'token management for LLM prompts',
      'optimize code context for model',
      'API usage statistics and monitoring',
      'index TypeScript files in a directory'
    ];

    // Search for each query
    for (const query of queries) {
      logger.info(`\nSearching for: "${query}"`);
      const results = await searchEngine.search(query, 3); // Get top 3 results

      if (results.length === 0) {
        logger.info('No results found');
        continue;
      }

      // Display the search results
      logger.info(`Found ${results.length} results:`);
      results.forEach((result, index) => {
        const previewLength = Math.min(150, result.content.length);
        const preview = result.content
          .substring(0, previewLength)
          .replace(/\n/g, ' ')
          .trim() + (previewLength < result.content.length ? '...' : '');

        logger.info(`#${index + 1}: ${result.relativePath} (score: ${result.score.toFixed(4)})`);
        logger.info(`Language: ${result.language}`);
        logger.info(`Preview: ${preview}`);
      });
    }

    // Clean up resources
    searchEngine.dispose();
    logger.info('Demonstration completed');

  } catch (error) {
    logger.error('Error in code search demonstration:', error);
  }
}

// Run the demonstration if this script is executed directly
if (require.main === module) {
  demonstrateCodeSearch()
    .catch(err => {
      logger.error('Failed to run demonstration:', err);
      process.exit(1);
    });
}

export { demonstrateCodeSearch };