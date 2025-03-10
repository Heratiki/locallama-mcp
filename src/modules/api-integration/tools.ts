import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import {
  CallToolRequestSchema,
  ErrorCode,
  ListToolsRequestSchema,
  McpError,
} from '@modelcontextprotocol/sdk/types.js';
import { decisionEngine } from '../decision-engine/index.js';
import { costMonitor } from '../cost-monitor/index.js';
import { benchmarkModule } from '../benchmark/index.js';
import { openRouterModule } from '../openrouter/index.js';
import { logger } from '../../utils/logger.js';
import { config } from '../../config/index.js';
import { jobTracker } from '../decision-engine/services/jobTracker.js';
import { v4 as uuidv4 } from 'uuid';
import { loadUserPreferences } from '../user-preferences/index.js';
import { codeSearchEngineManager, getCodeSearchEngine, indexDocuments } from '../cost-monitor/codeSearchEngine.js';
import { BM25Options } from '../cost-monitor/bm25.js';
import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

/**
 * Check if OpenRouter API key is configured
 */
export function isOpenRouterConfigured(): boolean {
  return !!config.openRouterApiKey;
}

/**
 * Check if a Python module is installed
 */
function isPythonModuleInstalled(moduleName: string): boolean {
  try {
    const result = execSync(`python -c "import ${moduleName}"`, { stdio: 'pipe' });
    return true;
  } catch (error) {
    return false;
  }
}

/**
 * Check if Python is installed and available
 */
function isPythonAvailable(): boolean {
  try {
    execSync('python --version', { stdio: 'pipe' });
    return true;
  } catch (error) {
    try {
      execSync('python3 --version', { stdio: 'pipe' });
      return true;
    } catch (error) {
      return false;
    }
  }
}

/**
 * Generate a requirements.txt file for Retriv dependencies
 */
function generateRequirementsTxt(): string {
  const requirementsPath = path.join(process.cwd(), 'retriv-requirements.txt');
  
  const dependencies = [
    'retriv>=0.3.1',
    'numpy>=1.22.0',
    'scikit-learn>=1.0.2',
    'scipy>=1.8.0'
  ];
  
  fs.writeFileSync(requirementsPath, dependencies.join('\n'));
  return requirementsPath;
}

/**
 * Execute a task using the selected model
 * This handles the actual execution of the task through the appropriate service
 */
async function executeTask(model: string, task: string, jobId: string): Promise<string> {
  try {
    logger.info(`Executing task with model ${model} for job ${jobId}`);
    
    // Update job progress to executing (25%)
    jobTracker.updateJobProgress(jobId, 25, 120000);
    
    let result;
    
    // Determine the execution path based on model provider
    if (model.startsWith('openrouter:')) {
      // Handle OpenRouter execution
      try {
        // Update progress to 50% before API call
        jobTracker.updateJobProgress(jobId, 50, 60000);
        
        // Execute the task via OpenRouter
        result = await openRouterModule.executeTask(model.replace('openrouter:', ''), task);
        
        // Update progress to 75% after successful API call
        jobTracker.updateJobProgress(jobId, 75, 30000);
      } catch (error) {
        logger.error(`Failed to execute task with OpenRouter: ${error}`);
        throw error;
      }
      
    } else if (model.startsWith('local:') || model.startsWith('ollama:') || model.startsWith('lm-studio:')) {
      // Handle local model execution
      // For local models, use the appropriate service based on the prefix
      const modelProvider = model.split(':')[0];
      const modelName = model.split(':').slice(1).join(':');
      
      try {
        // Update progress to 50% before local model execution
        jobTracker.updateJobProgress(jobId, 50, 60000);
        
        // Execute the task via the decision engine's local model handler
        result = await decisionEngine.executeLocalTask({
          task,
          model: modelName,
          provider: modelProvider,
          maxTokens: 4096 // Default reasonable limit
        });
        
        // Update progress to 75% after local execution
        jobTracker.updateJobProgress(jobId, 75, 30000);
      } catch (error) {
        logger.error(`Failed to execute task with local model: ${error}`);
        throw error;
      }
      
    } else {
      // Unknown model type, log error and throw exception
      logger.error(`Unknown model type for execution: ${model}`);
      throw new Error(`Unknown model type: ${model}`);
    }
    
    // Process and format result if needed
    const formattedResult = typeof result === 'string' ? result : JSON.stringify(result);
    
    // Index the result in Retriv if possible
    try {
      const codeSearchEngine = await getCodeSearchEngine();
      await indexDocuments([
        { 
          content: formattedResult, 
          path: `job_${jobId}`, 
          language: 'code' 
        }
      ]);
      logger.info(`Successfully indexed result for job ${jobId} in Retriv`);
    } catch (error) {
      logger.warn(`Failed to index result in Retriv: ${error}`);
      // Continue even if indexing fails
    }
    
    // Complete the job (100%)
    jobTracker.completeJob(jobId);
    logger.info(`Job ${jobId} completed successfully`);
    
    return formattedResult;
  } catch (error) {
    logger.error(`Error executing task for job ${jobId}:`, error);
    jobTracker.failJob(jobId, error instanceof Error ? error.message : 'Unknown error during execution');
    throw error;
  }
}

