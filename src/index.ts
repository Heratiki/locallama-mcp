#!/usr/bin/env node
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { config } from './config/index.js';
import { setupResourceHandlers } from './modules/api-integration/resources.js';
import { toolDefinitionProvider } from './modules/api-integration/tool-definition/index.js';
import { logger } from './utils/logger.js';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

// Get the current file's directory path in ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Read version from package.json - adjust path to point directly to the project root
const packageJson = JSON.parse(readFileSync(join(__dirname, '../package.json'), 'utf8'));
const version = packageJson.version;

/**
 * LocalLama MCP Server
 * 
 * This MCP Server works with Cline.Bot to optimize costs by intelligently
 * routing coding tasks between local LLMs and paid APIs.
 */
class LocalLamaMcpServer {
  private server: Server;

  constructor() {
    this.server = new Server(
      {
        name: 'locallama-mcp',
        version: version,
      },
      {
        capabilities: {
          resources: {},
          tools: {},
        },
      }
    );

    // Set up resource and tool handlers
    setupResourceHandlers(this.server);
    toolDefinitionProvider.initialize(this.server);
    
    // Error handling
    this.server.onerror = (error) => logger.error('[MCP Error]', error);
    
    // Handle process termination
    process.on('SIGINT', async () => {
      await this.server.close();
      process.exit(0);
    });
  }

  async run() {
    try {
      logger.info('Starting LocalLama MCP Server...');
      const transport = new StdioServerTransport();
      await this.server.connect(transport);
      logger.info('LocalLama MCP Server running on stdio');
    } catch (error) {
      logger.error('Failed to start server:', error);
      process.exit(1);
    }
  }
}

// Initialize and run the server
const server = new LocalLamaMcpServer();
server.run().catch(console.error);