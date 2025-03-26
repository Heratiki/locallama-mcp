/**
 * Lock file interface representing the structure of the data stored in the lock file
 */
export interface LockFileInfo {
  pid: number;
  startTime: string;
}

/**
 * Creates a lock file to prevent multiple instances of the server from running
 * Stores process ID and start time for debugging purposes
 */
export function createLockFile(): void;

/**
 * Checks if a lock file exists, indicating another instance is running
 * @returns True if a lock file exists
 */
export function isLockFilePresent(): boolean;

/**
 * Removes the lock file when the server shuts down
 */
export function removeLockFile(): void;

/**
 * Retrieves information about the running instance from the lock file
 * @returns Object containing pid and startTime, or null if lock file doesn't exist or is invalid
 */
export function getLockFileInfo(): LockFileInfo | null;