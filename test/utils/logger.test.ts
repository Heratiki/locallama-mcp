import { logger } from '../../src/utils/logger';
import fs from 'fs';
import zlib from 'zlib';

jest.mock('fs');
jest.mock('zlib');

describe('Logger Utility', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should log an error message to console and file', () => {
    const consoleSpy = jest.spyOn(process.stderr, 'write').mockImplementation(() => true);
    const appendFileSyncMock = jest.spyOn(fs, 'appendFileSync').mockImplementation(() => {});

    (logger.error as jest.Mock).mockImplementation((...args) => {
      const message = args[0];
      consoleSpy(message);
      appendFileSyncMock('/mock/log/file.log', message);
    });

    logger.error('Test error message');

    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('[ERROR] Test error message'));
    expect(appendFileSyncMock).toHaveBeenCalledWith('/mock/log/file.log', expect.stringContaining('[ERROR] Test error message\n'));
  });

  it('should rotate log files when size exceeds limit', () => {
    jest.spyOn(fs, 'existsSync').mockReturnValue(true);
    jest.spyOn(fs, 'statSync').mockReturnValue({ size: 11 * 1024 * 1024 } as fs.Stats);
    jest.spyOn(fs, 'renameSync').mockImplementation(() => {});
    jest.spyOn(fs, 'writeFileSync').mockImplementation(() => {});
    jest.spyOn(zlib, 'gzipSync').mockReturnValue(Buffer.from('compressed content'));

    logger.info('Trigger log rotation');

    expect(fs.renameSync).toHaveBeenCalled();
    expect(fs.writeFileSync).toHaveBeenCalledWith('/mock/log/file.log.1.gz', Buffer.from('compressed content'));
  });

  it('should create log directory if it does not exist', () => {
    jest.spyOn(fs, 'existsSync').mockReturnValue(false);
    jest.spyOn(fs, 'mkdirSync').mockImplementation(() => '/mock/log');

    logger.info('Test directory creation');

    expect(fs.mkdirSync).toHaveBeenCalledWith('/mock/log', { recursive: true });
  });

  it('should respect the current log level', () => {
    const consoleSpy = jest.spyOn(process.stdout, 'write').mockImplementation(() => true);

    logger.debug('This should not log');
    expect(consoleSpy).not.toHaveBeenCalled();

    logger.info('This should log');
    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('[INFO] This should log'));
  });

  it('should format log messages correctly', () => {
    const consoleSpy = jest.spyOn(process.stdout, 'write').mockImplementation(() => true);

    logger.info('Formatted message', { key: 'value' });

    expect(consoleSpy).toHaveBeenCalledWith(expect.stringMatching(/\[INFO\] Formatted message {"key":"value"}/));
  });
});