import type { IJobManager } from '../api-integration/types.js';
import { WebSocketServer, WebSocket } from 'ws';
import express from 'express';
import net from 'net';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { initDatabase, getAllJobsFromDb } from './db.js';
import { logger } from '../../utils/logger.js';
import { benchmarkModule } from '../benchmark/index.js';
import { config } from '../../config/index.js';

// Map internal job status to API job status
const mapStatus = (status: string): 'pending' | 'in_progress' | 'completed' | 'failed' | 'cancelled' => {
  const statusMap: Record<string, 'pending' | 'in_progress' | 'completed' | 'failed' | 'cancelled'> = {
    'Queued': 'pending',
    'In Progress': 'in_progress',
    'Completed': 'completed',
    'Failed': 'failed',
    'Cancelled': 'cancelled'
  };
  return statusMap[status] || 'failed';
};

// Will be initialized later to avoid circular dependency
let jobTracker: IJobManager;

const PORT_RANGE_START = 4000;
const PORT_RANGE_END = 4100;
const PORT_FILE = path.resolve('.locallama_port');
const WS_PORT_API = '/ws-port';

// Function to initialize the job tracker
export function initJobTracker(tracker: unknown): void {
  jobTracker = tracker as IJobManager;
}

async function findAvailablePort(start: number, end: number): Promise<number> {
  for (let port = start; port <= end; port++) {
    if (await isPortAvailable(port)) {
      return port;
    }
  }
  throw new Error(`No available ports found in range ${start}-${end}`);
}

function isPortAvailable(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once('error', () => resolve(false));
    server.once('listening', () => {
      server.close();
      resolve(true);
    });
    server.listen(port);
  });
}

// Message type definitions
interface WebSocketCancelMessage {
  type: 'cancel_job';
  jobId: string;
}

interface RpcMessage {
  jsonrpc: '2.0';
  id: number;
  method: string;
  params?: {
    command?: string;
    arguments?: Record<string, unknown>;
  };
}

async function startWebSocketServer() {
  const port = await findAvailablePort(PORT_RANGE_START, PORT_RANGE_END);
  fs.writeFileSync(PORT_FILE, port.toString());

  const wss = new WebSocketServer({ port });
  logger.info(`WebSocket server started on port ${port}`);

  wss.on('connection', (ws: WebSocket) => {
    logger.info('New WebSocket connection');

    ws.on('message', (rawMessage: Buffer | string) => {
      try {
        let messageStr = Buffer.isBuffer(rawMessage) ? rawMessage.toString('utf-8') : rawMessage.toString();
        
        // Handle array-wrapped messages from wscat
        try {
          const parsed = JSON.parse(messageStr) as unknown;
          if (Array.isArray(parsed)) {
            // If it's an array, try to use the first element
            messageStr = typeof parsed[0] === 'string' ? parsed[0] : JSON.stringify(parsed[0]);
          }
        } catch {
          // If parsing fails, keep original messageStr
        }

        const message = JSON.parse(messageStr) as unknown;
        
        if (isRpcMessage(message)) {
          void handleRpcMessage(message, ws);
        } else if (isCancelMessage(message)) {
          void cancelJob(message.jobId);
        } else {
          logger.warn('Received invalid message format:', messageStr);
        }
      } catch (error) {
        logger.error('Error processing WebSocket message:', error);
      }
    });

    ws.on('close', () => {
      logger.info('WebSocket connection closed');
    });

    ws.on('error', (error) => {
      logger.error('WebSocket error:', error);
    });
  });

  return wss;
}

async function startExpressServer() {
  const app = express();
  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  const uiPath = path.resolve(__dirname, '../../../ui.html');

  // Serve the UI file at the root
  app.get('/', (req, res) => {
    res.sendFile(uiPath);
  });

  app.get(WS_PORT_API, (req, res) => {
    const port = fs.readFileSync(PORT_FILE, 'utf-8');
    res.json({ port });
  });

  return new Promise<ReturnType<typeof express.application.listen>>((resolve) => {
    const server = app.listen(3001, () => {
      logger.info('Express server started on port 3001');
      resolve(server);
    });
  });
}

