import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { IToolDefinitionProvider, ITool } from './types.js';
import { logger } from '../../../utils/logger.js';
import { config } from '../../../config/index.js';
import { execSync } from 'child_process';

/**
 * Check if Python is installed and available
 */
function isPythonAvailable(): boolean {
  try {
    execSync('python --version', { stdio: 'pipe' });
    return true;
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error(`Python not available: ${errorMessage}`);
    try {
      execSync('python3 --version', { stdio: 'pipe' });
      return true;
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error(`Python3 not available: ${errorMessage}`);
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
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error(`Python module ${moduleName} not installed: ${errorMessage}`);
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
        description: 'Processes a coding task: decomposes if necessary, executes subtasks using appropriate models (local/free/paid based on routing), synthesizes the results, and returns the final code.',
        inputSchema: {
          type: 'object',
          properties: {
            task: {
              type: 'string',
              description: 'The coding task to route'
            },
            context_length: {
              type: 'number',
              description: 'The length of the context in tokens'
            },
            expected_output_length: {
              type: 'number',
              description: 'The expected length of the output in tokens'
            },
            complexity: {
              type: 'number',
              description: 'The complexity of the task (0-1)'
            },
            priority: {
              type: 'string',
              enum: ['speed', 'cost', 'quality'],
              description: 'The priority for this task'
            },
            preemptive: {
              type: 'boolean',
              description: 'Whether to use preemptive routing (faster but less accurate)'
            }
          },
          required: ['task', 'context_length']
        },
        outputSchema: {
          type: 'object',
          properties: {
            model: {
              type: 'string',
              description: 'The final model used for the last step or synthesis.'
            },
            provider: {
              type: 'string',
              description: 'The provider of the final model used.'
            },
            reason: {
              type: 'string',
              description: 'Explanation of the routing and execution process.'
            },
            resultCode: {
              type: 'string',
              description: 'The final synthesized code result.'
            },
            estimatedCost: {
              type: 'number',
              description: 'Estimated cost in USD for the task execution (optional).'
            },
            details: {
              type: 'object',
              description: 'Optional details about the execution process (e.g., cost breakdown, subtask analysis).',
              properties: {
                // Define specific details properties if needed, e.g.:
                // costEstimate: { type: 'object' },
                // taskAnalysis: { type: 'object' }
              }
            }
          },
          required: ['model', 'provider', 'reason', 'resultCode']
        }
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
              description: 'Array of directories to index'
            },
            exclude_patterns: {
              type: 'array',
              items: {
                type: 'string'
              },
              description: 'Array of glob patterns to exclude from indexing'
            },
            chunk_size: {
              type: 'number',
              description: 'Size of chunks for large files (in lines)'
            },
            force_reindex: {
              type: 'boolean',
              description: 'Whether to force reindexing of all files'
            },
            bm25_options: {
              type: 'object',
              description: 'Options for the BM25 algorithm'
            },
            install_dependencies: {
              type: 'boolean',
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
          type: 'object',
          properties: {
            job_id: {
              type: 'string',
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
          type: 'object',
          properties: {
            task: {
              type: 'string',
              description: 'The coding task to route'
            },
            context_length: {
              type: 'number',
              description: 'The length of the context in tokens'
            },
            expected_output_length: {
              type: 'number',
              description: 'The expected length of the output in tokens'
            },
            complexity: {
              type: 'number',
              description: 'The complexity of the task (0-1)'
            },
            priority: {
              type: 'string',
              enum: ['speed', 'cost', 'quality'],
              description: 'The priority for this task'
            }
          },
          required: ['task', 'context_length']
        }, // <<< Add comma here
        outputSchema: { // <<< Add outputSchema here
          type: 'object',
          properties: {
            model: {
              type: 'string',
              description: 'The final model used for the last step or synthesis.'
            },
            provider: {
              type: 'string',
              description: 'The provider of the final model used.'
            },
            reason: {
              type: 'string',
              description: 'Explanation of the routing and execution process.'
            },
            resultCode: {
              type: 'string',
              description: 'The final synthesized code result.'
            },
            estimatedCost: {
              type: 'number',
              description: 'Estimated cost in USD for the task execution.'
            },
            details: {
              type: 'object',
              description: 'Optional details about the execution process.',
              properties: {
                // Add properties from RouteTaskResult['details'] if needed
                // e.g., costEstimate, retrivResults, taskAnalysis
              }
            }
          },
          required: ['model', 'provider', 'reason', 'resultCode']
        }
      },
      {
        name: 'get_cost_estimate',
        description: 'Get an estimate of the cost for a task',
        inputSchema: {
          type: 'object',
          properties: {
            context_length: {
              type: 'number',
              description: 'The length of the context in tokens'
            },
            expected_output_length: {
              type: 'number',
              description: 'The expected length of the output in tokens'
            },
            model: {
              type: 'string',
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
          type: 'object',
          properties: {
            task_id: {
              type: 'string',
              description: 'A unique identifier for the task'
            },
            task: {
              type: 'string',
              description: 'The coding task to benchmark'
            },
            context_length: {
              type: 'number',
              description: 'The length of the context in tokens'
            },
            expected_output_length: {
              type: 'number',
              description: 'The expected length of the output in tokens'
            },
            complexity: {
              type: 'number',
              description: 'The complexity of the task (0-1)'
            },
            local_model: {
              type: 'string',
              description: 'The local model to use (optional)'
            },
            paid_model: {
              type: 'string',
              description: 'The paid model to use (optional)'
            },
            runs_per_task: {
              type: 'number',
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
          type: 'object',
          properties: {
            tasks: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  task_id: {
                    type: 'string',
                    description: 'A unique identifier for the task'
                  },
                  task: {
                    type: 'string',
                    description: 'The coding task to benchmark'
                  },
                  context_length: {
                    type: 'number',
                    description: 'The length of the context in tokens'
                  },
                  expected_output_length: {
                    type: 'number',
                    description: 'The expected length of the output in tokens'
                  },
                  complexity: {
                    type: 'number',
                    description: 'The complexity of the task (0-1)'
                  },
                  local_model: {
                    type: 'string',
                    description: 'The local model to use (optional)'
                  },
                  paid_model: {
                    type: 'string',
                    description: 'The paid model to use (optional)'
                  }
                },
                required: ['task_id', 'task', 'context_length']
              },
              description: 'Array of tasks to benchmark'
            },
            runs_per_task: {
              type: 'number',
              description: 'Number of runs per task for more accurate results (optional)'
            },
            parallel: {
              type: 'boolean',
              description: 'Whether to run tasks in parallel (optional)'
            },
            max_parallel_tasks: {
              type: 'number',
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
                description: 'Array of directories to index'
              },
              exclude_patterns: {
                type: 'array',
                items: {
                  type: 'string'
                },
                description: 'Array of glob patterns to exclude from indexing'
              },
              chunk_size: {
                type: 'number',
                description: 'Size of chunks for large files (in lines)'
              },
              force_reindex: {
                type: 'boolean',
                description: 'Whether to force reindexing of all files'
              },
              bm25_options: {
                type: 'object',
                description: 'Options for the BM25 algorithm'
              },
              install_dependencies: {
                type: 'boolean',
                description: 'Whether to automatically install required Python dependencies'
              }
            },
            required: ['directories']
          }
        },
        {
          name: 'retriv_search',
          description: 'Search code using Retriv search engine',
          inputSchema: {
            type: 'object',
            properties: {
              query: {
                type: 'string',
                description: 'Search query'
              },
              limit: {
                type: 'number',
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
            type: 'object',
            properties: {
              task: {
                type: 'string',
                description: 'The coding task to route'
              },
              context_length: {
                type: 'number',
                description: 'The length of the context in tokens'
              },
              expected_output_length: {
                type: 'number',
                description: 'The expected length of the output in tokens'
              },
              complexity: {
                type: 'number',
                description: 'The complexity of the task (0-1)'
              },
              priority: {
                type: 'string',
                enum: ['speed', 'cost', 'quality'],
                description: 'The priority for this task'
              },
              preemptive: {
                type: 'boolean',
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
            type: 'object',
            properties: {
              task: {
                type: 'string',
                description: 'Unused but required for type compatibility'
              },
              context_length: {
                type: 'number',
                description: 'Unused but required for type compatibility'
              },
              expected_output_length: {
                type: 'number',
                description: 'Unused but required for type compatibility'
              },
              complexity: {
                type: 'number',
                description: 'Unused but required for type compatibility'
              },
              priority: {
                type: 'string',
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
            type: 'object',
            properties: {
              tasks: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    task_id: {
                      type: 'string',
                      description: 'A unique identifier for the task'
                    },
                    task: {
                      type: 'string',
                      description: 'The coding task to benchmark'
                    },
                    context_length: {
                      type: 'number',
                      description: 'The length of the context in tokens'
                    },
                    expected_output_length: {
                      type: 'number',
                      description: 'The expected length of the output in tokens'
                    },
                    complexity: {
                      type: 'number',
                      description: 'The complexity of the task (0-1)'
                    },
                    local_model: {
                      type: 'string',
                      description: 'The local model to use (optional)'
                    },
                    paid_model: {
                      type: 'string',
                      description: 'The paid model to use (optional)'
                    }
                  },
                  required: ['task_id', 'task', 'context_length']
                },
                description: 'Array of tasks to benchmark'
              },
              runs_per_task: {
                type: 'number',
                description: 'Number of runs per task for more accurate results (optional)'
              },
              parallel: {
                type: 'boolean',
                description: 'Whether to run tasks in parallel (optional)'
              },
              max_parallel_tasks: {
                type: 'number',
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
            type: 'object',
            properties: {
              task: {
                type: 'string',
                description: 'The ID of the model to update'
              },
              context_length: {
                type: 'number',
                description: 'Unused but required for type compatibility'
              },
              expected_output_length: {
                type: 'number',
                description: 'The system prompt to use'
              },
              priority: {
                type: 'string',
                enum: ['speed', 'cost', 'quality'],
                description: 'The user prompt template to use'
              },
              complexity: {
                type: 'number',
                description: 'The assistant prompt template to use'
              },
              preemptive: {
                type: 'boolean',
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