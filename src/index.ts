#!/usr/bin/env node
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { setupResourceHandlers } from './modules/api-integration/resources.js';
import { toolDefinitionProvider } from './modules/api-integration/tool-definition/index.js';
import { logger } from './utils/logger.js';
import { readFileSync } from 'fs';
import { join, dirname, resolve } from 'path';
import { fileURLToPath } from 'url';
import type { RouteTaskParams } from './modules/api-integration/routing/types.js';
import type { CostEstimationParams } from './modules/api-integration/cost-estimation/types.js';
import type { OpenRouterBenchmarkConfig } from './modules/api-integration/openrouter-integration/types.js';
import { createLockFile, isLockFilePresent, removeLockFile, getLockFileInfo } from './utils/lock-file.js';
import type { LockFileInfo } from './utils/lock-file.js';
import { setClientHints } from './modules/core/client/hints.js';

// Get the current file's directory path in ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Read version from package.json - adjust path to point directly to the project root
interface PackageJson {
  version: string;
  [key: string]: unknown;
}

const packageJsonContent = readFileSync(join(__dirname, '../package.json'), 'utf8');
const packageJson = JSON.parse(packageJsonContent) as PackageJson;
const version = packageJson.version;

/**
 * LocalLama MCP Server
 * 
 * This MCP Server works with Cline.Bot to optimize costs by intelligently
 * routing coding tasks between local LLMs and paid APIs.
 */
export class LocalLamaMcpServer {
  private server: Server;
  private isShuttingDown = false;
  
  constructor() {
    this.server = new Server(
      {
        name: 'locallama-mcp',
        version,
      },
      {
        capabilities: {
          resources: {},
          tools: {},
        },
      }
    );
    
    // Set up resource and tool handlers
    toolDefinitionProvider.initialize(this.server);

    // Set up handler for tool calls
    this.setupToolCallHandler();
    
    // Error handling
    this.server.onerror = (error) => logger.error('[MCP Error]', error);
    
    // Handle process termination signals
    this.setupProcessSignalHandlers();
  }

  /**
   * Set up process signal handlers to ensure clean shutdown
   */
  private setupProcessSignalHandlers(): void {
    const signals = ['SIGINT', 'SIGTERM', 'SIGHUP'] as const;
    
    signals.forEach(signal => {
      process.on(signal, () => {
        if (this.isShuttingDown) return;
        this.isShuttingDown = true;
        
        logger.info(`Received ${signal}, shutting down gracefully...`);
        
        // Use Promise.resolve to handle the async shutdown without issues in the event handler
        Promise.resolve(this.shutdown())
          .then(() => process.exit(0))
          .catch(err => {
            logger.error(`Error during shutdown after ${signal}:`, err);
            process.exit(1);
          });
      });
    });

    // Handle uncaught exceptions and unhandled promise rejections
    process.on('uncaughtException', (err) => {
      logger.error('Uncaught exception:', err);
      
      if (this.isShuttingDown) return;
      this.isShuttingDown = true;
      
      // Use Promise.resolve to handle the async shutdown without issues in the event handler
      Promise.resolve(this.shutdown())
        .then(() => process.exit(1))
        .catch(() => process.exit(1));
    });

    process.on('unhandledRejection', (reason) => {
      logger.error('Unhandled promise rejection:', reason);
      
      if (this.isShuttingDown) return;
      this.isShuttingDown = true;
      
      // Use Promise.resolve to handle the async shutdown without issues in the event handler
      Promise.resolve(this.shutdown())
        .then(() => process.exit(1))
        .catch(() => process.exit(1));
    });
  }

  /**
   * Clean shutdown procedure
   */
  private async shutdown(): Promise<void> {
    logger.info('Shutting down LocalLama MCP Server...');
    try {
      await this.server.close();
      logger.info('Server closed successfully');
    } catch (err) {
      logger.error('Error during server close:', err);
    } finally {
      removeLockFile();
    }
  }

