import { logger } from '../../src/utils/logger';
import fs from 'fs';
import zlib from 'zlib';

// Mock external dependencies
jest.mock('fs');
jest.mock('zlib');
jest.mock('../../src/config/index.js', () => ({
  config: {
    logFile: '/mock/log/file.log',
    logLevel: 'info'
  }
}));

// Mock the logger module
jest.mock('../../src/utils/logger', () => ({
  logger: {
    error: jest.fn(),
    warn: jest.fn(),
    info: jest.fn(),
    debug: jest.fn()
  }
}));

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