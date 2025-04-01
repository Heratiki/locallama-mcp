import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const LOCK_FILE_NAME = 'locallama.lock';
const LOCK_FILE_PATH = path.join(__dirname, '..', '..', LOCK_FILE_NAME);

/**
 * Creates a lock file to prevent multiple instances of the server from running
 * Stores process ID and start time for debugging purposes
 * @param {Object} additionalInfo Optional additional information to store in the lock file
 * @param {number} additionalInfo.port The port the server is running on
 * @param {string} additionalInfo.connectionInfo Additional connection information
 */
export function createLockFile(additionalInfo = {}) {
  try {
    const lockInfo = {
      pid: process.pid,
      startTime: new Date().toISOString(),
      ...additionalInfo
    };
    
    fs.writeFileSync(LOCK_FILE_PATH, JSON.stringify(lockInfo), { flag: 'wx' });
  } catch (error) {
    if (error.code === 'EEXIST') {
      console.log('Lock file already exists.');
    } else {
      console.error('Error creating lock file:', error);
    }
    process.exit(1);
  }
}

/**
 * Checks if a lock file exists, indicating another instance is running
 * @returns {boolean} True if a lock file exists
 */
export function isLockFilePresent() {
  return fs.existsSync(LOCK_FILE_PATH);
}

/**
 * Removes the lock file when the server shuts down
 */
export function removeLockFile() {
  try {
    if (fs.existsSync(LOCK_FILE_PATH)) {
      fs.unlinkSync(LOCK_FILE_PATH);
      console.log('Lock file removed.');
    }
  } catch (error) {
    console.error('Error removing lock file:', error);
  }
}

/**
 * Retrieves information about the running instance from the lock file
 * @returns {Object|null} Object containing pid and startTime, or null if lock file doesn't exist or is invalid
 */
export function getLockFileInfo() {
  try {
    if (fs.existsSync(LOCK_FILE_PATH)) {
      const lockFileContent = fs.readFileSync(LOCK_FILE_PATH, 'utf8');
      try {
        return JSON.parse(lockFileContent);
      } catch (parseError) {
        // Handle legacy lock files that might only contain the PID
        const pid = parseInt(lockFileContent.trim(), 10);
        if (!isNaN(pid)) {
          return {
            pid,
            startTime: 'Unknown (legacy lock file)',
          };
        }
        console.error('Invalid lock file format:', parseError);
        return null;
      }
    }
    return null;
  } catch (error) {
    console.error('Error reading lock file:', error);
    return null;
  }
}

/**
 * Verifies if the process in the lock file is still running
 * @returns {boolean} True if process is still running, false otherwise
 */
export function isLockFileProcessRunning() {
  try {
    const lockInfo = getLockFileInfo();
    if (!lockInfo || !lockInfo.pid) {
      return false;
    }
    
    // Different ways to check if a process is running depending on platform
    if (process.platform === 'win32') {
      try {
        // On Windows, we can use tasklist and search for the PID
        const { execSync } = require('child_process');
        execSync(`tasklist /FI "PID eq ${lockInfo.pid}" /NH`);
        return true;
      } catch (error) {
        return false; // Process not found
      }
    } else {
      // On Unix-like systems (Linux, macOS), we can just try to send signal 0
      // which doesn't actually send a signal but checks if the process exists
      try {
        process.kill(lockInfo.pid, 0);
        return true;
      } catch (error) {
        return false; // Process not running
      }
    }
  } catch (error) {
    console.error('Error checking if lock file process is running:', error);
    return false;
  }
}
