import { spawn, ChildProcess } from 'child_process';
import { createInterface, Interface } from 'readline';
import path from 'path';
import fs from 'fs';

/**
 * Interface for task routing parameters
 * Importing directly here since this is a standalone script
 */
interface TaskRoutingParams {
  task: string;
  context_length: number;
  expected_output_length?: number;
  complexity?: number;
  priority?: 'speed' | 'cost' | 'quality';
  preemptive?: boolean;
}

// Create a log file stream - changed from 'a' to 'w' to clear the file on each run
const logFile = fs.createWriteStream(path.join(process.cwd(), 'mcp-chat.log'), { flags: 'w' });

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
log('Starting LocalLama MCP Server...');
const serverProcess: ChildProcess = spawn('node', [
  path.join(process.cwd(), 'dist/index.js')
]);

// Buffer to collect partial JSON messages
let messageBuffer = '';

/**
 * Format model list in a more human-readable way
 * @param models Array of model objects
 * @returns Formatted string for display
 */
function formatModelsList(models: any[]): string {
  // Group models by provider
  const modelsByProvider: Record<string, any[]> = {};
  
  models.forEach(model => {
    const provider = model.provider || 'unknown';
    if (!modelsByProvider[provider]) {
      modelsByProvider[provider] = [];
    }
    modelsByProvider[provider].push(model);
  });
  
  let output = '\n=== Available Models ===\n';
  
  // For each provider, list models
  Object.keys(modelsByProvider).sort().forEach(provider => {
    output += `\n## Provider: ${provider} (${modelsByProvider[provider].length} models)\n`;
    
    // For local models, show all of them
    if (provider === 'lm-studio' || provider === 'ollama') {
      modelsByProvider[provider].forEach(model => {
        const cost = model.costPerToken.prompt === 0 ? 'Free' : 
          `$${model.costPerToken.prompt}/token (input), $${model.costPerToken.completion}/token (output)`;
        
        output += `- ${model.name}\n`;
        output += `  Context: ${model.contextWindow} tokens | Cost: ${cost}\n`;
      });
    } 
    // For OpenRouter or other providers with many models, show a summary
    else {
      // Count free vs paid models
      const freeModels = modelsByProvider[provider].filter(m => 
        m.costPerToken.prompt === 0 || m.costPerToken.prompt === "0").length;
      
      output += `- Free models: ${freeModels}\n`;
      output += `- Paid models: ${modelsByProvider[provider].length - freeModels}\n`;
      
      // Show the top 5 models with the largest context windows
      const sortedByContext = [...modelsByProvider[provider]]
        .sort((a, b) => b.contextWindow - a.contextWindow)
        .slice(0, 5);
      
      output += `- Top models by context window:\n`;
      sortedByContext.forEach(model => {
        const cost = model.costPerToken.prompt === 0 || model.costPerToken.prompt === "0" ? 'Free' : 
          `$${model.costPerToken.prompt}/token`;
        
        output += `  • ${model.name} (${model.contextWindow.toLocaleString()} tokens) - ${cost}\n`;
      });
    }
  });
  
  output += `\nTotal models available: ${models.length}\n`;
  output += `\nUse 'list resources' for more details on available API endpoints.\n`;
  
  return output;
}

