import { ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { IToolDefinitionProvider } from '../types.js';
import { isOpenRouterConfigured, isPythonAvailable, isPythonModuleInstalled } from '../tools.js';

class ToolDefinitionProvider implements IToolDefinitionProvider {
  async getTools() {
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

    return tools;
  }

  setupToolHandlers(server: Server) {
    server.setRequestHandler(ListToolsRequestSchema, async () => {
      return { tools: await this.getTools() };
    });
  }
}

export const toolDefinitionProvider = new ToolDefinitionProvider();