import { config } from '../config/index.js';

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
 * Current log level from configuration
 */
const currentLogLevel = getLogLevelFromString(config.logLevel);

/**
 * Simple logger utility
 */
export const logger = {
  error: (message: string, ...args: any[]) => {
    if (currentLogLevel >= LogLevel.ERROR) {
      console.error(`[ERROR] ${message}`, ...args);
    }
  },
  
  warn: (message: string, ...args: any[]) => {
    if (currentLogLevel >= LogLevel.WARN) {
      console.warn(`[WARN] ${message}`, ...args);
    }
  },
  
  info: (message: string, ...args: any[]) => {
    if (currentLogLevel >= LogLevel.INFO) {
      console.info(`[INFO] ${message}`, ...args);
    }
  },
  
  debug: (message: string, ...args: any[]) => {
    if (currentLogLevel >= LogLevel.DEBUG) {
      console.debug(`[DEBUG] ${message}`, ...args);
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