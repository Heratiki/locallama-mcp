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

// Define the BenchmarkResult interface to improve type safety
interface BenchmarkResult {
  models: Record<string, ModelBenchmarkData>;
  timestamp: string;
}

interface ModelBenchmarkData {
  successRate: number;
  qualityScore: number;
  avgResponseTime: number;
  complexityScore: number;
  benchmarkCount: number;
  lastBenchmarked?: string;
  tasks?: BenchmarkTask[];
}

interface BenchmarkTask {
  name: string;
  prompt: string;
  success: boolean;
  qualityScore: number;
  responseTime: number;
  output: string;
}

interface TaskResult {
  task: string;
  local: {
    successRate: number;
    qualityScore: number;
    timeTaken: number;
    output: string;
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
      
      if (!command) {
        logger.warn('Received command with no command string');
        return;
      }
      
      logger.info(`Received command: ${command}`);
      
      // Handle getBenchmarkedModels
      if (command === 'getBenchmarkedModels') {
        try {
          // Get all benchmark directories from the file system
          const benchmarkDir = path.resolve(process.cwd(), 'benchmark-results');
          const benchmarkFiles = await fs.promises.readdir(benchmarkDir);
          
          // Filter for model directories (ignore .json files and other non-directories)
          const modelDirs: string[] = [];
          for (const file of benchmarkFiles) {
            const fullPath = path.join(benchmarkDir, file);
            const stats = await fs.promises.stat(fullPath);
            if (stats.isDirectory()) {
              modelDirs.push(file);
            }
          }
          
          // Get model details from the comprehensive results file
          const modelDetails: Array<{id: string; name: string; provider: string; metrics: unknown}> = [];
          
          // Find the most recent comprehensive results file
          const comprFiles = benchmarkFiles.filter(file => file.startsWith('comprehensive-results-')).sort().reverse();
          if (comprFiles.length > 0) {
            const latestFile = path.join(benchmarkDir, comprFiles[0]);
            const fileContent = await fs.promises.readFile(latestFile, 'utf-8');
            const comprResults = JSON.parse(fileContent) as BenchmarkResult;
            
            // Convert to array of model objects
            if (comprResults.models) {
              Object.entries(comprResults.models).forEach(([id, data]) => {
                const modelName = id.split('/').pop() || id; // Get last part after slash or use full id
                const provider = id.includes('/') ? id.split('/')[0] : 
                                (id.includes('-') ? id.split('-')[0] : 'unknown');
                
                modelDetails.push({
                  id,
                  name: modelName,
                  provider: id.includes('lm-studio') ? 'lm-studio' : 
                           id.includes('ollama') ? 'ollama' : 
                           provider,
                  metrics: data
                });
              });
            }
          }
          
          // Send the list of models back to the client
          ws.send(JSON.stringify({
            jsonrpc: '2.0',
            id: message.id,
            result: {
              models: modelDetails
            }
          }));
        } catch (error) {
          logger.error('Error getting benchmarked models:', error);
          ws.send(JSON.stringify({
            jsonrpc: '2.0',
            id: message.id,
            error: {
              code: -32001,
              message: 'Failed to get benchmarked models',
              data: error instanceof Error ? error.message : String(error)
            }
          }));
        }
      }
      // Handle getModelBenchmarks
      else if (command.startsWith('getModelBenchmarks ')) {
        try {
          const modelId = command.substring('getModelBenchmarks '.length).trim();
          
          if (!modelId) {
            throw new Error('No model ID provided');
          }
          
          // Find the most recent comprehensive results file
          const benchmarkDir = path.resolve(process.cwd(), 'benchmark-results');
          const files = await fs.promises.readdir(benchmarkDir);
          const comprFiles = files.filter(file => file.startsWith('comprehensive-results-')).sort().reverse();
          
          if (comprFiles.length === 0) {
            throw new Error('No benchmark results found');
          }
          
          const latestFile = path.join(benchmarkDir, comprFiles[0]);
          const fileContent = await fs.promises.readFile(latestFile, 'utf-8');
          const comprResults = JSON.parse(fileContent) as BenchmarkResult;
          
          // Find the model data
          let modelData: ModelBenchmarkData | null = null;
          if (comprResults.models && comprResults.models[modelId]) {
            modelData = { ...comprResults.models[modelId] };
            
            // Format last benchmarked time
            if (!modelData.lastBenchmarked) {
              modelData.lastBenchmarked = comprResults.timestamp;
            }
            
            // Add task results from individual benchmarks if available
            // Properly sanitize the model ID for the file system - replace both slashes and colons
            const sanitizedModelId = modelId.replace(/[/\\:]/g, '-');
            const modelDir = path.join(benchmarkDir, sanitizedModelId);
            
            try {
              const taskDirs = await fs.promises.readdir(modelDir);
              const tasks: BenchmarkTask[] = [];
              
              for (const taskDir of taskDirs) {
                const taskPath = path.join(modelDir, taskDir);
                const stats = await fs.promises.stat(taskPath);
                
                if (stats.isDirectory()) {
                  // Check for result.json file
                  const resultPath = path.join(taskPath, 'result.json');
                  try {
                    const resultContent = await fs.promises.readFile(resultPath, 'utf-8');
                    const resultData = JSON.parse(resultContent) as TaskResult;
                    
                    // Extract task info
                    tasks.push({
                      name: taskDir,
                      prompt: resultData.task,
                      success: resultData.local.successRate > 0,
                      qualityScore: resultData.local.qualityScore,
                      responseTime: resultData.local.timeTaken,
                      output: resultData.local.output
                    });
                  } catch (readError) {
                    logger.warn(`Could not read result for task ${taskDir}:`, readError);
                  }
                }
              }
              
              // Add tasks to model data
              if (tasks.length > 0) {
                modelData.tasks = tasks;
              }
            } catch (dirError) {
              logger.warn(`No task results found for model ${modelId}:`, dirError);
            }
          } else {
            throw new Error(`Model ${modelId} not found in benchmark results`);
          }
          
          // Send the model benchmark data back to the client
          ws.send(JSON.stringify({
            jsonrpc: '2.0',
            id: message.id,
            result: {
              modelId,
              data: modelData
            }
          }));
        } catch (error) {
          logger.error('Error getting model benchmarks:', error);
          ws.send(JSON.stringify({
            jsonrpc: '2.0',
            id: message.id,
            error: {
              code: -32001,
              message: 'Failed to get model benchmarks',
              data: error instanceof Error ? error.message : String(error)
            }
          }));
        }
      }
      // Rest of the code remains the same...
      // Handle getActiveJobs
      else if (command === 'getActiveJobs') {
        try {
          // Get jobs from the database
          const allJobs = await getAllJobsFromDb();
          const activeJobs = allJobs.filter(job => job.status === 'pending' || job.status === 'in_progress');
          
          // Send the jobs back to the client
          ws.send(JSON.stringify({
            jsonrpc: '2.0',
            id: message.id,
            result: {
              jobs: activeJobs
            }
          }));
        } catch (error) {
          logger.error('Error getting active jobs:', error);
          ws.send(JSON.stringify({
            jsonrpc: '2.0',
            id: message.id,
            error: {
              code: -32001,
              message: 'Failed to get active jobs',
              data: error instanceof Error ? error.message : String(error)
            }
          }));
        }
      }
      // Handle rebenchmarkModel
      else if (command.startsWith('rebenchmarkModel ')) {
        try {
          const modelId = command.substring('rebenchmarkModel '.length).trim();
          
          if (!modelId) {
            throw new Error('No model ID provided');
          }
          
          // Notify client that benchmark is starting
          ws.send(JSON.stringify({
            jsonrpc: '2.0',
            id: message.id,
            result: {
              message: `Starting benchmark for model ${modelId}`,
              status: 'started'
            }
          }));
          
          // Check if this is a known model in our system
          const isLmStudioModel = modelId.includes('lm-studio') || !modelId.includes('/');
          const isOllamaModel = modelId.includes('ollama');
          
          // Create benchmark tasks
          const tasks = [
            {
              taskId: 'simple-function',
              task: 'Write a function to calculate the factorial of a number.',
              contextLength: 100,
              expectedOutputLength: 300,
              complexity: 0.2
            },
            {
              taskId: 'medium-algorithm',
              task: 'Implement a binary search algorithm and explain its time complexity.',
              contextLength: 150,
              expectedOutputLength: 500,
              complexity: 0.5
            }
          ];
          
          // Run benchmarks in background to avoid blocking
          Promise.all(tasks.map(task => {
            return benchmarkModule.benchmarkTask({
              ...task,
              localModel: isLmStudioModel || isOllamaModel ? modelId : undefined,
              paidModel: !isLmStudioModel && !isOllamaModel ? modelId : undefined
            }, config.benchmark);
          }))
          .then(() => {
            // Notify client that benchmark is complete
            ws.send(JSON.stringify({
              jsonrpc: '2.0',
              id: Date.now(), // Use new ID to avoid conflict
              result: {
                message: `Benchmark completed for model ${modelId}`,
                status: 'completed',
                modelId
              }
            }));
          })
          .catch(err => {
            logger.error(`Error in benchmark for ${modelId}:`, err);
            ws.send(JSON.stringify({
              jsonrpc: '2.0',
              id: Date.now(), // Use new ID to avoid conflict
              error: {
                code: -32001,
                message: `Benchmark failed for model ${modelId}`,
                data: err instanceof Error ? err.message : String(err)
              }
            }));
          });
          
        } catch (error) {
          logger.error('Error starting benchmark:', error);
          ws.send(JSON.stringify({
            jsonrpc: '2.0',
            id: message.id,
            error: {
              code: -32001,
              message: 'Failed to start benchmark',
              data: error instanceof Error ? error.message : String(error)
            }
          }));
        }
      }
      // Handle runAllBenchmarks
      else if (command === 'runAllBenchmarks') {
        try {
          // Notify client that benchmark is starting
          ws.send(JSON.stringify({
            jsonrpc: '2.0',
            id: message.id,
            result: {
              message: 'Starting benchmarks for all models',
              status: 'started'
            }
          }));
          
          // Run the benchmark service in the background
          // Use void to explicitly mark this as an intentionally unhandled promise
          void Promise.resolve().then(async () => {
            try {
              const benchmarkService = await import('../../modules/decision-engine/services/benchmarkService.js');
              await benchmarkService.benchmarkService.benchmarkFreeModels();
              
              // Notify client that benchmark is complete
              ws.send(JSON.stringify({
                jsonrpc: '2.0',
                id: Date.now(), // Use new ID to avoid conflict
                result: {
                  message: 'All benchmarks completed',
                  status: 'completed'
                }
              }));
            } catch (err) {
              logger.error('Error running benchmarks:', err);
              ws.send(JSON.stringify({
                jsonrpc: '2.0',
                id: Date.now(), // Use new ID to avoid conflict
                error: {
                  code: -32001,
                  message: 'Benchmark failed',
                  data: err instanceof Error ? err.message : String(err)
                }
              }));
            }
          });
        } catch (error) {
          logger.error('Error starting benchmarks:', error);
          ws.send(JSON.stringify({
            jsonrpc: '2.0',
            id: message.id,
            error: {
              code: -32001,
              message: 'Failed to start benchmarks',
              data: error instanceof Error ? error.message : String(error)
            }
          }));
        }
      }
      // Handle benchmark_tasks (for backward compatibility)
      else if (command === 'benchmark_tasks') {
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
      } else {
        logger.warn(`Unknown command: ${command}`);
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

/**
 * Main server initialization function to start both WebSocket and Express servers
 */
async function init() {
  try {
    await initDatabase();
    wss = await startWebSocketServer();
    await startExpressServer();
  } catch (error) {
    logger.error('Error starting servers:', error);
    process.exit(1);
  }
}

// Run the initialization
init().catch(error => {
  logger.error('Unhandled error during startup:', error);
  process.exit(1);
});