import { config } from '../config/index.js';
import fs from 'fs';
import path from 'path';

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
function ensureLogDirectory(logFile: string) {
  const logDir = path.dirname(logFile);
  if (!fs.existsSync(logDir)) {
    fs.mkdirSync(logDir, { recursive: true });
  }
}

/**
 * Write message to log file if configured
 */
function writeToLogFile(message: string) {
  if (config.logFile) {
    ensureLogDirectory(config.logFile);
    fs.appendFileSync(config.logFile, message + '\n');
  }
}

/**
 * Current log level from configuration
 */
const currentLogLevel = getLogLevelFromString(config.logLevel);

/**
 * Format log message with timestamp
 */
function formatLogMessage(level: string, message: string, args: any[]): string {
  const timestamp = new Date().toISOString();
  return `${timestamp} [${level}] ${message} ${args.length ? JSON.stringify(args) : ''}`;
}

/**
 * Enhanced logger utility with file logging support
 */
export const logger = {
  error: (message: string, ...args: any[]) => {
    if (currentLogLevel >= LogLevel.ERROR) {
      const formattedMessage = formatLogMessage('ERROR', message, args);
      console.error(formattedMessage);
      writeToLogFile(formattedMessage);
    }
  },
  
  warn: (message: string, ...args: any[]) => {
    if (currentLogLevel >= LogLevel.WARN) {
      const formattedMessage = formatLogMessage('WARN', message, args);
      console.warn(formattedMessage);
      writeToLogFile(formattedMessage);
    }
  },
  
  info: (message: string, ...args: any[]) => {
    if (currentLogLevel >= LogLevel.INFO) {
      const formattedMessage = formatLogMessage('INFO', message, args);
      console.info(formattedMessage);
      writeToLogFile(formattedMessage);
    }
  },
  
  debug: (message: string, ...args: any[]) => {
    if (currentLogLevel >= LogLevel.DEBUG) {
      const formattedMessage = formatLogMessage('DEBUG', message, args);
      console.debug(formattedMessage);
      writeToLogFile(formattedMessage);
    }
  },
  
  /**
   * Log a message with a specific log level
   */
  log: (level: LogLevel, message: string, ...args: any[]) => {
    switch (level) {
      case LogLevel.ERROR:
        logger.error(message, ...args);
        break;
      case LogLevel.WARN:
        logger.warn(message, ...args);
        break;
      case LogLevel.INFO:
        logger.info(message, ...args);
        break;
      case LogLevel.DEBUG:
        logger.debug(message, ...args);
        break;
    }
  },
};