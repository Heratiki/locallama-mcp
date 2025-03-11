import { BM25Searcher } from '../../../src/modules/cost-monitor/bm25.js';
import { logger } from '../../../src/utils/logger.js';
import { spawn } from 'child_process';

// Mock dependencies
jest.mock('../../../src/utils/logger');
jest.mock('child_process');

describe('BM25 Searcher', () => {
  let searcher: BM25Searcher;
  let mockPythonProcess: any;

  beforeEach(() => {
    jest.clearAllMocks();
    
    // Setup mock Python process
    mockPythonProcess = {
      stdout: { on: jest.fn() },
      stderr: { on: jest.fn() },
      stdin: { write: jest.fn(), end: jest.fn() },
      on: jest.fn(),
    };
    (spawn as jest.Mock).mockReturnValue(mockPythonProcess);
    
    searcher = new BM25Searcher();
  });

  afterEach(() => {
    searcher.dispose();
  });

  describe('initialization', () => {
    test('initializes Python process successfully', async () => {
      // Mock successful initialization
      mockPythonProcess.stdout.on.mockImplementation((event, callback) => {
        if (event === 'data') {
          callback(Buffer.from('RETRIV_READY'));
        }
      });

      await searcher.initialize();
      expect(spawn).toHaveBeenCalledWith('python', expect.arrayContaining(['retriv_bridge.py']));
      expect(searcher['initialized']).toBe(true);
    });

    test('handles Python process startup errors', async () => {
      // Mock process error
      mockPythonProcess.on.mockImplementation((event, callback) => {
        if (event === 'error') {
          callback(new Error('Failed to start Python process'));
        }
      });

      await expect(searcher.initialize()).rejects.toThrow('Failed to start Python process');
      expect(searcher['initialized']).toBe(false);
    });

    test('handles Python script errors', async () => {
      // Mock stderr output
      mockPythonProcess.stderr.on.mockImplementation((event, callback) => {
        if (event === 'data') {
          callback(Buffer.from('ImportError: No module named retriv'));
        }
      });

      await expect(searcher.initialize()).rejects.toThrow('ImportError: No module named retriv');
      expect(searcher['initialized']).toBe(false);
    });

    test('handles abnormal process exit', async () => {
      // Mock process exit with error
      mockPythonProcess.on.mockImplementation((event, callback) => {
        if (event === 'exit') {
          callback(1);
        }
      });

      await expect(searcher.initialize()).rejects.toThrow('Python process exited with code 1');
      expect(searcher['initialized']).toBe(false);
    });
  });

  describe('document indexing', () => {
    beforeEach(async () => {
      // Mock successful initialization
      mockPythonProcess.stdout.on.mockImplementation((event, callback) => {
        if (event === 'data') {
          callback(Buffer.from('RETRIV_READY'));
        }
      });
      await searcher.initialize();
    });

    test('indexes documents successfully', async () => {
      const documents = [
        'test document 1',
        'test document 2'
      ];

      mockPythonProcess.stdout.on.mockImplementation((event, callback) => {
        if (event === 'data') {
          callback(Buffer.from(JSON.stringify({ success: true, count: 2 })));
        }
      });

      await searcher.indexDocuments(documents);
      expect(mockPythonProcess.stdin.write).toHaveBeenCalledWith(
        expect.stringContaining('"command": "index"')
      );
    });

    test('handles indexing errors', async () => {
      mockPythonProcess.stdout.on.mockImplementation((event, callback) => {
        if (event === 'data') {
          callback(Buffer.from(JSON.stringify({ success: false, error: 'Indexing failed' })));
        }
      });

      await expect(searcher.indexDocuments([])).rejects.toThrow('Indexing failed');
    });
  });

  describe('searching', () => {
    beforeEach(async () => {
      mockPythonProcess.stdout.on.mockImplementation((event, callback) => {
        if (event === 'data') {
          callback(Buffer.from('RETRIV_READY'));
        }
      });
      await searcher.initialize();
    });

    test('performs search successfully', async () => {
      const mockResults = [
        { id: '1', score: 0.8, content: 'test document 1' },
        { id: '2', score: 0.5, content: 'test document 2' }
      ];

      mockPythonProcess.stdout.on.mockImplementation((event, callback) => {
        if (event === 'data') {
          callback(Buffer.from(JSON.stringify({ success: true, results: mockResults })));
        }
      });

      const results = await searcher.search('test query', 2);
      expect(results).toEqual(mockResults);
      expect(mockPythonProcess.stdin.write).toHaveBeenCalledWith(
        expect.stringContaining('"command": "search"')
      );
    });

    test('handles search errors', async () => {
      mockPythonProcess.stdout.on.mockImplementation((event, callback) => {
        if (event === 'data') {
          callback(Buffer.from(JSON.stringify({ success: false, error: 'Search failed' })));
        }
      });

      await expect(searcher.search('test query')).rejects.toThrow('Search failed');
    });

    test('applies search with topK parameter', async () => {
      const topK = 5;

      mockPythonProcess.stdout.on.mockImplementation((event, callback) => {
        if (event === 'data') {
          callback(Buffer.from(JSON.stringify({ success: true, results: [] })));
        }
      });

      await searcher.search('test query', topK);
      expect(mockPythonProcess.stdin.write).toHaveBeenCalledWith(
        expect.stringContaining('"topK":')
      );
      // Verify topK was passed
      const call = mockPythonProcess.stdin.write.mock.calls[0][0];
      const parsed = JSON.parse(call);
      expect(parsed.topK).toEqual(topK);
    });
  });

  describe('resource cleanup', () => {
    test('disposes resources properly', async () => {
      mockPythonProcess.stdout.on.mockImplementation((event, callback) => {
        if (event === 'data') {
          callback(Buffer.from('RETRIV_READY'));
        }
      });
      await searcher.initialize();

      searcher.dispose();
      expect(mockPythonProcess.stdin.end).toHaveBeenCalled();
      expect(searcher['pythonProcess']).toBeNull();
      expect(searcher['initialized']).toBe(false);
      expect(searcher['initPromise']).toBeNull();
    });

    test('handles multiple dispose calls safely', () => {
      searcher.dispose();
      searcher.dispose();
      expect(mockPythonProcess.stdin.end).toHaveBeenCalledTimes(1);
    });
  });
});