/**
 * Set up tool handlers for the MCP Server
 * 
 * Tools provide functionality for making decisions about routing tasks
 * between local LLMs and paid APIs.
 */
export function setupToolHandlers(server: Server): void {
  // List available tools
  server.setRequestHandler(ListToolsRequestSchema, async () => {
    logger.debug('Listing available tools');
    
    // Check if retriv-related tools should be included based on Python availability
    const pythonAvailable = isPythonAvailable();
    const retrivAvailable = pythonAvailable && isPythonModuleInstalled('retriv');
    
    const tools = [
      {
        name: 'route_task',
        description: 'Route a coding task to either a local LLM or a paid API based on cost and complexity',
        inputSchema: {
          type: 'object',
          properties: {
            task: {
              type: 'string',
              description: 'The coding task to route',
            },
            context_length: {
              type: 'number',
              description: 'The length of the context in tokens',
            },
            expected_output_length: {
              type: 'number',
              description: 'The expected length of the output in tokens',
            },
            complexity: {
              type: 'number',
              description: 'The complexity of the task (0-1)',
            },
            priority: {
              type: 'string',
              enum: ['speed', 'cost', 'quality'],
              description: 'The priority for this task',
            },
            preemptive: {
              type: 'boolean',
              description: 'Whether to use preemptive routing (faster but less accurate)',
            },
          },
          required: ['task', 'context_length'],
        },
      },
      {
        name: 'retriv_init',
        description: 'Initialize and configure Retriv for code search and indexing',
        inputSchema: {
          type: 'object',
          properties: {
            directories: {
              type: 'array',
              items: {
                type: 'string'
              },
              description: 'Array of directories to index',
            },
            exclude_patterns: {
              type: 'array',
              items: {
                type: 'string'
              },
              description: 'Array of glob patterns to exclude from indexing',
            },
            chunk_size: {
              type: 'number',
              description: 'Size of chunks for large files (in lines)',
            },
            force_reindex: {
              type: 'boolean',
              description: 'Whether to force reindexing of all files',
            },
            bm25_options: {
              type: 'object',
              description: 'Options for the BM25 algorithm',
            },
            install_dependencies: {
              type: 'boolean',
              description: 'Whether to automatically install required Python dependencies',
            },
          },
          required: ['directories'],
        },
      },
      {
        name: 'cancel_job',
        description: 'Cancel a running job',
        inputSchema: {
          type: 'object',
          properties: {
            job_id: {
              type: 'string',
              description: 'The ID of the job to cancel',
            },
          },
          required: ['job_id'],
        },
      },
      {
        name: 'preemptive_route_task',
        description: 'Quickly route a coding task without making API calls (faster but less accurate)',
        inputSchema: {
          type: 'object',
          properties: {
            task: {
              type: 'string',
              description: 'The coding task to route',
            },
            context_length: {
              type: 'number', // Corrected type
              description: 'The length of the context in tokens',
            },
            expected_output_length: {
              type: 'number', // Corrected type
              description: 'The expected length of the output in tokens',
            },
            complexity: {
              type: 'number', // Corrected type
              description: 'The complexity of the task (0-1)',
            },
            priority: {
              type: 'string',
              enum: ['speed', 'cost', 'quality'],
              description: 'The priority for this task',
            },
          },
          required: ['task', 'context_length'],
        },
      },
      {
        name: 'get_cost_estimate',
        description: 'Get an estimate of the cost for a task',
        inputSchema: {
          type: 'object',
          properties: {
            context_length: {
              type: 'number', // Corrected type
              description: 'The length of the context in tokens',
            },
            expected_output_length: {
              type: 'number', // Corrected type
              description: 'The expected length of the output in tokens',
            },
            model: {
              type: 'string',
              description: 'The model to use (optional)',
            },
          },
          required: ['context_length'],
        },
      },
      {
        name: 'benchmark_task',
        description: 'Benchmark the performance of local LLMs vs paid APIs for a specific task',
        inputSchema: {
          type: 'object',
          properties: {
            task_id: {
              type: 'string',
              description: 'A unique identifier for the task',
            },
            task: {
              type: 'string',
              description: 'The coding task to benchmark',
            },
            context_length: {
              type: 'number', // Corrected type
              description: 'The length of the context in tokens',
            },
            expected_output_length: {
              type: 'number', // Corrected type
              description: 'The expected length of the output in tokens',
            },
            complexity: {
              type: 'number', // Corrected type
              description: 'The complexity of the task (0-1)',
            },
            local_model: {
              type: 'string',
              description: 'The local model to use (optional)',
            },
            paid_model: {
              type: 'string',
              description: 'The paid model to use (optional)',
            },
            runs_per_task: {
              type: 'number',
              description: 'Number of runs per task for more accurate results (optional)',
            },
          },
          required: ['task_id', 'task', 'context_length'],
        },
      },
      {
        name: 'benchmark_tasks',
        description: 'Benchmark the performance of local LLMs vs paid APIs for multiple tasks',
        inputSchema: {
          type: 'object',
          properties: {
            tasks: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  task_id: {
                    type: 'string',
                    description: 'A unique identifier for the task',
                  },
                  task: {
                    type: 'string',
                    description: 'The coding task to benchmark',
                  },
                  context_length: {
                    type: 'number', // Corrected type
                    description: 'The length of the context in tokens',
                  },
                  expected_output_length: {
                    type: 'number', // Corrected type
                    description: 'The expected length of the output in tokens',
                  },
                  complexity: {
                    type: 'number', // Corrected type
                    description: 'The complexity of the task (0-1)',
                  },
                  local_model: {
                    type: 'string',
                    description: 'The local model to use (optional)',
                  },
                  paid_model: {
                    type: 'string',
                    description: 'The paid model to use (optional)',
                  },
                },
                required: ['task_id', 'task', 'context_length'],
              },
              description: 'Array of tasks to benchmark',
            },
            runs_per_task: {
              type: 'number',
              description: 'Number of runs per task for more accurate results (optional)',
            },
            parallel: {
              type: 'boolean',
              description: 'Whether to run tasks in parallel (optional)',
            },
            max_parallel_tasks: {
              type: 'number',
              description: 'Maximum number of parallel tasks (optional)',
            },
          },
          required: ['tasks'],
        },
      }
    ];
    
    // Add OpenRouter-specific tools if API key is configured
    if (isOpenRouterConfigured()) {
      tools.push(
        {
          name: 'get_free_models',
          description: 'Get a list of free models available from OpenRouter',
          inputSchema: {
            type: 'object',
            properties: {
              task: {
                type: 'string',
                description: 'The coding task to route',
              },
              context_length: {
                type: 'number',
                description: 'The length of the context in tokens',
              },
              expected_output_length: {
                type: 'number',
                description: 'The expected length of the output in tokens',
              },
              complexity: {
                type: 'number',
                description: 'The complexity of the task (0-1)',
              },
              priority: {
                type: 'string',
                enum: ['speed', 'cost', 'quality'],
                description: 'The priority for this task',
              },
              preemptive: {
                type: 'boolean',
                description: 'Whether to force an update of models',
              },
            },
            required: [],
          },
        },
        {
          name: 'clear_openrouter_tracking',
          description: 'Clear OpenRouter tracking data and force an update',
          inputSchema: {
            type: 'object',
            properties: {
              task: {
                type: 'string',
                description: 'Unused but required for type compatibility',
              },
              context_length: {
                type: 'number',
                description: 'Unused but required for type compatibility',
              },
              expected_output_length: {
                type: 'number',
                description: 'Unused but required for type compatibility',
              },
              complexity: {
                type: 'number',
                description: 'Unused but required for type compatibility',
              },
              priority: {
                type: 'string',
                enum: ['speed', 'cost', 'quality'],
                description: 'Unused but required for type compatibility',
              },
            },
            required: [],
          },
        },
        {
          name: 'benchmark_free_models',
          description: 'Benchmark the performance of free models from OpenRouter',
          inputSchema: {
            type: 'object',
            properties: {
              tasks: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    task_id: {
                      type: 'string',
                      description: 'A unique identifier for the task',
                    },
                    task: {
                      type: 'string',
                      description: 'The coding task to benchmark',
                    },
                    context_length: {
                      type: 'number',
                      description: 'The length of the context in tokens',
                    },
                    expected_output_length: {
                      type: 'number',
                      description: 'The expected length of the output in tokens',
                    },
                    complexity: {
                      type: 'number',
                      description: 'The complexity of the task (0-1)',
                    },
                    local_model: {
                      type: 'string',
                      description: 'The local model to use (optional)',
                    },
                    paid_model: {
                      type: 'string',
                      description: 'The paid model to use (optional)',
                    },
                  },
                  required: ['task_id', 'task', 'context_length'],
                },
                description: 'Array of tasks to benchmark',
              },
              runs_per_task: {
                type: 'number',
                description: 'Number of runs per task for more accurate results (optional)',
              },
              parallel: {
                type: 'boolean',
                description: 'Whether to run tasks in parallel (optional)',
              },
              max_parallel_tasks: {
                type: 'number',
                description: 'Maximum number of parallel tasks (optional)',
              },
            },
            required: ['tasks'],
          },
        },
        {
          name: 'set_model_prompting_strategy',
          description: 'Update the prompting strategy for an OpenRouter model',
          inputSchema: {
            type: 'object',
            properties: {
              task: {
                type: 'string',
                description: 'The ID of the model to update',
              },
              context_length: {
                type: 'number',
                description: 'Unused but required for type compatibility',
              },
              expected_output_length: {
                type: 'number',
                description: 'The system prompt to use',
              },
              priority: {
                type: 'string',
                enum: ['speed', 'cost', 'quality'],
                description: 'The user prompt template to use',
              },
              complexity: {
                type: 'number',
                description: 'The assistant prompt template to use',
              },
              preemptive: {
                type: 'boolean',
                description: 'Whether to use chat format',
              },
            },
            required: ['task', 'context_length'],
          },
        }
      );
    }
    
    return { tools };
  });

  // Handle tool calls
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    logger.debug(`Calling tool: ${name} with arguments:`, args);
    
    // Ensure args is defined
    if (!args) {
      return {
        content: [{ type: 'text', text: 'Missing arguments' }],
        isError: true,
      };
    }
    
    switch (name) {
      case 'route_task': {
        try {
          // Validate arguments
          if (!args.task) {
            return {
              content: [{ type: 'text', text: 'Missing required argument: task' }],
              isError: true,
            };
          }
          
          // Step 1: Load User Preferences
          const userPreferences = await loadUserPreferences();
          const executionMode = userPreferences.executionMode || 'Fully automated selection';
          
          // Step 2: Cost Estimation
          const costEstimate = await costMonitor.estimateCost({
            contextLength: (args.context_length as number) || 0,
            outputLength: (args.expected_output_length as number) || 0,
          });
          
          const costThreshold = userPreferences.costConfirmationThreshold || config.costThreshold;
          
          // Check if the execution mode allows paid APIs
          const allowsPaidAPIs = executionMode !== 'Local model only' &&
                                executionMode !== 'Free API only' &&
                                executionMode !== 'Local and Free API';
          
          if (costEstimate.paid.cost.total > costThreshold && allowsPaidAPIs) {
            // Return a response that requires user confirmation
            return {
              content: [
                {
                  type: 'text',
                  text: JSON.stringify({
                    type: 'cost_confirmation',
                    estimated_cost: costEstimate.paid.cost.total,
                    message: 'Estimated cost exceeds threshold. Do you want to continue?',
                    options: ['Yes', 'No'],
                    job_id: null // No job created yet
                  }, null, 2),
                },
              ],
            };
          }
          
          // Step 3: Task Breakdown Analysis
          let taskAnalysis = null;
          let hasSubtasks = false;
          
          // Check if the execution mode allows any API (free or paid)
          const allowsAnyAPI = executionMode !== 'Local model only';
          
          if (allowsAnyAPI) {
            try {
              taskAnalysis = await decisionEngine.analyzeCodeTask(args.task as string);
              hasSubtasks = taskAnalysis && taskAnalysis.executionOrder && taskAnalysis.executionOrder.length > 0;
              logger.info(`Task analysis complete. Found ${hasSubtasks ? taskAnalysis.executionOrder.length : 0} subtasks.`);
            } catch (error) {
              logger.warn('Error analyzing task:', error);
              // Continue with normal processing if task analysis fails
            }
          }
          
          // Step 4: Retriv Search
          let retrivResults: any[] = [];
          if (!hasSubtasks && userPreferences.prioritizeRetrivSearch) {
            try {
              const codeSearchEngine = await getCodeSearchEngine();
              retrivResults = await codeSearchEngine.search(args.task as string, 5);
              logger.info(`Found ${retrivResults.length} results in Retriv for task: ${args.task}`);
            } catch (error) {
              logger.warn('Error searching Retriv:', error);
              // Continue with normal processing if Retriv search fails
            }
          }
          
          if (retrivResults.length > 0) {
            // Use existing code from Retriv
            return {
              content: [
                {
                  type: 'text',
                  text: JSON.stringify({
                    message: 'Found existing code solution in Retriv',
                    results: retrivResults,
                    source: 'retriv'
                  }, null, 2),
                },
              ],
            };
          }
          
          // Step 5: Decision Engine Routing
          const decision = await decisionEngine.routeTask({
            task: args.task as string,
            contextLength: (args.context_length as number) || 0,
            expectedOutputLength: (args.expected_output_length as number) || 0,
            complexity: (args.complexity as number) || 0.5,
            priority: (args.priority as 'speed' | 'cost' | 'quality') || 'quality',
          });
          
          // Step 6: Job Creation
          const jobId = uuidv4();
          jobTracker.createJob(jobId, args.task as string, decision.model);
          
          // Step 7: Progress Tracking
          jobTracker.updateJobProgress(jobId, 0);
          
          // Step 8: Execute Task and Store Result
          // Instead of just returning the decision, we'll actually execute the task
          // but do it asynchronously so we don't block the response
          (async () => {
            try {
              const result = await executeTask(decision.model, args.task as string, jobId);
              logger.info(`Task execution completed successfully for job ${jobId}`);
            } catch (error) {
              logger.error(`Task execution failed for job ${jobId}:`, error);
              // Job failure is already handled in executeTask
            }
          })();
          
          // Return immediately with the job ID so the user can track progress
          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify({
                  ...decision,
                  job_id: jobId,
                  status: 'In Progress',
                  progress: '0%',
                  message: 'Task has been routed and execution started. Use job_id to track progress.'
                }, null, 2),
              },
            ],
          };
        } catch (error) {
          logger.error('Error routing task:', error);
          return {
            content: [
              {
                type: 'text',
                text: `Error routing task: ${error instanceof Error ? error.message : String(error)}`,
              },
            ],
            isError: true,
          };
        }
      }
      
      case 'preemptive_route_task': {
        try {
          // Validate arguments
          if (!args.task) {
            return {
              content: [{ type: 'text', text: 'Missing required argument: task' }],
              isError: true,
            };
          }
          
          // Use preemptive routing for faster decision
          const decision = await decisionEngine.preemptiveRouting({
            task: args.task as string,
            contextLength: (args.context_length as number) || 0,
            expectedOutputLength: (args.expected_output_length as number) || 0,
            complexity: (args.complexity as number) || 0.5,
            priority: (args.priority as 'speed' | 'cost' | 'quality') || 'quality',
          });
          
          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify(decision, null, 2),
              },
            ],
          };
        } catch (error) {
          logger.error('Error in preemptive routing:', error);
          return {
            content: [
              {
                type: 'text',
                text: `Error in preemptive routing: ${error instanceof Error ? error.message : String(error)}`,
              },
            ],
            isError: true,
          };
        }
      }
      
      case 'get_cost_estimate': {
        try {
          // Validate arguments
          if (args.context_length === undefined) {
            return {
              content: [{ type: 'text', text: 'Missing required argument: context_length' }],
              isError: true,
            };
          }
          
          // Get cost estimate
          const estimate = await costMonitor.estimateCost({
            contextLength: args.context_length as number,
            outputLength: (args.expected_output_length as number) || 0,
            model: args.model as string | undefined,
          });
          
          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify(estimate, null, 2),
              },
            ],
          };
        } catch (error) {
          logger.error('Error getting cost estimate:', error);
          return {
            content: [
              {
                type: 'text',
                text: `Error getting cost estimate: ${error instanceof Error ? error.message : String(error)}`,
              },
            ],
            isError: true,
          };
        }
      }
      
      case 'benchmark_task': {
        try {
          // Validate arguments
          if (!args.task_id) {
            return {
              content: [{ type: 'text', text: 'Missing required argument: task_id' }],
              isError: true,
            };
          }
          
          if (!args.task) {
            return {
              content: [{ type: 'text', text: 'Missing required argument: task' }],
              isError: true,
            };
          }
          
          if (args.context_length === undefined) {
            return {
              content: [{ type: 'text', text: 'Missing required argument: context_length' }],
              isError: true,
            };
          }
          
          // Create benchmark config
          const config = {
            ...benchmarkModule.defaultConfig,
            runsPerTask: (args.runs_per_task as number) || benchmarkModule.defaultConfig.runsPerTask,
          };
          
          // Run benchmark
          const result = await benchmarkModule.benchmarkTask({
            taskId: args.task_id as string,
            task: args.task as string,
            contextLength: args.context_length as number,
            expectedOutputLength: (args.expected_output_length as number) || 0,
            complexity: (args.complexity as number) || 0.5,
            localModel: args.local_model as string | undefined,
            paidModel: args.paid_model as string | undefined,
          }, config);
          
          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify(result, null, 2),
              },
            ],
          };
        } catch (error) {
          logger.error('Error benchmarking task:', error);
          return {
            content: [
              {
                type: 'text',
                text: `Error benchmarking task: ${error instanceof Error ? error.message : String(error)}`,
              },
            ],
            isError: true,
          };
        }
      }
      
      case 'benchmark_tasks': {
        try {
          // Validate arguments
          if (!args.tasks || !Array.isArray(args.tasks) || args.tasks.length === 0) {
            return {
              content: [{ type: 'text', text: 'Missing or invalid required argument: tasks' }],
              isError: true,
            };
          }
          
          // Create benchmark config
          const config = {
            ...benchmarkModule.defaultConfig,
            runsPerTask: (args.runs_per_task as number) || benchmarkModule.defaultConfig.runsPerTask,
            parallel: (args.parallel as boolean) || benchmarkModule.defaultConfig.parallel,
            maxParallelTasks: (args.max_parallel_tasks as number) || benchmarkModule.defaultConfig.maxParallelTasks,
          };
          
          // Convert tasks to the correct format
          const tasks = (args.tasks as any[]).map(task => ({
            taskId: task.task_id,
            task: task.task,
            contextLength: task.context_length,
            expectedOutputLength: task.expected_output_length || 0,
            complexity: task.complexity || 0.5,
            localModel: task.local_model,
            paidModel: task.paid_model,
          }));
          
          // Run benchmarks
          const summary = await benchmarkModule.benchmarkTasks(tasks, config);
          
          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify(summary, null, 2),
              },
            ],
          };
        } catch (error) {
          logger.error('Error benchmarking tasks:', error);
          return {
            content: [
              {
                type: 'text',
                text: `Error benchmarking tasks: ${error instanceof Error ? error.message : String(error)}`,
              },
            ],
            isError: true,
          };
        }
      }
      
      case 'get_free_models': {
        try {
          // Check if OpenRouter API key is configured
          if (!isOpenRouterConfigured()) {
            return {
              content: [{ type: 'text', text: 'OpenRouter API key not configured' }],
              isError: true,
            };
          }
          
          // Initialize OpenRouter module if needed
          if (Object.keys(openRouterModule.modelTracking.models).length === 0) {
            await openRouterModule.initialize();
          }
          
          // Check if preemptive is set to force an update
          const forceUpdate = args.preemptive === true;
          logger.info(`Getting free models with forceUpdate=${forceUpdate}`);
          
          // Get free models with forceUpdate parameter
          const freeModels = await costMonitor.getFreeModels(forceUpdate);
          
          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify(freeModels, null, 2),
              },
            ],
          };
        } catch (error) {
          logger.error('Error getting free models:', error);
          return {
            content: [
              {
                type: 'text',
                text: `Error getting free models: ${error instanceof Error ? error.message : String(error)}`,
              },
            ],
            isError: true,
          };
        }
      }
      
      case 'benchmark_free_models': {
        try {
          // Check if OpenRouter API key is configured
          if (!isOpenRouterConfigured()) {
            return {
              content: [{ type: 'text', text: 'OpenRouter API key not configured' }],
              isError: true,
            };
          }
          
          // Validate arguments
          if (!args.tasks || !Array.isArray(args.tasks) || args.tasks.length === 0) {
            return {
              content: [{ type: 'text', text: 'Missing or invalid required argument: tasks' }],
              isError: true,
            };
          }
          
          // Create benchmark config
          const config = {
            ...benchmarkModule.defaultConfig,
            runsPerTask: (args.runs_per_task as number) || benchmarkModule.defaultConfig.runsPerTask,
            parallel: (args.parallel as boolean) || benchmarkModule.defaultConfig.parallel,
            maxParallelTasks: (args.max_parallel_tasks as number) || benchmarkModule.defaultConfig.maxParallelTasks,
          };
          
          // Convert tasks to the correct format
          const tasks = (args.tasks as any[]).map(task => ({
            taskId: task.task_id,
            task: task.task,
            contextLength: task.context_length,
            expectedOutputLength: task.expected_output_length || 0,
            complexity: task.complexity || 0.5,
            localModel: task.local_model,
            paidModel: task.paid_model,
          }));
          
          // Run benchmarks for free models
          const summary = await benchmarkModule.benchmarkTasks(tasks, config);
          
          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify(summary, null, 2),
              },
            ],
          };
        } catch (error) {
          logger.error('Error benchmarking free models:', error);
          return {
            content: [
              {
                type: 'text',
                text: `Error benchmarking free models: ${error instanceof Error ? error.message : String(error)}`,
              },
            ],
            isError: true,
          };
        }
      }
      
      case 'set_model_prompting_strategy': {
        try {
          // Check if OpenRouter API key is configured
          if (!isOpenRouterConfigured()) {
            return {
              content: [{ type: 'text', text: 'OpenRouter API key not configured' }],
              isError: true,
            };
          }
          
          // Validate arguments
          if (!args.task) {
            return {
              content: [{ type: 'text', text: 'Missing required argument: task' }],
              isError: true,
            };
          }
          
          // Initialize OpenRouter module if needed
          if (Object.keys(openRouterModule.modelTracking.models).length === 0) {
            await openRouterModule.initialize();
          }
          
          // Update prompting strategy
          await openRouterModule.updatePromptingStrategy(
            args.task as string,
            {
              systemPrompt: args.expected_output_length as unknown as string,
              userPrompt: args.priority as string,
              assistantPrompt: args.complexity as unknown as string,
              useChat: args.preemptive as boolean,
            },
            1.0, // Success rate
            1.0  // Quality score
          );
          
          return {
            content: [
              {
                type: 'text',
                text: `Successfully updated prompting strategy for model ${args.task}`,
              },
            ],
          };
        } catch (error) {
          logger.error('Error updating prompting strategy:', error);
          return {
            content: [
              {
                type: 'text',
                text: `Error updating prompting strategy: ${error instanceof Error ? error.message : String(error)}`,
              },
            ],
            isError: true,
          };
        }
      }
      
      case 'retriv_init': {
        try {
          // Check if Python is available
          if (!isPythonAvailable()) {
            return {
              content: [{ 
                type: 'text', 
                text: JSON.stringify({
                  status: 'error',
                  message: 'Python is not installed or not available in PATH. Python is required for Retriv functionality.',
                  recommendation: 'Install Python 3.8 or newer and ensure it\'s available in your system PATH.'
                }, null, 2) 
              }],
              isError: true,
            };
          }
          
          // Check if Retriv is installed
          const retrivInstalled = isPythonModuleInstalled('retriv');
          const installDependencies = args.install_dependencies === true;
          
          if (!retrivInstalled) {
            if (installDependencies) {
              logger.info('Installing Retriv Python package...');
              try {
                // Generate requirements file
                const requirementsPath = generateRequirementsTxt();
                
                // Install dependencies
                execSync(`pip install -r ${requirementsPath}`, { stdio: 'inherit' });
                logger.info('Successfully installed Retriv and dependencies');
                
                // Clean up requirements file
                fs.unlinkSync(requirementsPath);
              } catch (error) {
                return {
                  content: [{ 
                    type: 'text', 
                    text: JSON.stringify({
                      status: 'error',
                      message: 'Failed to install Retriv Python package automatically.',
                      error: error instanceof Error ? error.message : String(error),
                      recommendation: 'Try installing manually with: pip install retriv>=0.3.1 numpy>=1.22.0 scikit-learn>=1.0.2 scipy>=1.8.0'
                    }, null, 2) 
                  }],
                  isError: true,
                };
              }
            } else {
              return {
                content: [{ 
                  type: 'text', 
                  text: JSON.stringify({
                    status: 'error',
                    message: 'The Retriv Python package is required but not installed.',
                    recommendation: 'Use this tool again with install_dependencies set to true, or install manually with: pip install retriv>=0.3.1 numpy>=1.22.0 scikit-learn>=1.0.2 scipy>=1.8.0'
                  }, null, 2) 
                }],
                isError: true,
              };
            }
          }
          
          // Validate arguments
          if (!args.directories || !Array.isArray(args.directories)) {
            return {
              content: [{ type: 'text', text: 'Missing or invalid required argument: directories' }],
              isError: true,
            };
          }

          logger.info(`Initializing Retriv for directories: ${(args.directories as string[]).join(', ')}`);
          
          // Initialize the code search engine with detailed feedback
          logger.info('Starting code search engine initialization...');
          await codeSearchEngineManager.initialize({
            excludePatterns: args.exclude_patterns as string[] || undefined,
            chunkSize: args.chunk_size as number || undefined,
            bm25Options: args.bm25_options as BM25Options || undefined,
          });
          logger.info('Code search engine initialized successfully');
          
          // Index the specified directories with progress updates
          let totalFiles = 0;
          const startTime = Date.now();
          const indexResults = [];
          
          for (const directory of args.directories as string[]) {
            logger.info(`Indexing directory: ${directory}`);
            try {
              const result = await codeSearchEngineManager.indexDirectory(directory, args.force_reindex as boolean || false);
              if (result && typeof result === 'object') {
                const fileCount = result.totalFiles || 0;
                totalFiles += fileCount;
                indexResults.push({
                  directory,
                  files_indexed: fileCount,
                  status: 'success',
                  time_taken: result.timeTaken || 'N/A'
                });
                logger.info(`Successfully indexed ${fileCount} files in ${directory}`);
              } else {
                indexResults.push({
                  directory,
                  status: 'warning',
                  message: 'Directory indexed but no result details available'
                });
                logger.warn(`Directory indexed but no result details available for ${directory}`);
              }
            } catch (error) {
              indexResults.push({
                directory,
                status: 'error',
                message: error instanceof Error ? error.message : String(error)
              });
              logger.error(`Error indexing directory ${directory}:`, error);
            }
          }
          
          // Get document count and additional statistics
          const documentCount = await codeSearchEngineManager.getDocumentCount();
          const endTime = Date.now();
          const totalTimeTaken = ((endTime - startTime) / 1000).toFixed(2);
          
          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify({
                  message: 'Retriv initialized and indexed successfully',
                  summary: {
                    indexed_directories: (args.directories as string[]).length,
                    total_files: totalFiles,
                    document_count: documentCount,
                    total_time_taken: `${totalTimeTaken} seconds`
                  },
                  details: indexResults,
                  search_ready: documentCount > 0,
                  next_steps: documentCount > 0 
                    ? 'You can now use the retriv command to search through indexed documents'
                    : 'No documents were indexed. Please check your directories and try again.'
                }, null, 2),
              },
            ],
          };
        } catch (error) {
          logger.error('Error initializing Retriv:', error);
          
          // Provide detailed error message with troubleshooting information
          let errorMessage = `Error initializing Retriv: ${error instanceof Error ? error.message : String(error)}`;
          let recommendation = '';
          
          if (errorMessage.includes("No module named 'retriv'")) {
            recommendation = 'The Retriv Python module is missing. Run this tool again with install_dependencies set to true, or install manually with: pip install retriv>=0.3.1';
          } else if (errorMessage.includes('numpy') || errorMessage.includes('scikit') || errorMessage.includes('scipy')) {
            recommendation = 'Missing Python dependencies. Run this tool again with install_dependencies set to true, or install manually with: pip install numpy scikit-learn scipy';
          }
          
          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify({
                  status: 'error',
                  message: errorMessage,
                  recommendation: recommendation || 'Check if Python and all required dependencies are correctly installed.',
                  stack: error instanceof Error && error.stack ? error.stack : undefined,
                  directories_attempted: args.directories
                }, null, 2),
              },
            ],
            isError: true,
          };
        }
      }

      case 'cancel_job': {
        try {
          // Validate arguments
          if (!args.job_id) {
            return {
              content: [{ type: 'text', text: 'Missing required argument: job_id' }],
              isError: true,
            };
          }

          // Get the job
          const job = jobTracker.getJob(args.job_id as string);
          if (!job) {
            return {
              content: [{ type: 'text', text: `Job with ID ${args.job_id} not found` }],
              isError: true,
            };
          }

          // Check if the job can be cancelled
          if (job.status === 'Completed' || job.status === 'Cancelled' || job.status === 'Failed') {
            return {
              content: [{ type: 'text', text: `Job with ID ${args.job_id} is already ${job.status.toLowerCase()}` }],
              isError: true,
            };
          }

          // Cancel the job
          jobTracker.cancelJob(args.job_id as string);

          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify({
                  message: `Job with ID ${args.job_id} has been cancelled`,
                  job: jobTracker.getJob(args.job_id as string),
                }, null, 2),
              },
            ],
          };
        } catch (error) {
          logger.error('Error cancelling job:', error);
          return {
            content: [
              {
                type: 'text',
                text: `Error cancelling job: ${error instanceof Error ? error.message : String(error)}`,
              },
            ],
            isError: true,
          };
        }
      }

      case 'clear_openrouter_tracking': {
        try {
          // Check if OpenRouter API key is configured
          if (!isOpenRouterConfigured()) {
            return {
              content: [{ type: 'text', text: 'OpenRouter API key not configured' }],
              isError: true,
            };
          }
          
          logger.info('Clearing OpenRouter tracking data and forcing update...');
          
          // Call the clearTrackingData method
          await openRouterModule.clearTrackingData();
          
          // Get the updated free models
          const freeModels = await openRouterModule.getFreeModels();
          
          return {
            content: [
              {
                type: 'text',
                text: `Successfully cleared OpenRouter tracking data and forced update. Found ${freeModels.length} free models.`,
              },
            ],
          };
        } catch (error) {
          logger.error('Error clearing OpenRouter tracking data:', error);
          return {
            content: [
              {
                type: 'text',
                text: `Error clearing OpenRouter tracking data: ${error instanceof Error ? error.message : String(error)}`,
              },
            ],
            isError: true,
          };
        }
      }
      
      default:
        throw new McpError(
          ErrorCode.MethodNotFound,
          `Unknown tool: ${name}`
        );
    }
  });
}