// Handle server output
serverProcess.stdout?.on('data', (data: Buffer) => {
  const text = data.toString();
  // Only log raw server output to file, not console
  log(`Received server output: ${text}`, false);
  messageBuffer += text;
  
  // Try to extract complete JSON objects from the buffer
  let startIndex = messageBuffer.indexOf('{');
  if (startIndex === -1) return; // No JSON start found
  
  while (startIndex !== -1) {
    // Find a matching closing brace
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
    
    if (endIndex === -1) break; // No complete JSON object found
    
    // Extract and parse the complete JSON object
    const jsonStr = messageBuffer.substring(startIndex, endIndex);
    try {
      const parsed = JSON.parse(jsonStr);
      // Log the full parsed response to the file only
      log(`Parsed response: ${JSON.stringify(parsed, null, 2)}`, false); 
      
      if (parsed.error) {
        const errorMsg = `Error: ${JSON.stringify(parsed.error)}`;
        log(errorMsg, true);
      } else if (parsed.result) {
        // Handle resource contents
        if (parsed.result.contents && Array.isArray(parsed.result.contents)) {
          parsed.result.contents.forEach((content: any) => {
            if (content.text) {
              try {
                // Check if this is the models resource and handle specially
                if (content.uri === 'locallama://models') {
                  const modelsList = JSON.parse(content.text);
                  const formattedOutput = formatModelsList(modelsList);
                  log(formattedOutput, true);
                } else {
                  // Try to parse the content text as JSON for prettier display
                  const contentJson = JSON.parse(content.text);
                  const contentMsg = `\n${content.uri} (${content.mimeType}):\n${JSON.stringify(contentJson, null, 2)}`;
                  log(contentMsg, true);
                }
              } catch (e) {
                // If not JSON, display as plain text
                const contentMsg = `\n${content.uri} (${content.mimeType}):\n${content.text}`;
                log(contentMsg, true);
              }
            }
          });
        } else if (parsed.result.content && Array.isArray(parsed.result.content)) {
          // Handle tool results
          parsed.result.content.forEach((item: any) => {
            if (item.type === 'text' && item.text) {
              try {
                // Try to parse as JSON for prettier display
                const contentJson = JSON.parse(item.text);
                const resultMsg = `\nResult:\n${JSON.stringify(contentJson, null, 2)}`;
                log(resultMsg, true);
              } catch (e) {
                // If not JSON, display as plain text
                const resultMsg = `\nResult: ${item.text}`;
                log(resultMsg, true);
              }
            }
          });
        } else if (parsed.result.resources && Array.isArray(parsed.result.resources)) {
          // Handle resource listings
          log('\nAvailable Resources:', true);
          parsed.result.resources.forEach((resource: any) => {
            const resourceMsg = `- ${resource.name}: ${resource.uri} (${resource.mimeType})`;
            log(resourceMsg, true);
            if (resource.description) {
              const descMsg = `  ${resource.description}`;
              log(descMsg, true);
            }
          });
        } else if (parsed.result.tools && Array.isArray(parsed.result.tools)) {
          // Handle tool listings
          log('\nAvailable Tools:', true);
          parsed.result.tools.forEach((tool: any) => {
            const toolMsg = `- ${tool.name}`;
            log(toolMsg, true);
            if (tool.description) {
              const descMsg = `  ${tool.description}`;
              log(descMsg, true);
            }
          });
        } else {
          // Handle other results
          const resultMsg = `\nResponse: ${JSON.stringify(parsed.result, null, 2)}`;
          log(resultMsg, true);
        }
      }
      
      // Remove the processed JSON object from the buffer
      messageBuffer = messageBuffer.substring(endIndex).trim();
      
      // Find the next potential JSON start
      startIndex = messageBuffer.indexOf('{');
    } catch (e) {
      // If we can't parse, move past this opening brace and try the next one
      messageBuffer = messageBuffer.substring(startIndex + 1);
      startIndex = messageBuffer.indexOf('{');
    }
  }
});

// Change server error messages to only log to console if they're important
serverProcess.stderr?.on('data', (data: Buffer) => {
  const errorMsg = data.toString();
  const isWarning = errorMsg.includes('[WARN]');
  
  // Always log to file, but for console, only show errors (not warnings)
  log(`ERROR: ${errorMsg}`, !isWarning);
});

serverProcess.on('close', (code: number | null) => {
  const closeMsg = `Server process exited with code ${code}`;
  log(closeMsg, true);
  logFile.end();
  rl.close();
  process.exit(0);
});

// Function to send JSON-RPC 2.0 formatted messages
const sendJsonRpc = (method: string, params: any = {}) => {
  const message = {
    jsonrpc: '2.0',
    id: Date.now(),
    method: method,
    params
  };
  
  const msgStr = JSON.stringify(message, null, 2);
  log(`Sending message: ${msgStr}`, true);
  serverProcess.stdin?.write(JSON.stringify(message) + '\n');
};

