/**
 * Lock file interface representing the structure of the data stored in the lock file
 */
export interface LockFileInfo {
  pid: number;
  startTime: string;
  port?: number;
  connectionInfo?: string;
}

/**
 * Creates a lock file to prevent multiple instances of the server from running
 * Stores process ID and start time for debugging purposes
 * @param additionalInfo Optional additional information to store in the lock file (e.g., port, connection details)
 */
export function createLockFile(additionalInfo?: { port?: number, connectionInfo?: string }): void;

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

/**
 * Verifies if the process in the lock file is still running
 * @returns True if process is still running, false otherwise
 */
export function isLockFileProcessRunning(): boolean;