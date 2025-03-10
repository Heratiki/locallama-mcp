// filepath: /home/heratiki/Source/locallama-mcp/src/modules/api-integration/index.ts

/**
 * Main export file for the API integration module
 * Re-exports all functionality from sub-modules
 */

// Re-export from tool-definition module
export * from './tool-definition/index.js';

// Re-export from task-execution module
// Will be uncommented as modules are implemented
// export * from './task-execution/index.js';

// Re-export from retriv-integration module
// export * from './retriv-integration/index.js';

// Re-export from openrouter-integration module
// export * from './openrouter-integration/index.js';

// Re-export from cost-estimation module
// export * from './cost-estimation/index.js';

// Re-export from routing module
// export * from './routing/index.js';

// Re-export specific items from tools.ts for backward compatibility
import { setupToolHandlers as originalSetupToolHandlers } from './tools.js';

/**
 * Set up tool handlers for the MCP Server
 * @deprecated Use the tool-definition module's toolDefinitionProvider instead
 */
export function setupToolHandlers(server: any): void {
  // For now, use the original implementation
  // This will be updated as modules are implemented
  return originalSetupToolHandlers(server);
}

// Only export isOpenRouterConfigured from tools.ts if it's needed by other modules
// that haven't been migrated yet
export { isOpenRouterConfigured as legacyIsOpenRouterConfigured } from './tools.js';