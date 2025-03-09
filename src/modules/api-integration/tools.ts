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

/**
 * Check if OpenRouter API key is configured
 */
export function isOpenRouterConfigured(): boolean {
  return !!config.openRouterApiKey;
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
          // Note: In a real implementation, this would be asynchronous
          // For now, we'll just return the decision with the job ID
          
          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify({
                  ...decision,
                  job_id: jobId,
                  status: 'In Progress',
                  progress: '0%',
                  message: 'Task has been routed and job created. Use job_id to track progress.'
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
          // Validate arguments
          if (!args.directories || !Array.isArray(args.directories)) {
            return {
              content: [{ type: 'text', text: 'Missing or invalid required argument: directories' }],
              isError: true,
            };
          }

          // Initialize the code search engine
          await codeSearchEngineManager.initialize({
            excludePatterns: args.exclude_patterns as string[] || undefined,
            chunkSize: args.chunk_size as number || undefined,
            bm25Options: args.bm25_options as BM25Options || undefined,
          });

          // Index the specified directories
          for (const directory of args.directories as string[]) {
            await codeSearchEngineManager.indexDirectory(directory, args.force_reindex as boolean || false);
          }

          // Get document count
          const documentCount = await codeSearchEngineManager.getDocumentCount();

          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify({
                  message: 'Retriv initialized and indexed successfully',
                  indexed_directories: args.directories,
                  document_count: documentCount,
                }, null, 2),
              },
            ],
          };
        } catch (error) {
          logger.error('Error initializing Retriv:', error);
          return {
            content: [
              {
                type: 'text',
                text: `Error initializing Retriv: ${error instanceof Error ? error.message : String(error)}`,
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