export async function broadcastJobs(wss: WebSocketServer): Promise<void> {
  if (!jobTracker) {
    logger.error('JobTracker not initialized');
    return;
  }

  try {
    // If getActiveJobs exists, use it, otherwise get all jobs through getJob
    const allJobs = await getAllJobsFromDb();
    const activeJobs = allJobs.filter(job => job.status === 'pending' || job.status === 'in_progress');
    
    const jobData = {
      activeJobs,
      allJobs
    };

    const promises = Array.from(wss.clients)
      .filter(client => client.readyState === WebSocket.OPEN)
      .map(client => client.send(JSON.stringify(jobData)));
    
    await Promise.all(promises);
  } catch (error) {
    logger.error('Error broadcasting jobs:', error instanceof Error ? error.message : String(error));
  }
}

async function cancelJob(jobId: string): Promise<void> {
  if (!jobTracker) {
    logger.error('JobTracker not initialized');
    return;
  }

  try {
    const job = jobTracker.getJob(jobId);
    if (!job) {
      logger.error(`Job ${jobId} not found`);
      return;
    }

    // Convert internal status to IJobManager status
    const status = mapStatus(job.status);
    
    if (status === 'pending' || status === 'in_progress') {
      if (status === 'in_progress' && 'processId' in job && typeof job.processId === 'number') {
        try {
          process.kill(job.processId);
        } catch (killError) {
          logger.error('Error killing process:', killError);
        }
      }
      
      // Call cancelJob and wait for operation to complete
      jobTracker.cancelJob(jobId);
      await new Promise(resolve => setTimeout(resolve, 100)); // Give time for job state to update
    }

    await broadcastJobs(wss);
  } catch (error) {
    logger.error('Error canceling job:', error instanceof Error ? error.message : String(error));
  }
}

let wss: WebSocketServer;

function isRpcMessage(message: unknown): message is RpcMessage {
  return typeof message === 'object' && message !== null &&
         'jsonrpc' in message && (message as RpcMessage).jsonrpc === '2.0' &&
         'method' in message && typeof (message as RpcMessage).method === 'string';
}

function isCancelMessage(message: unknown): message is WebSocketCancelMessage {
  return typeof message === 'object' && message !== null &&
         'type' in message && (message as WebSocketCancelMessage).type === 'cancel_job' &&
         'jobId' in message && typeof (message as WebSocketCancelMessage).jobId === 'string';
}

async function handleRpcMessage(message: RpcMessage, ws: WebSocket): Promise<void> {
  try {
    if (message.method === 'executeCommand') {
      const { command, arguments: args } = message.params ?? {};
      
      // Handle benchmark command
      if (command === 'benchmark_tasks') {
        logger.info('Received benchmark command:', args);
        
        try {
          // Convert the task to benchmark params
          const task = {
            taskId: 'benchmark-test',
            task: 'Write a function to calculate fibonacci numbers',
            contextLength: 1000,
            expectedOutputLength: 500,
            complexity: 0.5
          };

          // Run the benchmark
          const result = await benchmarkModule.benchmarkTask(task, config.benchmark);
          
          // Send back the results
          ws.send(JSON.stringify({
            jsonrpc: '2.0',
            id: message.id,
            result: result
          }));
        } catch (benchmarkError) {
          logger.error('Error running benchmark:', benchmarkError);
          ws.send(JSON.stringify({
            jsonrpc: '2.0',
            id: message.id,
            error: {
              code: -32001,
              message: 'Benchmark failed',
              data: benchmarkError instanceof Error ? benchmarkError.message : String(benchmarkError)
            }
          }));
        }
      }
    }
  } catch (error) {
    logger.error('Error handling RPC message:', error);
    ws.send(JSON.stringify({
      jsonrpc: '2.0',
      id: message.id,
      error: {
        code: -32000,
        message: 'Internal error',
        data: error instanceof Error ? error.message : String(error)
      }
    }));
  }
}

(async () => {
  try {
    await initDatabase();
    wss = await startWebSocketServer();
    await startExpressServer();
  } catch (error) {
    logger.error('Error starting servers:', error);
    process.exit(1);
  }
})().catch(error => {
  logger.error('Unhandled error during startup:', error);
  process.exit(1);
});
