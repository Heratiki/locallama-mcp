import { CodeSearchEngine } from '../../../src/modules/cost-monitor/codeSearch.js';
import { logger } from '../../../src/utils/logger.js';
import path from 'path';
import fs from 'fs';

// Mock dependencies
jest.mock('../../../src/utils/logger');
jest.mock('fs');

describe('CodeSearchEngine', () => {
  let searchEngine: CodeSearchEngine;
  const workspaceRoot = '/test/workspace';

  beforeEach(() => {
    jest.resetAllMocks();
    searchEngine = new CodeSearchEngine(workspaceRoot);
  });

  afterEach(() => {
    searchEngine.dispose();
  });

  describe('initialization', () => {
    test('creates instance with default exclude patterns', () => {
      expect(searchEngine).toBeDefined();
      // Access private field using type assertion
      expect((searchEngine as any).workspaceRoot).toBe(workspaceRoot);
      // Access private field using type assertion
      expect((searchEngine as any).excludePatterns).toContain('node_modules/**');
    });

    test('creates instance with custom exclude patterns', () => {
      const customPatterns = ['test/**', 'dist/**'];
      const engine = new CodeSearchEngine(workspaceRoot, { excludePatterns: customPatterns });
      // Access private field using type assertion
      expect((engine as any).excludePatterns).toContain('test/**');
      // Access private field using type assertion
      expect((engine as any).excludePatterns).toContain('dist/**');
    });

    test('initializes search engine successfully', async () => {
      await expect(searchEngine.initialize()).resolves.not.toThrow();
      // Access private field using type assertion
      expect((searchEngine as any).initialized).toBe(true);
    });
  });

  describe('indexing', () => {
    beforeEach(async () => {
      await searchEngine.initialize();
    });

    test('indexes workspace with default settings', async () => {
      // Mock file system
      (fs.statSync as jest.Mock).mockReturnValue({ mtimeMs: Date.now() });
      
      await searchEngine.indexWorkspace();
      
      // Access private field using type assertion
      expect((searchEngine as any).indexingStatus.indexing).toBe(false);
      // Access private field using type assertion
      expect((searchEngine as any).indexingStatus.error).toBeUndefined();
    });

    test('handles indexing errors gracefully', async () => {
      // Mock file system error
      (fs.statSync as jest.Mock).mockImplementation(() => {
        throw new Error('File system error');
      });

      await expect(searchEngine.indexWorkspace()).rejects.toThrow();
      
      // Access private field using type assertion
      expect((searchEngine as any).indexingStatus.indexing).toBe(false);
      // Access private field using type assertion
      expect((searchEngine as any).indexingStatus.error).toBeDefined();
    });

    test('skips already indexed files', async () => {
      // Mock file system
      (fs.statSync as jest.Mock).mockReturnValue({ mtimeMs: Date.now() });
      
      // Index once
      await searchEngine.indexWorkspace();
      
      // Index again
      await searchEngine.indexWorkspace();
      
      // Access private field using type assertion
      expect((searchEngine as any).indexingStatus.filesIndexed).toBe(0);
    });
  });

  describe('searching', () => {
    beforeEach(async () => {
      await searchEngine.initialize();
      await searchEngine.indexWorkspace();
    });

    test('performs search with default parameters', async () => {
      const results = await searchEngine.search('test query');
      expect(Array.isArray(results)).toBe(true);
    });

    test('limits search results by topK parameter', async () => {
      const topK = 3;
      const results = await searchEngine.search('test query', topK);
      expect(results.length).toBeLessThanOrEqual(topK);
    });

    test('includes required result properties', async () => {
      const results = await searchEngine.search('test query');
      if (results.length > 0) {
        expect(results[0]).toHaveProperty('content');
        expect(results[0]).toHaveProperty('path');
        expect(results[0]).toHaveProperty('score');
        expect(results[0]).toHaveProperty('language');
      }
    });
  });

  describe('utilities', () => {
    test('gets document count', async () => {
      await searchEngine.initialize();
      await searchEngine.indexWorkspace();
      expect(typeof searchEngine.getDocumentCount()).toBe('number');
    });

    test('gets indexing status', async () => {
      const status = searchEngine.getIndexStatus();
      expect(status).toHaveProperty('indexing');
      expect(status).toHaveProperty('filesIndexed');
      expect(status).toHaveProperty('totalFiles');
      expect(status).toHaveProperty('currentFile');
      expect(status).toHaveProperty('lastUpdate');
    });

    test('disposes resources properly', () => {
      searchEngine.dispose();
      // Access private field using type assertion
      expect((searchEngine as any).initialized).toBe(false);
    });
  });
});