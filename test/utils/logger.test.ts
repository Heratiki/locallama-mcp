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
jest.mock('node:fs');
jest.mock('node:zlib');

import * as fs from 'node:fs';
import * as zlib from 'node:zlib';

describe('Logger Utility', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should log an error message to console and file', () => {
    const consoleSpy = jest.spyOn(process.stderr, 'write').mockImplementation(() => true);
    const appendFileSyncMock = jest.spyOn(fs, 'appendFileSync').mockImplementation(() => {});

    logger.error('Test error message');

    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('[ERROR] Test error message\n'));
    expect(appendFileSyncMock).toHaveBeenCalledWith('/mock/log/file.log', expect.stringContaining('[ERROR] Test error message\n'));
  });

  it('should rotate log files when size exceeds limit', () => {
    jest.spyOn(fs, 'existsSync').mockReturnValue(true);
    jest.spyOn(fs, 'statSync').mockReturnValue({ size: 11 * 1024 * 1024 } as fs.Stats);
    const renameSyncMock = jest.spyOn(fs, 'renameSync').mockImplementation(() => {});
    const writeFileSyncMock = jest.spyOn(fs, 'writeFileSync').mockImplementation(() => {});
    jest.spyOn(zlib, 'gzipSync').mockReturnValue(Buffer.from('compressed content'));

    logger.info('Trigger log rotation');

    expect(renameSyncMock).toHaveBeenCalled();
    expect(writeFileSyncMock).toHaveBeenCalledWith('/mock/log/file.log.1.gz', Buffer.from('compressed content'));
  });

  it('should create log directory if it does not exist', () => {
    jest.spyOn(fs, 'existsSync').mockReturnValue(false);
    const mkdirSyncMock = jest.spyOn(fs, 'mkdirSync').mockImplementation(() => undefined);

    logger.info('Test directory creation');

    expect(mkdirSyncMock).toHaveBeenCalledWith('/mock/log', { recursive: true });
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