/**
 * Main export file for the API integration module
 * Re-exports all functionality from sub-modules
 */
// Re-export from tool-definition module
export * from './tool-definition/index.js';

// Re-export from task-execution module
import { taskExecutor, executeTask as taskExecuteTask } from './task-execution/index.js';
export { taskExecutor };
export { taskExecuteTask as executeTask };

// Re-export from retriv-integration module
export * from './retriv-integration/index.js';

// Re-export from openrouter-integration module
import { 
  openRouterIntegration,
  isOpenRouterConfigured as orIsOpenRouterConfigured,
  executeTask as orExecuteTask, 
  getFreeModels as orGetFreeModels
} from './openrouter-integration/index.js';
export { 
  openRouterIntegration,
  orIsOpenRouterConfigured,
  orExecuteTask, 
  orGetFreeModels
};

// Re-export from cost-estimation module
import { 
  costEstimator, 
  estimateCost,
  getFreeModels as ceGetFreeModels,
  getModelCosts
} from './cost-estimation/index.js';
export { 
  costEstimator, 
  estimateCost,
  ceGetFreeModels,
  getModelCosts
};

// Re-export from routing module
export * from './routing/index.js';

// For backward compatibility, re-export the setupToolHandlers and isOpenRouterConfigured functions
import { toolDefinitionProvider } from './tool-definition/index.js';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';

/**
 * Set up tool handlers for the MCP Server
 * @deprecated Use the tool-definition module's toolDefinitionProvider instead
 */
export function setupToolHandlers(server: Server): void {
  return toolDefinitionProvider.initialize(server);
}

// Re-export isOpenRouterConfigured for backward compatibility
export { isOpenRouterConfigured } from './tool-definition/index.js';