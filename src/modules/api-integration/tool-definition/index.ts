import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { IToolDefinitionProvider, ITool } from './types.js';
import { logger } from '../../../utils/logger.js';
import { config } from '../../../config/index.js';
// import * as fs from 'fs';
import { execSync } from 'child_process';

/**
 * Check if Python is installed and available
 */
function isPythonAvailable(): boolean {
  try {
    execSync('python --version', { stdio: 'pipe' });
    return true;
  } catch (error: unknown) {
    logger.error(`Python not available: ${(error as Error).message}`);
    try {
      execSync('python3 --version', { stdio: 'pipe' });
      return true;
    } catch (error: unknown) {
      logger.error(`Python3 not available: ${(error as Error).message}`);
      return false;
    }
  }
}

/**
 * Check if a Python module is installed
 */
function isPythonModuleInstalled(moduleName: string): boolean {
  try {
    execSync(`python -c "import ${moduleName}"`, { stdio: 'pipe' });
    return true;
  } catch (error: unknown) {
    logger.error(`Python module ${moduleName} not installed: ${(error as Error).message}`);
    return false;
  }
}

/**
 * Check if OpenRouter API key is configured
 */
export function isOpenRouterConfigured(): boolean {
  return !!config.openRouterApiKey;
}

/**
 * Implementation of the tool definition provider
 */
class ToolDefinitionProvider implements IToolDefinitionProvider {
  initialize(server: Server): void {
    server.setRequestHandler(ListToolsRequestSchema, () => {
      logger.debug('Listing available tools');
      return { tools: this.getAvailableTools() };
    });
  }