// Function to read a resource using correct MCP SDK method name
const readResource = (uri: string) => {
  sendJsonRpc('resources/read', { uri });
};

// Function to route a task
const routeTask = (task: string, contextLength: number, expectedOutputLength?: number,
                   complexity?: number, priority?: 'speed' | 'cost' | 'quality', preemptive?: boolean) => {
  const toolName = preemptive ? 'preemptive_route_task' : 'route_task';
  sendJsonRpc('tools/call', {
    name: toolName,
    arguments: {
      task,
      context_length: contextLength,
      expected_output_length: expectedOutputLength,
      complexity,
      priority,
      preemptive
    }
  });
};

// Calculate cost estimate
const calculateCostEstimate = (promptTokens: number, completionTokens: number) => {
  sendJsonRpc('tools/call', {
    name: 'get_cost_estimate',
    arguments: {
      context_length: promptTokens,
      expected_output_length: completionTokens
    }
  });
};

// Run benchmark
const runBenchmark = (modelId: string) => {
  sendJsonRpc('tools/call', {
    name: 'benchmark_task',
    arguments: {
      task_id: `benchmark-${Date.now()}`,
      task: `Benchmark model: ${modelId}`,
      context_length: 1000,
      expected_output_length: 500,
      complexity: 0.7,
      local_model: modelId.startsWith('local:') ? modelId : undefined,
      paid_model: modelId.startsWith('api:') ? modelId : undefined
    }
  });
};

// Run multiple benchmarks
const runBenchmarks = (tasks: Array<{
  taskId: string;
  task: string;
  contextLength: number;
  expectedOutputLength?: number;
  complexity?: number;
  localModel?: string;
  paidModel?: string;
}>, runsPerTask?: number, parallel?: boolean, maxParallelTasks?: number) => {
  sendJsonRpc('tools/call', {
    name: 'benchmark_tasks',
    arguments: {
      tasks: tasks.map(task => ({
        task_id: task.taskId,
        task: task.task,
        context_length: task.contextLength,
        expected_output_length: task.expectedOutputLength,
        complexity: task.complexity,
        local_model: task.localModel,
        paid_model: task.paidModel
      })),
      runs_per_task: runsPerTask,
      parallel: parallel,
      max_parallel_tasks: maxParallelTasks
    }
  });
};

// Initialize Retriv
const initializeRetriv = (directory: string, excludePatterns?: string[], options?: any) => {
  sendJsonRpc('tools/call', {
    name: 'retriv_init',
    arguments: {
      directories: [directory],
      exclude_patterns: excludePatterns,
      ...options
    }
  });
};

// Get free models from OpenRouter
const getFreeModels = (forceUpdate: boolean = false) => {
  sendJsonRpc('tools/call', {
    name: 'get_free_models',
    arguments: {
      preemptive: forceUpdate
    }
  });
};

// Clear OpenRouter tracking data
const clearOpenRouterTracking = () => {
  sendJsonRpc('tools/call', {
    name: 'clear_openrouter_tracking',
    arguments: {}
  });
};

// Set model prompting strategy - CORRECTED ARGUMENT MAPPING
const setModelStrategy = (modelId: string, systemPrompt: string, userPrompt: string,
                         assistantPrompt: string, useChat: boolean = true) => {
  sendJsonRpc('tools/call', {
    name: 'set_model_prompting_strategy',
    arguments: {
      model_id: modelId, // Corrected: Use model_id
      system_prompt: systemPrompt, // Corrected: Use system_prompt
      user_prompt_template: userPrompt, // Corrected: Use user_prompt_template
      assistant_prompt_template: assistantPrompt, // Corrected: Use assistant_prompt_template
      use_chat_format: useChat // Corrected: Use use_chat_format
    }
  });
};

// Cancel a job
const cancelJob = (jobId: string) => {
  sendJsonRpc('tools/call', {
    name: 'cancel_job',
    arguments: {
      job_id: jobId
    }
  });
};