  /**
   * Set up handler for tool calls
   * This connects the tool definitions to their implementations
   */
  private setupToolCallHandler(): void {
    // Import necessary modules for tool implementations
    import('./modules/api-integration/routing/index.js').then((routingModule) => {
      import('./modules/api-integration/cost-estimation/index.js').then((costModule) => {
        
        // Set up the handler for tool calls
        this.server.setRequestHandler(CallToolRequestSchema, async (request, _extra) => {
          const { name, arguments: args } = request.params;
          
          logger.debug(`Tool call received: ${name} with args: ${JSON.stringify(args)}`);
          
          try {
            // Route to the appropriate implementation based on tool name
            const result = await (async () => {
              // Safe type conversion helpers
              const ensureRouteTaskParams = (args: Record<string, unknown> | undefined): RouteTaskParams => {
                if (!args?.task || typeof args.task !== 'string' || !args?.context_length || typeof args.context_length !== 'number') {
                  throw new Error('Invalid arguments for route_task');
                }
                return {
                  task: args.task,
                  contextLength: args.context_length,
                  expectedOutputLength: args.expected_output_length as number | undefined,
                  complexity: args.complexity as number | undefined,
                  priority: args.priority as 'speed' | 'cost' | 'quality' | undefined,
                  preemptive: args.preemptive as boolean | undefined
                };
              };

              const ensureCostEstimationParams = (args: Record<string, unknown> | undefined): CostEstimationParams => {
                if (!args?.context_length || typeof args.context_length !== 'number') {
                  throw new Error('Invalid arguments for get_cost_estimate');
                }
                return {
                  contextLength: args.context_length,
                  outputLength: args.expected_output_length as number | undefined,
                  model: args.model as string | undefined
                };
              };

              const ensureBenchmarkConfig = (args: Record<string, unknown> | undefined): OpenRouterBenchmarkConfig => {
                if (!args?.tasks || !Array.isArray(args.tasks)) {
                  throw new Error('Invalid arguments for benchmark_free_models');
                }
                
                // Ensure each task has the required properties
                const tasks = args.tasks.map(task => {
                  if (typeof task !== 'object' || !task || task === null) {
                    throw new Error('Invalid benchmark task format');
                  }
                  
                  const taskObj = task as Record<string, unknown>;
                  
                  if (!taskObj.task_id || !taskObj.task || !taskObj.context_length ||
                      typeof taskObj.task_id !== 'string' || typeof taskObj.task !== 'string') {
                    throw new Error('Missing required benchmark task properties or invalid types');
                  }

                  return {
                    taskId: taskObj.task_id,
                    task: taskObj.task,
                    contextLength: Number(taskObj.context_length),
                    expectedOutputLength: taskObj.expected_output_length ? Number(taskObj.expected_output_length) : undefined,
                    complexity: taskObj.complexity ? Number(taskObj.complexity) : undefined,
                    localModel: typeof taskObj.local_model === 'string' ? taskObj.local_model : undefined,
                    paidModel: typeof taskObj.paid_model === 'string' ? taskObj.paid_model : undefined
                  };
                });

                return {
                  tasks,
                  runsPerTask: args.runs_per_task ? Number(args.runs_per_task) : undefined,
                  parallel: Boolean(args.parallel),
                  maxParallelTasks: args.max_parallel_tasks ? Number(args.max_parallel_tasks) : undefined
                };
              };

              switch (name) {
                case 'route_task': {
                  const routeResult = await routingModule.routeTask(ensureRouteTaskParams(args));
                  return {
                    costClass: routeResult.costClass,
                    providerId: routeResult.providerId,
                    modelId: routeResult.model,
                    content: routeResult.resultCode,
                    reason: routeResult.reason,
                    estimatedCost: routeResult.estimatedCost,
                  };
                }
                case 'preemptive_route_task': {
                  const preemptiveResult = await routingModule.preemptiveRouteTask(ensureRouteTaskParams(args));
                  return {
                    costClass: preemptiveResult.costClass,
                    providerId: preemptiveResult.providerId,
                    modelId: preemptiveResult.model,
                    reason: preemptiveResult.reason,
                  };
                }
                case 'get_cost_estimate':
                  return await costModule.estimateCost(ensureCostEstimationParams(args));
                case 'cancel_job': {
                  const jobId = args?.job_id;
                  if (typeof jobId !== 'string') {
                    throw new Error('Invalid job_id for cancel_job');
                  }
                  return await routingModule.cancelJob(jobId);
                }
                case 'get_free_models':
                  return await import('./modules/api-integration/openrouter-integration/index.js')
                    .then(module => module.getFreeModels(Boolean(args?.preemptive)));
                case 'benchmark_free_models':
                  return await import('./modules/api-integration/openrouter-integration/index.js')
                    .then(module => module.benchmarkFreeModels(ensureBenchmarkConfig(args)));
                case 'set_model_prompting_strategy': {
                  const modelId = args?.model_id;
                  if (typeof modelId !== 'string' || !modelId) {
                    throw new Error('Invalid model_id for set_model_prompting_strategy');
                  }
                  const systemPrompt = args?.system_prompt;
                  const userPrompt = args?.user_prompt;
                  if (typeof systemPrompt !== 'string' || typeof userPrompt !== 'string') {
                    throw new Error('system_prompt and user_prompt must be strings');
                  }
                  const assistantPrompt = typeof args?.assistant_prompt === 'string' ? args.assistant_prompt : '';
                  const useChat = typeof args?.use_chat === 'boolean' ? args.use_chat : true;
                  const successRate = typeof args?.success_rate === 'number' ? args.success_rate : 0.7;
                  const qualityScore = typeof args?.quality_score === 'number' ? args.quality_score : 0.7;
                  return await import('./modules/api-integration/openrouter-integration/index.js')
                    .then(module => module.updatePromptingStrategy(
                      modelId,
                      { systemPrompt, userPrompt, assistantPrompt, useChat },
                      successRate,
                      qualityScore
                    ));
                }
                case 'benchmark_model': {
                  const modelId = args?.model_id;
                  if (typeof modelId !== 'string' || !modelId) {
                    throw new Error('Invalid model_id for benchmark_model');
                  }
                  const rawCategories = args?.task_categories;
                  const taskCategories = Array.isArray(rawCategories)
                    ? rawCategories.filter((c): c is string => typeof c === 'string')
                    : undefined;
                  const { benchmarkModel } = await import('./modules/benchmark/core/model-benchmarker.js');
                  return await benchmarkModel({ modelId, taskCategories: taskCategories as import('./modules/benchmark/core/model-benchmarker.js').TaskCategory[] | undefined });
                }
                default:
                  logger.error(`Unknown tool: ${name}`);
                  throw new Error(`Unknown tool: ${name}`);
              }
            })();

            // Return the result in MCP CallToolResult format.
            // content[0].text carries the JSON-serialized payload so schema-aware
            // clients (Claude Code, Codex, Copilot) can parse structured fields
            // (costClass, providerId, modelId, …) while plain-text clients still
            // get a readable string.
            const textContent = typeof result === 'string'
              ? result
              : JSON.stringify(result, null, 2);
            return {
              content: [{ type: 'text' as const, text: textContent }]
            };
          } catch (error) {
            logger.error(`Error executing tool ${name}:`, error);
            throw error;
          }
        });
        
        logger.info('Tool call handler initialized successfully');
      }).catch(error => {
        logger.error('Failed to import cost-estimation module:', error);
      });
    }).catch(error => {
      logger.error('Failed to import routing module:', error);
    });
  }

