import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { IToolDefinitionProvider, ITool } from './types.js';
import { logger } from '../../../utils/logger.js';
import { config } from '../../../config/index.js';
import { getProviderRegistry } from '../../core/provider/index.js';
import { execSync } from 'child_process';

/**
 * Check if Python is installed and available (tries python3 then python)
 */
function isPythonAvailable(): boolean {
  for (const cmd of ['python3', 'python', 'py']) {
    try {
      execSync(`${cmd} --version`, { stdio: 'pipe' });
      return true;
    } catch {
      continue;
    }
  }
  logger.error('Python not available: no python3, python, or py command found');
  return false;
}

/**
 * Check if a Python module is installed (tries python3 then python)
 */
function isPythonModuleInstalled(moduleName: string): boolean {
  for (const cmd of ['python3', 'python', 'py']) {
    try {
      execSync(`${cmd} -c "import ${moduleName}"`, { stdio: 'pipe' });
      return true;
    } catch {
      continue;
    }
  }
  logger.warn(`Python module ${moduleName} not installed (checked python3, python, py) — related tools will be disabled`);
  return false;
}

/**
 * Whether OpenRouter is available as a provider. Prefers the runtime
 * provider registry (set up by `LocalLamaMcpServer.run()`); falls back to the
 * raw env config so that callers running before bootstrap (e.g. unit tests
 * that import this module directly) still get a sensible answer.
 */
export function isOpenRouterConfigured(): boolean {
  if (getProviderRegistry().has('openrouter')) return true;
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
        description:
          'Delegate a coding task to the most cost-effective LLM available. ' +
          'Prefers local models (LM Studio / Ollama) when they are capable enough, ' +
          'falling back to free or paid API models only when needed. ' +
          'Decomposes complex tasks into subtasks, executes them, synthesises the result, ' +
          'and returns structured JSON with the code, the model used, its cost class ' +
          '("local" | "free" | "paid"), and the estimated cost. ' +
          'Use this tool when you want the task actually executed, not just planned.',
        inputSchema: {
          type: 'object',
          properties: {
            task: {
              type: 'string',
              description: 'The coding task to execute (free-form natural language or code prompt).'
            },
            context_length: {
              type: 'number',
              description: 'Number of tokens in the prompt / context being sent.'
            },
            expected_output_length: {
              type: 'number',
              description: 'Estimated number of tokens in the desired output (helps cost estimation and model selection). Omit if unknown.'
            },
            complexity: {
              type: 'number',
              description: 'Task complexity score from 0.0 (trivial) to 1.0 (very hard). Omit to let the router estimate it automatically.'
            },
            priority: {
              type: 'string',
              enum: ['speed', 'cost', 'quality'],
              description: '"speed" – pick the fastest responding model. "cost" – minimise API spend (prefers local/free). "quality" – pick the highest quality model regardless of cost. Default: "quality".'
            },
            preemptive: {
              type: 'boolean',
              description: 'If true, use a fast heuristic pre-check for routing instead of full analysis. Faster but less accurate; useful when latency matters more than optimality.'
            }
          },
          required: ['task', 'context_length']
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
        description: 'Cancel a running background job. Returns the job id, whether cancellation succeeded, and the final status.',
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
        description:
          'Cheap model-selection check that returns a routing recommendation WITHOUT executing the task. ' +
          'Call this when you only need to know which model and provider would be chosen (for UI feedback, ' +
          'cost planning, or logging) and will call route_task separately for actual execution. ' +
          'Much faster than route_task because it uses a heuristic scoring model with no LLM API calls. ' +
          'Returns structured JSON with costClass, providerId, modelId and reason — same shape as route_task ' +
          'but content is always empty.',
        inputSchema: {
          type: 'object',
          properties: {
            task: {
              type: 'string',
              description: 'The coding task description (used for complexity estimation).'
            },
            context_length: {
              type: 'number',
              description: 'Number of tokens in the prompt / context.'
            },
            expected_output_length: {
              type: 'number',
              description: 'Estimated output length in tokens. Omit if unknown.'
            },
            complexity: {
              type: 'number',
              description: 'Task complexity from 0.0 (trivial) to 1.0 (very hard). Omit to estimate automatically.'
            },
            priority: {
              type: 'string',
              enum: ['speed', 'cost', 'quality'],
              description: 'Routing priority. Default: "quality".'
            }
          },
          required: ['task', 'context_length']
        }
      },
      {
        name: 'get_cost_estimate',
        description:
          'Returns a structured JSON cost estimate for running a given number of tokens through the router. ' +
          'Use this before calling route_task to decide whether to proceed or reduce the request size. ' +
          'All cost fields are in USD; local and free-tier models report 0.',
        inputSchema: {
          type: 'object',
          properties: {
            context_length: {
              type: 'number',
              description: 'Number of tokens in the prompt / context.'
            },
            expected_output_length: {
              type: 'number',
              description: 'Estimated output length in tokens. Omit if unknown; defaults to 0.'
            },
            model: {
              type: 'string',
              description: 'Specific model id to estimate cost for. Omit to estimate for all registered models.'
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
      },
      {
        name: 'benchmark_model',
        description: 'Run built-in benchmark suites against a specific model identified by its model id. ' +
          'Uses the provider abstraction so it works with any registered provider (LM Studio, Ollama, OpenRouter, etc.). ' +
          'Results are persisted to the benchmark database and immediately update the ModelRegistry capability scores.',
        inputSchema: {
          type: 'object',
          properties: {
            model_id: {
              type: 'string',
              description: 'The model id to benchmark (e.g. "qwen2.5-coder-7b")'
            },
            task_categories: {
              type: 'array',
              items: {
                type: 'string',
                enum: ['code', 'chat', 'tool-use', 'long-context']
              },
              description: 'Which task categories to run. Defaults to ["code", "chat"] when omitted.'
            }
          },
          required: ['model_id']
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
          description: 'Update the prompting strategy used for a specific OpenRouter model. Allows callers to supply a custom system prompt, user prompt template, and assistant prompt template that will be used on subsequent task executions for that model.',
          inputSchema: {
            type: 'object',
            properties: {
              model_id: {
                type: 'string',
                description: 'The OpenRouter model ID to update (e.g. "mistralai/mistral-7b-instruct")'
              },
              system_prompt: {
                type: 'string',
                description: 'System prompt to inject before every request to this model'
              },
              user_prompt: {
                type: 'string',
                description: 'User prompt template (use {{task}} as the placeholder for the task text)'
              },
              assistant_prompt: {
                type: 'string',
                description: 'Optional assistant prompt template to prime the model response'
              },
              use_chat: {
                type: 'boolean',
                description: 'Whether to use the chat completion API format (true) or the completion API format (false)'
              },
              success_rate: {
                type: 'number',
                description: 'Observed success rate for this strategy (0–1). Used to score the strategy in future routing decisions. Defaults to 0.7 if omitted.'
              },
              quality_score: {
                type: 'number',
                description: 'Observed quality score for this strategy (0–1). Used to score the strategy in future routing decisions. Defaults to 0.7 if omitted.'
              }
            },
            required: ['model_id', 'system_prompt', 'user_prompt', 'use_chat']
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