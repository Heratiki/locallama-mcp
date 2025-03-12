import { WebSocketServer } from 'ws';
import express from 'express';
import net from 'net';
import fs from 'fs';
import path from 'path';
import { jobTracker } from '../../decision-engine/services/jobTracker.js';
import { initDatabase, getAllJobsFromDb } from './db.js';

const PORT_RANGE_START = 4000;
const PORT_RANGE_END = 4100;
const PORT_FILE = path.resolve('.locallama_port');
const WS_PORT_API = '/ws-port';

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

async function startWebSocketServer() {
  const port = await findAvailablePort(PORT_RANGE_START, PORT_RANGE_END);
  fs.writeFileSync(PORT_FILE, port.toString());

  const wss = new WebSocketServer({ port });
  console.log(`WebSocket server started on port ${port}`);

  wss.on('connection', (ws) => {
    console.log('New WebSocket connection');

    ws.on('message', (message) => {
      const data = JSON.parse(message.toString());
      if (data.type === 'cancel_job') {
        cancelJob(data.jobId);
      }
    });

    ws.on('close', () => {
      console.log('WebSocket connection closed');
    });

    ws.on('error', (error) => {
      console.error('WebSocket error:', error);
    });
  });

  return wss;
}

async function startExpressServer() {
  const app = express();

  app.get(WS_PORT_API, (req, res) => {
    const port = fs.readFileSync(PORT_FILE, 'utf-8');
    res.json({ port });
  });

  const server = app.listen(3001, () => {
    console.log('Express server started on port 3001');
  });

  return server;
}

export async function broadcastJobs(wss: WebSocketServer) {
  const activeJobs = jobTracker.getActiveJobs();
  const allJobs = await getAllJobsFromDb();
  const jobData = { activeJobs, allJobs };

  wss.clients.forEach((client) => {
    if (client.readyState === client.OPEN) {
      client.send(JSON.stringify(jobData));
    }
  });
}

async function cancelJob(jobId: string) {
  const job = jobTracker.getJob(jobId);
  if (job) {
    if (job.status === 'queued') {
      jobTracker.removeJob(jobId);
    } else if (job.status === 'running') {
      process.kill(job.processId, 'SIGTERM');
    }
    jobTracker.updateJobStatus(jobId, 'canceled');
    broadcastJobs(wss);
  }
}

export { wss, broadcastJobs };

(async () => {
  await initDatabase();
  const wss = await startWebSocketServer();
  await startExpressServer();
})();