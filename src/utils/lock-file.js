import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const LOCK_FILE_NAME = 'locallama.lock';

// Compute the lock file path at call time so that LOCALLAMA_ROOT_DIR changes
// (e.g. between tests) are always reflected without re-importing this module.
function getLockFilePath() {
  const rootDir = process.env.LOCALLAMA_ROOT_DIR || path.resolve(__dirname, '..', '..');
  return path.join(rootDir, LOCK_FILE_NAME);
}

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

    fs.writeFileSync(getLockFilePath(), JSON.stringify(lockInfo), { flag: 'wx' });
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
  return fs.existsSync(getLockFilePath());
}

/**
 * Removes the lock file when the server shuts down
 */
export function removeLockFile() {
  try {
    const lockFilePath = getLockFilePath();
    if (fs.existsSync(lockFilePath)) {
      fs.unlinkSync(lockFilePath);
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
    const lockFilePath = getLockFilePath();
    if (fs.existsSync(lockFilePath)) {
      const lockFileContent = fs.readFileSync(lockFilePath, 'utf8');
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

    // signal(0) checks process existence without sending a real signal.
    // Node.js supports this on all platforms including Windows (uses OpenProcess internally).
    try {
      process.kill(lockInfo.pid, 0);
      return true;
    } catch (error) {
      return false;
    }
  } catch (error) {
    console.error('Error checking if lock file process is running:', error);
    return false;
  }
}
