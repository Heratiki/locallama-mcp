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
 */
export function createLockFile() {
  try {
    const lockInfo = {
      pid: process.pid,
      startTime: new Date().toISOString(),
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
