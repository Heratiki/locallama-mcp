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
jest.mock('node:fs', () => ({
  existsSync: jest.fn(),
  statSync: jest.fn(),
  renameSync: jest.fn(),
  writeFileSync: jest.fn(),
  appendFileSync: jest.fn(),
  mkdirSync: jest.fn(),
}));
jest.mock('node:zlib');

// Import after mocks
import * as fs from 'node:fs';
import * as zlib from 'node:zlib';

describe('Logger Utility', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Reset mock implementations for fs methods if needed for specific tests
    (fs.existsSync as jest.Mock).mockReturnValue(true); // Default to exists
    (fs.statSync as jest.Mock).mockReturnValue({ size: 1024 }); // Default size
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
    (fs.statSync as jest.Mock).mockReturnValue({ size: 11 * 1024 * 1024 } as fs.Stats);
    (zlib.gzipSync as jest.Mock).mockReturnValue(Buffer.from('compressed content'));

    logger.info('Trigger log rotation');

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