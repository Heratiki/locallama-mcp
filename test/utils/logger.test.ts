import { describe, expect, it, jest, beforeEach } from '@jest/globals';
import { logger } from '../../dist/utils/logger.js'; // Changed path and extension
// import { config } from '../../dist/config/index.js'; // Changed path and extension

// Mock dependencies
jest.mock('../../dist/config/index.js', () => ({ // Changed path and extension
  config: {
    logLevel: 'info',
    logToFile: true, // Enable file logging for testing
    logFilePath: '/mock/log/file.log' // Use a mock path
  }
}));

// Mock the logger module itself to prevent actual logging during tests
jest.mock('../../dist/utils/logger.js', () => ({ // Changed path and extension
  logger: {
    error: jest.fn(),
    warn: jest.fn(),
    info: jest.fn(),
    debug: jest.fn()
  }
}));

// Mock fs and zlib for file operations
// Ensure the factory returns an object with jest.fn() for each method
jest.mock('node:fs', () => ({
  existsSync: jest.fn(),
  statSync: jest.fn(),
  renameSync: jest.fn(),
  writeFileSync: jest.fn(),
  appendFileSync: jest.fn(),
  mkdirSync: jest.fn(),
}));
jest.mock('node:zlib', () => ({ // Also mock zlib explicitly if needed
  gzipSync: jest.fn(),
}));

// Import after mocks
import * as fs from 'node:fs';
import * as zlib from 'node:zlib';

describe('Logger Utility', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Access the mocked functions via the imported fs object
    (fs.existsSync as jest.Mock).mockReturnValue(true); 
    (fs.statSync as jest.Mock).mockReturnValue({ size: 1024 }); 
    (fs.renameSync as jest.Mock).mockClear();
    (fs.writeFileSync as jest.Mock).mockClear();
    (fs.appendFileSync as jest.Mock).mockClear();
    (fs.mkdirSync as jest.Mock).mockClear();
    (zlib.gzipSync as jest.Mock).mockClear();
  });

  it('should log an error message to console and file', () => {
    const consoleSpy = jest.spyOn(process.stderr, 'write').mockImplementation(() => true);
    // No need to spy on appendFileSync, just check if the mock was called

    logger.error('Test error message');

    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('[ERROR] Test error message\n'));
    expect(fs.appendFileSync).toHaveBeenCalledWith('/mock/log/file.log', expect.stringContaining('[ERROR] Test error message\n'));
  });

  it('should rotate log files when size exceeds limit', () => {
    // Set specific mock return values for this test
    (fs.existsSync as jest.Mock).mockReturnValue(true);
    (fs.statSync as jest.Mock).mockReturnValue({ size: 11 * 1024 * 1024 }); // Cast might not be needed if TS infers from mock
    (zlib.gzipSync as jest.Mock).mockReturnValue(Buffer.from('compressed content'));

    logger.info('Trigger log rotation'); // Assuming logger uses the mocked fs internally

    expect(fs.renameSync).toHaveBeenCalled();
    expect(fs.writeFileSync).toHaveBeenCalledWith('/mock/log/file.log.1.gz', Buffer.from('compressed content'));
  });

  it('should create log directory if it does not exist', () => {
    // Set specific mock return values for this test
    (fs.existsSync as jest.Mock).mockReturnValue(false);

    logger.info('Test directory creation');

    expect(fs.mkdirSync).toHaveBeenCalledWith('/mock/log', { recursive: true });
  });

  it('should respect the current log level', () => {
    const consoleSpy = jest.spyOn(process.stdout, 'write').mockImplementation(() => true);

    logger.debug('This should not log');
    expect(consoleSpy).not.toHaveBeenCalled();

    logger.info('This should log');
    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('[INFO] This should log\n'));
  });

  it('should format log messages correctly', () => {
    const consoleSpy = jest.spyOn(process.stdout, 'write').mockImplementation(() => true);

    logger.info('Formatted message', { key: 'value' });

    expect(consoleSpy).toHaveBeenCalledWith(expect.stringMatching(/\[INFO\] Formatted message {"key":"value"}\n/));
  });
});