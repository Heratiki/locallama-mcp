import { beforeEach, describe, expect, it, jest } from '@jest/globals';

const fsMock = {
  existsSync: jest.fn(),
  statSync: jest.fn(),
  renameSync: jest.fn(),
  writeFileSync: jest.fn(),
  appendFileSync: jest.fn(),
  mkdirSync: jest.fn(),
  readFileSync: jest.fn(),
  unlinkSync: jest.fn()
};

const zlibMock = {
  gzipSync: jest.fn()
};

jest.unstable_mockModule('../../dist/config/index.js', () => ({
  config: {
    logLevel: 'info',
    logFile: '/mock/log/file.log'
  }
}));

jest.unstable_mockModule('fs', () => ({
  default: fsMock
}));

jest.unstable_mockModule('zlib', () => ({
  default: zlibMock
}));

const { logger } = await import('../../dist/utils/logger.js');

describe('Logger Utility', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    fsMock.existsSync.mockReturnValue(true);
    fsMock.statSync.mockReturnValue({ size: 1024 } as ReturnType<typeof fsMock.statSync>);
    fsMock.readFileSync.mockReturnValue(Buffer.from('test log content'));
    zlibMock.gzipSync.mockReturnValue(Buffer.from('compressed content'));
  });

  it('should log an error message to console and file', () => {
    const consoleSpy = jest.spyOn(process.stderr, 'write').mockImplementation(() => true);

    logger.error('Test error message');

    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('[ERROR] Test error message'));
    expect(fsMock.appendFileSync).toHaveBeenCalledWith('/mock/log/file.log', expect.stringContaining('[ERROR] Test error message'));
  });

  it('should rotate log files when size exceeds limit', () => {
    fsMock.statSync.mockReturnValue({ size: 11 * 1024 * 1024 } as ReturnType<typeof fsMock.statSync>);

    logger.info('Trigger log rotation');

    expect(fsMock.writeFileSync).toHaveBeenCalledWith('/mock/log/file.log.1.gz', Buffer.from('compressed content'));
  });

  it('should create log directory if it does not exist', () => {
    fsMock.existsSync.mockImplementation((filePath: string) => filePath === '/mock/log/file.log');

    logger.info('Test directory creation');

    expect(fsMock.mkdirSync).toHaveBeenCalledWith('/mock/log', { recursive: true });
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

    expect(consoleSpy).toHaveBeenCalledWith(expect.stringMatching(/\[INFO\] Formatted message \[{"key":"value"}\]/));
  });
});
