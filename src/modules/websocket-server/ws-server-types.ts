// Type definitions for the WebSocket server to break circular dependencies
import { WebSocketServer } from 'ws';

// Define the signature for the broadcastJobs function to avoid circular imports
export type BroadcastJobsFunction = (wss: WebSocketServer) => Promise<void>;