  getAvailableTools(): ITool[] {
    // Check if retriv-related tools should be included based on Python availability
    const pythonAvailable = isPythonAvailable();
    const retrivAvailable = pythonAvailable && isPythonModuleInstalled('retriv');

    const tools: ITool[] = [
      {
        name: 'route_task',
        description: 'Route a coding task to either a local LLM or a paid API based on cost and complexity',
        inputSchema: {
          type: 'object' as const,
          properties: {
            task: {
              type: 'string' as const,
              description: 'The coding task to route'
            },
            context_length: {
              type: 'number' as const,
              description: 'The length of the context in tokens'
            },
            expected_output_length: {
              type: 'number' as const,
              description: 'The expected length of the output in tokens'
            },
            complexity: {
              type: 'number' as const,
              description: 'The complexity of the task (0-1)'
            },
            priority: {
              type: 'string' as const,
              enum: ['speed', 'cost', 'quality'],
              description: 'The priority for this task'
            },
            preemptive: {
              type: 'boolean' as const,
              description: 'Whether to use preemptive routing (faster but less accurate)'
            }
          },
          required: ['task', 'context_length']
        }
      },
      {
        name: 'retriv_init',
        description: 'Initialize and configure Retriv for code search and indexing',
        inputSchema: {
          type: 'object' as const,
          properties: {
            directories: {
              type: 'array' as const,
              items: {
                type: 'string' as const
              },
              description: 'Array of directories to index'
            },
            exclude_patterns: {
              type: 'array' as const,
              items: {
                type: 'string' as const
              },
              description: 'Array of glob patterns to exclude from indexing'
            },
            chunk_size: {
              type: 'number' as const,
              description: 'Size of chunks for large files (in lines)'
            },
            force_reindex: {
              type: 'boolean' as const,
              description: 'Whether to force reindexing of all files'
            },
            bm25_options: {
              type: 'object' as const,
              description: 'Options for the BM25 algorithm'
            },
            install_dependencies: {
              type: 'boolean' as const,
              description: 'Whether to automatically install required Python dependencies'
            }
          },
          required: ['directories']
        }
      },
      {
        name: 'cancel_job',
        description: 'Cancel a running job',
        inputSchema: {
          type: 'object' as const,
          properties: {
            job_id: {
              type: 'string' as const,
              description: 'The ID of the job to cancel'
            }
          },
          required: ['job_id']
        }
      },
      {
        name: 'preemptive_route_task',
        description: 'Quickly route a coding task without making API calls (faster but less accurate)',
        inputSchema: {
          type: 'object' as const,
          properties: {
            task: {
              type: 'string' as const,
              description: 'The coding task to route'
            },
            context_length: {
              type: 'number' as const,
              description: 'The length of the context in tokens'
            },
            expected_output_length: {
              type: 'number' as const,
              description: 'The expected length of the output in tokens'
            },
            complexity: {
              type: 'number' as const,
              description: 'The complexity of the task (0-1)'
            },
            priority: {
              type: 'string' as const,
              enum: ['speed', 'cost', 'quality'],
              description: 'The priority for this task'
            }
          },
          required: ['task', 'context_length']
        }
      },
      {
        name: 'get_cost_estimate',
        description: 'Get an estimate of the cost for a task',
        inputSchema: {
          type: 'object' as const,
          properties: {
            context_length: {
              type: 'number' as const,
              description: 'The length of the context in tokens'
            },
            expected_output_length: {
              type: 'number' as const,
              description: 'The expected length of the output in tokens'
            },
            model: {
              type: 'string' as const,
              description: 'The model to use (optional)'
            }
          },
          required: ['context_length']
        }
      },
      {
        name: 'benchmark_task',
        description: 'Benchmark the performance of local LLMs vs paid APIs for a specific task',
        inputSchema: {
          type: 'object' as const,
          properties: {
            task_id: {
              type: 'string' as const,
              description: 'A unique identifier for the task'
            },
            task: {
              type: 'string' as const,
              description: 'The coding task to benchmark'
            },
            context_length: {
              type: 'number' as const,
              description: 'The length of the context in tokens'
            },
            expected_output_length: {
              type: 'number' as const,
              description: 'The expected length of the output in tokens'
            },
            complexity: {
              type: 'number' as const,
              description: 'The complexity of the task (0-1)'
            },
            local_model: {
              type: 'string' as const,
              description: 'The local model to use (optional)'
            },
            paid_model: {
              type: 'string' as const,
              description: 'The paid model to use (optional)'
            },
            runs_per_task: {
              type: 'number' as const,
              description: 'Number of runs per task for more accurate results (optional)'
            }
          },
          required: ['task_id', 'task', 'context_length']
        }
      },
      {
        name: 'benchmark_tasks',
        description: 'Benchmark the performance of local LLMs vs paid APIs for multiple tasks',
        inputSchema: {
          type: 'object' as const,
          properties: {
            tasks: {
              type: 'array' as const,
              items: {
                type: 'object' as const,
                properties: {
                  task_id: {
                    type: 'string' as const,
                    description: 'A unique identifier for the task'
                  },
                  task: {
                    type: 'string' as const,
                    description: 'The coding task to benchmark'
                  },
                  context_length: {
                    type: 'number' as const,
                    description: 'The length of the context in tokens'
                  },
                  expected_output_length: {
                    type: 'number' as const,
                    description: 'The expected length of the output in tokens'
                  },
                  complexity: {
                    type: 'number' as const,
                    description: 'The complexity of the task (0-1)'
                  },
                  local_model: {
                    type: 'string' as const,
                    description: 'The local model to use (optional)'
                  },
                  paid_model: {
                    type: 'string' as const,
                    description: 'The paid model to use (optional)'
                  }
                },
                required: ['task_id', 'task', 'context_length']
              },
              description: 'Array of tasks to benchmark'
            },
            runs_per_task: {
              type: 'number' as const,
              description: 'Number of runs per task for more accurate results (optional)'
            },
            parallel: {
              type: 'boolean' as const,
              description: 'Whether to run tasks in parallel (optional)'
            },
            max_parallel_tasks: {
              type: 'number' as const,
              description: 'Maximum number of parallel tasks (optional)'
            }
          },
          required: ['tasks']
        }
      }
    ];

    // Add retriv-specific tools if Python and retriv module are available
    if (retrivAvailable) {
      tools.push(
        {
          name: 'retriv_search',
          description: 'Search code using Retriv search engine',
          inputSchema: {
            type: 'object' as const,
            properties: {
              query: {
                type: 'string' as const,
                description: 'Search query'
              },
              limit: {
                type: 'number' as const,
                description: 'Maximum number of results to return'
              }
            },
            required: ['query']
          }
        }
      );
    }

    // Add OpenRouter-specific tools if API key is configured
    if (isOpenRouterConfigured()) {
      tools.push(
        {
          name: 'get_free_models',
          description: 'Get a list of free models available from OpenRouter',
          inputSchema: {
            type: 'object' as const,
            properties: {
              task: {
                type: 'string' as const,
                description: 'The coding task to route'
              },
              context_length: {
                type: 'number' as const,
                description: 'The length of the context in tokens'
              },
              expected_output_length: {
                type: 'number' as const,
                description: 'The expected length of the output in tokens'
              },
              complexity: {
                type: 'number' as const,
                description: 'The complexity of the task (0-1)'
              },
              priority: {
                type: 'string' as const,
                enum: ['speed', 'cost', 'quality'],
                description: 'The priority for this task'
              },
              preemptive: {
                type: 'boolean' as const,
                description: 'Whether to force an update of models'
              }
            },
            required: []
          }
        },
        {
          name: 'clear_openrouter_tracking',
          description: 'Clear OpenRouter tracking data and force an update',
          inputSchema: {
            type: 'object' as const,
            properties: {
              task: {
                type: 'string' as const,
                description: 'Unused but required for type compatibility'
              },
              context_length: {
                type: 'number' as const,
                description: 'Unused but required for type compatibility'
              },
              expected_output_length: {
                type: 'number' as const,
                description: 'Unused but required for type compatibility'
              },
              complexity: {
                type: 'number' as const,
                description: 'Unused but required for type compatibility'
              },
              priority: {
                type: 'string' as const,
                enum: ['speed', 'cost', 'quality'],
                description: 'Unused but required for type compatibility'
              }
            },
            required: []
          }
        },
        {
          name: 'benchmark_free_models',
          description: 'Benchmark the performance of free models from OpenRouter',
          inputSchema: {
            type: 'object' as const,
            properties: {
              tasks: {
                type: 'array' as const,
                items: {
                  type: 'object' as const,
                  properties: {
                    task_id: {
                      type: 'string' as const,
                      description: 'A unique identifier for the task'
                    },
                    task: {
                      type: 'string' as const,
                      description: 'The coding task to benchmark'
                    },
                    context_length: {
                      type: 'number' as const,
                      description: 'The length of the context in tokens'
                    },
                    expected_output_length: {
                      type: 'number' as const,
                      description: 'The expected length of the output in tokens'
                    },
                    complexity: {
                      type: 'number' as const,
                      description: 'The complexity of the task (0-1)'
                    },
                    local_model: {
                      type: 'string' as const,
                      description: 'The local model to use (optional)'
                    },
                    paid_model: {
                      type: 'string' as const,
                      description: 'The paid model to use (optional)'
                    }
                  },
                  required: ['task_id', 'task', 'context_length']
                },
                description: 'Array of tasks to benchmark'
              },
              runs_per_task: {
                type: 'number' as const,
                description: 'Number of runs per task for more accurate results (optional)'
              },
              parallel: {
                type: 'boolean' as const,
                description: 'Whether to run tasks in parallel (optional)'
              },
              max_parallel_tasks: {
                type: 'number' as const,
                description: 'Maximum number of parallel tasks (optional)'
              }
            },
            required: ['tasks']
          }
        },
        {
          name: 'set_model_prompting_strategy',
          description: 'Update the prompting strategy for an OpenRouter model',
          inputSchema: {
            type: 'object' as const,
            properties: {
              task: {
                type: 'string' as const,
                description: 'The ID of the model to update'
              },
              context_length: {
                type: 'number' as const,
                description: 'Unused but required for type compatibility'
              },
              expected_output_length: {
                type: 'number' as const,
                description: 'The system prompt to use'
              },
              priority: {
                type: 'string' as const,
                enum: ['speed', 'cost', 'quality'],
                description: 'The user prompt template to use'
              },
              complexity: {
                type: 'number' as const,
                description: 'The assistant prompt template to use'
              },
              preemptive: {
                type: 'boolean' as const,
                description: 'Whether to use chat format'
              }
            },
            required: ['task', 'context_length', 'expected_output_length', 'priority', 'complexity', 'preemptive']
          }
        }
      );
    }

    return tools;
  }
}

// Export singleton instance
export const toolDefinitionProvider = new ToolDefinitionProvider();

// Export provider interface for type checking
export type { IToolDefinitionProvider };