// Show available commands
const showHelp = () => {
  const helpText = `
===== Locallama MCP Chat Interface =====

Resource Commands:
- status                    : Get current status of the LocalLama MCP Server
- models                    : List available local and API LLM models
- benchmarks                : Get results of model benchmarks
- usage <api>               : Get token usage and cost statistics for a specific API

Tool Commands:
- route "<task>" <context> <output> <complexity> <priority>
                           : Route a task based on parameters. Task MUST be in quotes.
                             Example: route "Generate react component for a button" 1000 200 0.7 quality
- estimate <prompt> <completion>
                           : Estimate cost for token counts
                             Example: estimate 1000 500
- benchmark <modelId>      : Run benchmarks on a specific model
                             Example: benchmark local:llama3:8b

Advanced Commands:
- cancel <jobId>           : Cancel a running job
                             Example: cancel job-123456
- retriv <directory>       : Initialize Retriv for code search in a directory
                             Example: retriv /path/to/code
- free-models              : Get list of free models from OpenRouter
- clear-tracking           : Clear OpenRouter tracking data
- set-strategy <modelId> "<system>" "<user>" "<assistant>" [useChat=true|false]
                           : Set prompting strategy for a model. Prompts MUST be in quotes.
                             Example: set-strategy local:model "<sys_prompt>" "<user_tmpl>" "<asst_tmpl>" true

System Commands:
- list resources           : List all available resources
- list tools               : List all available tools
- call <tool> <json_args>  : Call a tool with arguments provided as a JSON string.
                             Example: call route_task '{"task":"Code review", "context_length":2000}'
                             Example: call benchmark_tasks '{"tasks":[{"taskId":"t1", "task":"...", ...}], "runs_per_task":3}'
- help                     : Show this help message
- exit                     : Exit the chat interface

========================================
`;

  log(helpText, true);
};

// Show initial help
showHelp();

