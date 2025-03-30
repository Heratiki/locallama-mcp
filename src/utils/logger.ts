import { config } from '../config/index.js';
import fs from 'fs';
import path from 'path';
import zlib from 'zlib';

// Constants for log rotation
const MAX_LOG_SIZE_BYTES = 10 * 1024 * 1024; // 10MB
const MAX_LOG_FILES = 5;

export interface Logger {
  error: (...args: unknown[]) => void;
  warn: (...args: unknown[]) => void;
  info: (...args: unknown[]) => void;
  debug: (...args: unknown[]) => void;
}

/**
 * Log levels
 */
export enum LogLevel {
  ERROR = 0,
  WARN = 1,
  INFO = 2,
  DEBUG = 3,
}

/**
 * Convert string log level to enum
 */
function getLogLevelFromString(level: string): LogLevel {
  switch (level.toLowerCase()) {
    case 'error':
      return LogLevel.ERROR;
    case 'warn':
      return LogLevel.WARN;
    case 'info':
      return LogLevel.INFO;
    case 'debug':
      return LogLevel.DEBUG;
    default:
      return LogLevel.INFO;
  }
}

/**
 * Ensure log directory exists
 */
function ensureLogDirectory(logFile: string): void {
  const logDir = path.dirname(logFile);
  if (!fs.existsSync(logDir)) {
    fs.mkdirSync(logDir, { recursive: true });
  }
}

/**
 * Rotate log files if needed
 */
function rotateLogFiles(logFile: string): void {
  try {
    if (!fs.existsSync(logFile)) return;

    const stats = fs.statSync(logFile);
    if (stats.size < MAX_LOG_SIZE_BYTES) return;

    // Rotate existing backup files
    for (let i = MAX_LOG_FILES - 1; i >= 1; i--) {
      const oldFile = `${logFile}.${i}.gz`;
      const newFile = `${logFile}.${i + 1}.gz`;
      if (fs.existsSync(oldFile)) {
        fs.renameSync(oldFile, newFile);
      }
    }

    // Compress current log file
    const currentContent = fs.readFileSync(logFile);
    const compressed = zlib.gzipSync(currentContent);
    fs.writeFileSync(`${logFile}.1.gz`, compressed);

    // Clear current log file
    fs.writeFileSync(logFile, '');

    // Remove oldest log file if it exists
    const oldestLog = `${logFile}.${MAX_LOG_FILES}.gz`;
    if (fs.existsSync(oldestLog)) {
      fs.unlinkSync(oldestLog);
    }
  } catch (error) {
    process.stderr.write(`Error rotating log files: ${String(error)}\n`);
  }
}

/**
 * Write message to log file if configured
 */
function writeToLogFile(message: string): void {
  if (config.logFile) {
    try {
      ensureLogDirectory(config.logFile);
      rotateLogFiles(config.logFile);
      fs.appendFileSync(config.logFile, message + '\n');
    } catch (error) {
      process.stderr.write(`Error writing to log file: ${String(error)}\n`);
    }
  }
}

/**
 * Current log level from configuration
 */
const currentLogLevel = getLogLevelFromString(config.logLevel);

/**
 * Type for log arguments - using unknown is safer than any
 */
export type LogArgs = unknown[];

/**
 * Format log message with timestamp
 */
function formatLogMessage(level: string, message: string, args: LogArgs): string {
  const timestamp = new Date().toISOString();
  return `${timestamp} [${level}] ${message} ${args.length ? JSON.stringify(args) : ''}`;
}

/**
 * Write message to console
 */
function writeToConsole(level: string, message: string): void {
  const output = level === 'ERROR' ? process.stderr : process.stdout;
  output.write(message + '\n');
}

/**
 * Enhanced logger utility with file logging support
 */
export const logger: Logger = {
  error(...args: LogArgs): void {
    const message = formatLogMessage('ERROR', args[0] as string, args.slice(1));
    writeToConsole('ERROR', message);
    writeToLogFile(message);
  },

  warn(...args: LogArgs): void {
    if (currentLogLevel >= LogLevel.WARN) {
      const message = formatLogMessage('WARN', args[0] as string, args.slice(1));
      writeToConsole('WARN', message);
      writeToLogFile(message);
    }
  },

  info(...args: LogArgs): void {
    if (currentLogLevel >= LogLevel.INFO) {
      const message = formatLogMessage('INFO', args[0] as string, args.slice(1));
      writeToConsole('INFO', message);
      writeToLogFile(message);
    }
  },

  debug(...args: LogArgs): void {
    if (currentLogLevel >= LogLevel.DEBUG) {
      const message = formatLogMessage('DEBUG', args[0] as string, args.slice(1));
      writeToConsole('DEBUG', message);
      writeToLogFile(message);
    }
  }
};