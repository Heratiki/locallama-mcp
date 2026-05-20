import { spawn, ChildProcess } from 'child_process';
import { createInterface, Interface } from 'readline';
import path from 'path';
import fs from 'fs';

/**
 * Interface for task routing parameters
 */
interface TaskRoutingParams {
  task: string;
  context_length: number;
  expected_output_length?: number;
  complexity?: number;
  priority?: 'speed' | 'cost' | 'quality';
  preemptive?: boolean;
}

// Create a log file stream
const logFile = fs.createWriteStream(path.join(process.cwd(), 'cli-tool.log'), { flags: 'w' });

// Function to log messages both to console and file
function log(message: string, toConsole: boolean = true) {
  const timestamp = new Date().toISOString();
  const logMessage = `[${timestamp}] ${message}`;

  logFile.write(logMessage + '\n');

  if (toConsole) {
    console.log(message);
  }
}

// Create readline interface for user input
const rl: Interface = createInterface({
  input: process.stdin,
  output: process.stdout
});

// Start the MCP server using the compiled JavaScript in dist directory
log('Starting LocalLlama MCP Server...');
const serverProcess: ChildProcess = spawn('npm', ['start'], {
  cwd: path.join(process.cwd(), 'dist')
});

// Buffer to collect partial JSON messages
let messageBuffer = '';

// Handle server output
serverProcess.stdout?.on('data', (data: Buffer) => {
  const text = data.toString();
  log(`Received server output: ${text}`, false);
  messageBuffer += text;

  // Process complete JSON messages
  let startIndex = messageBuffer.indexOf('{');
  while (startIndex !== -1) {
    let openBraces = 0;
    let endIndex = -1;

    for (let i = startIndex; i < messageBuffer.length; i++) {
      if (messageBuffer[i] === '{') openBraces++;
      else if (messageBuffer[i] === '}') openBraces--;

      if (openBraces === 0) {
        endIndex = i + 1;
        break;
      }
    }

    if (endIndex === -1) break;

    const jsonStr = messageBuffer.substring(startIndex, endIndex);
    try {
      const parsed = JSON.parse(jsonStr);
      log(`Parsed response: ${JSON.stringify(parsed, null, 2)}`, false);

      if (parsed.error) {
        log(`Error: ${JSON.stringify(parsed.error)}`, true);
      } else if (parsed.result) {
        log(`Result: ${JSON.stringify(parsed.result, null, 2)}`, true);
      }

      messageBuffer = messageBuffer.substring(endIndex).trim();
      startIndex = messageBuffer.indexOf('{');
    } catch {
      messageBuffer = messageBuffer.substring(startIndex + 1);
      startIndex = messageBuffer.indexOf('{');
    }
  }
});

serverProcess.stderr?.on('data', (data: Buffer) => {
  log(`ERROR: ${data.toString()}`, true);
});

serverProcess.on('close', (code: number | null) => {
  log(`Server process exited with code ${code}`, true);
  logFile.end();
  rl.close();
  process.exit(0);
});

// Function to send JSON-RPC 2.0 formatted messages
const sendJsonRpc = (method: string, params: any = {}) => {
  const message = {
    jsonrpc: '2.0',
    id: Date.now(),
    method,
    params
  };

  const msgStr = JSON.stringify(message, null, 2);
  log(`Sending message: ${msgStr}`, true);
  serverProcess.stdin?.write(msgStr + '\n');
};

// CLI Commands
rl.on('line', (input: string) => {
  const [command, ...args] = input.split(' ');

  switch (command) {
    case 'route-task':
      const [task, contextLength] = args;
      sendJsonRpc('tools/call', {
        name: 'route_task',
        arguments: { task, context_length: parseInt(contextLength, 10) }
      });
      break;

    case 'list-resources':
      sendJsonRpc('resources/list');
      break;

    case 'exit':
      log('Exiting CLI tool...', true);
      serverProcess.kill();
      rl.close();
      process.exit(0);

    default:
      log(`Unknown command: ${command}`, true);
      break;
  }
});