  async run(): Promise<void> {
    try {
      // Check if another instance is already running
      if (isLockFilePresent()) {
        const lockInfo: LockFileInfo | null = getLockFileInfo();
        
        // Check if the process in the lock file is still running
        try {
          const isProcessRunning = await import('./utils/lock-file.js').then(
            module => module.isLockFileProcessRunning()
          );
          
          if (isProcessRunning) {
            // The other server instance is still running
            logger.info(`Another instance of LocalLama MCP Server is already running.`);
            logger.info(`Process: ${lockInfo?.pid || 'unknown'}, Started: ${lockInfo?.startTime || 'unknown'}`);
            if (lockInfo?.connectionInfo) {
              logger.info(`Connection Info: ${lockInfo.connectionInfo}`);
            }
            logger.info(`This process will exit and requests will be directed to the existing instance.`);
            process.exit(0);
            return;
          } else {
            // The lock file exists but the process is not running (stale lock file)
            logger.info(`Found a stale lock file from a terminated server instance. Removing it.`);
            removeLockFile();
          }
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : String(error);
          logger.error('Error checking if lock file process is running:', errorMessage);
          logger.error('Lock file details:', lockInfo);
          throw error;
        }
      }
      
      // No lock file or stale lock file was removed, continue starting the server

      // Connection information for the lock file
      const connectionInfo = `LocalLama MCP Server running on stdio`;

      // Create lock file with current process info and connection details
      createLockFile({ connectionInfo });

      // Bootstrap the provider registry before anything that needs to know which
      // providers exist (decision engine, tool listing). Provider init failures
      // are isolated inside registry.initAll().
      try {
        // Initialize the PromptingStrategyService (Section 4) BEFORE provider init
        // so that getDefaultPromptingStrategy() calls inside provider.init() can
        // resolve strategy ids from the central JSON.
        const { getPromptingStrategyService } = await import('./modules/core/prompting/service.js');
        const promptingService = getPromptingStrategyService();
        await promptingService.loadFromFile();
        logger.info(`PromptingStrategyService loaded ${promptingService.listStrategies().length} strategies`);

        const { getProviderRegistry } = await import('./modules/core/provider/index.js');
        const registry = getProviderRegistry();
        const { lmStudioProvider } = await import('./modules/lm-studio/provider.js');
        const { ollamaProvider } = await import('./modules/ollama/provider.js');
        registry.register(lmStudioProvider);
        registry.register(ollamaProvider);
        const { config: cfg } = await import('./config/index.js');
        if (cfg.openRouterApiKey) {
          const { openRouterProvider } = await import('./modules/openrouter/provider.js');
          registry.register(openRouterProvider);
        }
        const ready = await registry.initAll();
        logger.info(`Provider registry initialized: [${ready.join(', ')}]`);

        // Seed the ModelRegistry with models from every initialized provider.
        // Errors from a single provider's listModels() are isolated.
        const { getModelRegistry } = await import('./modules/core/model/index.js');
        const modelRegistry = getModelRegistry();
        modelRegistry.setPromptingService(promptingService); // Section 4: strategy resolution
        await modelRegistry.loadFromConfigFile(); // load models.json overrides
        for (const providerId of ready) {
          const provider = registry.get(providerId);
          if (!provider) continue;
          try {
            const models = await provider.listModels();
            modelRegistry.seedFromProvider(provider, models);
            logger.info(
              `ModelRegistry seeded ${models.length} model(s) from provider '${providerId}'`,
            );
          } catch (err) {
            logger.warn(
              `ModelRegistry: listModels() failed for provider '${providerId}': ${
                err instanceof Error ? err.message : String(err)
              }`,
            );
          }
        }

        // Initialize the CapabilityDetector singleton (Section 5) now that
        // the registry is populated with heuristic + declared capabilities.
        const { initCapabilityDetector } = await import('./modules/core/capability-detector.js');
        initCapabilityDetector(modelRegistry);
        logger.info('CapabilityDetector initialized');
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        logger.error('Failed to bootstrap provider registry:', errorMessage);
        throw error;
      }

      // Initialize the decision engine
      const { decisionEngine } = await import('./modules/decision-engine/index.js');
      try {
        await decisionEngine.initialize();
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        logger.error('Failed to initialize decision engine:', errorMessage);
        logger.error('Error details:', error);
        throw error;
      }

      // Set up resource and tool handlers
      try {
        await setupResourceHandlers(this.server);
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        logger.error('Failed to set up resource handlers:', errorMessage);
        logger.error('Error details:', error);
        throw error;
      }
      
      logger.info('Starting LocalLama MCP Server...');
      const transport = new StdioServerTransport();
      await this.server.connect(transport);

      // Capture the connected client's name for per-client behavioral hints.
      // getClientVersion() is populated after the initialize handshake completes.
      const clientImpl = this.server.getClientVersion();
      setClientHints(clientImpl?.name);
      if (clientImpl?.name) {
        logger.info(`MCP client identified: ${clientImpl.name} ${clientImpl.version ?? ''}`.trim());
      }

      logger.info(`${connectionInfo} (PID: ${process.pid})`);
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error('Server initialization failed:', errorMessage);
      logger.error('Error details:', error);
      removeLockFile();
      process.exit(1);
    }
  }
}

const isMainModule = process.argv[1] !== undefined && resolve(process.argv[1]) === __filename;

if (isMainModule) {
  const server = new LocalLamaMcpServer();
  server.run().catch((error: unknown) => {
    logger.error('Unhandled error during server execution:', error instanceof Error ? error.message : String(error));
    removeLockFile();
    process.exit(1);
  });
}