rl.on('line', (input: string) => {
  const userInput = `> ${input}`;
  log(userInput, true);
  
  if (input.trim() === 'exit') {
    log('Exiting...', true);
    serverProcess.kill();
    logFile.end();
    rl.close();
    process.exit(0);
  }

  const trimmedInput = input.trim();

  // Handle different commands
  if (trimmedInput === 'help') {
    showHelp();
  } else if (trimmedInput === 'status') {
    readResource('locallama://status');
  } else if (trimmedInput === 'models') {
    readResource('locallama://models');
  } else if (trimmedInput === 'benchmarks') {
    readResource('locallama://benchmarks');
  } else if (trimmedInput.startsWith('usage ')) {
    const api = trimmedInput.substring(6).trim();
    if (api) {
      readResource(`locallama://usage/${api}`);
    } else {
      log('Please specify an API name. Example: usage openai', true);
    }
  } else if (trimmedInput === 'list resources') {
    sendJsonRpc('resources/list', {});
  } else if (trimmedInput === 'list tools') {
    sendJsonRpc('tools/list', {});
  } else if (trimmedInput.startsWith('route ')) {
    // Improved parsing for route command, requires task in quotes
    const match = trimmedInput.match(/^route\s+"([^"]+)"\s+(\d+)\s+(\d+)\s+([\d.]+)\s+(speed|cost|quality)$/i);
    if (!match) {
      log('Usage: route "<task>" <context_length> <output_length> <complexity> <priority>', true);
      log('Example: route "Generate code" 1000 200 0.7 quality', true);
      return;
    }

    const [, task, contextLengthStr, outputLengthStr, complexityStr, priority] = match;
    const contextLength = parseInt(contextLengthStr);
    const outputLength = parseInt(outputLengthStr);
    const complexity = parseFloat(complexityStr);

    if (isNaN(contextLength) || isNaN(outputLength) || isNaN(complexity)) {
      log('Error: Context length, output length, and complexity must be valid numbers.', true);
      return;
    }

    routeTask(task, contextLength, outputLength, complexity, priority as 'speed' | 'cost' | 'quality');

  } else if (trimmedInput.startsWith('estimate ')) {
    const parts = trimmedInput.substring(9).trim().split(' ');
    if (parts.length !== 2) {
      log('Usage: estimate <prompt_tokens> <completion_tokens>', true);
      log('Example: estimate 1000 500', true);
      return;
    }
    
    const promptTokens = parseInt(parts[0]);
    const completionTokens = parseInt(parts[1]);
    
    if (isNaN(promptTokens) || isNaN(completionTokens)) {
      log('Error: Token counts must be numbers', true);
      return;
    }
    
    calculateCostEstimate(promptTokens, completionTokens);
    
  } else if (trimmedInput.startsWith('benchmark ')) {
    const modelId = trimmedInput.substring(10).trim();
    if (!modelId) {
      log('Please specify a model ID. Example: benchmark local:llama3:8b', true);
      return;
    }
    
    runBenchmark(modelId);
    
  } else if (trimmedInput.startsWith('cancel ')) {
    const jobId = trimmedInput.substring(7).trim();
    if (!jobId) {
      log('Please specify a job ID. Example: cancel job-123456', true);
      return;
    }
    
    cancelJob(jobId);
    
  } else if (trimmedInput.startsWith('retriv ')) {
    const directory = trimmedInput.substring(7).trim();
    if (!directory) {
      log('Please specify a directory. Example: retriv /path/to/code', true);
      return;
    }
    
    initializeRetriv(directory);
    
  } else if (trimmedInput === 'free-models') {
    getFreeModels(true);
    
  } else if (trimmedInput === 'clear-tracking') {
    clearOpenRouterTracking();
    
  } else if (trimmedInput.startsWith('set-strategy ')) {
      // Parsing for set-strategy command
      const match = trimmedInput.match(/^set-strategy\s+([\w:\-]+)\s+"([^"]+)"\s+"([^"]+)"\s+"([^"]+)"(?:\s+(true|false))?$/i);
      if (!match) {
          log('Usage: set-strategy <modelId> "<systemPrompt>" "<userPrompt>" "<assistantPrompt>" [useChat=true|false]', true);
          log('Example: set-strategy local:model "System prompt" "User: {{prompt}}" "Assistant:" true', true);
          return;
      }
      const [, modelId, systemPrompt, userPrompt, assistantPrompt, useChatStr] = match;
      const useChat = useChatStr ? useChatStr.toLowerCase() === 'true' : true; // Default to true if not provided
      setModelStrategy(modelId, systemPrompt, userPrompt, assistantPrompt, useChat);
  } else if (trimmedInput.startsWith('call ')) {
    // Use regex to separate tool name and the rest as JSON string
    const match = trimmedInput.match(/^call\s+([\w\/]+)\s+(.*)$/);
    if (!match) {
        log('Usage: call <tool_name> <json_arguments>', true);
        log('Example: call tools/call \'{"name":"route_task", "arguments":{"task":"...", ...}}\'', true);
        return;
    }

    const [, toolName, argsString] = match;
    let args = {};
    try {
        // Trim potential single quotes often used in shells
        const trimmedArgsString = argsString.trim().replace(/^'|'$/g, '');
        args = JSON.parse(trimmedArgsString);
        log(`Parsed arguments for ${toolName}: ${JSON.stringify(args, null, 2)}`, false); // Log parsed args to file
        // Determine the correct method based on toolName structure
        if (toolName.includes('/')) {
            // If toolName looks like a path (e.g., 'tools/call'), use it directly as the method
            sendJsonRpc(toolName, args);
        } else {
            // Otherwise, assume it's a tool name needing the 'tools/call' structure
            sendJsonRpc('tools/call', { name: toolName, arguments: args });
        }
    } catch (e) {
        log(`Error: Invalid JSON arguments provided for tool ${toolName}.`, true);
        log(`Error details: ${e instanceof Error ? e.message : String(e)}`, false); // Log details to file
        log(`Arguments received: ${argsString}`, false);
        log('Please provide arguments as a valid JSON string.', true);
        log('Example: call route_task \'{"task":"Code review", "context_length":2000}\'', true);
    }
  } else {
    log('Unknown command. Type "help" to see available commands.', true);
  }
});

// Handle process termination
process.on('SIGINT', () => {  log('\nReceived SIGINT. Cleaning up...', true);  serverProcess.kill();  logFile.end();
  rl.close();
  process.exit(0);
});