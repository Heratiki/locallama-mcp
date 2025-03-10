import { Server } from '@modelcontextprotocol/sdk/server/index.js';

/**
 * Interface for a tool's input schema property definition
 */
export interface IToolPropertyDefinition {
  type: string;
  description: string;
  enum?: string[];
  items?: {
    type: string;
    properties?: Record<string, IToolPropertyDefinition>;
    required?: string[];
    description?: string;
  };
}

/**
 * Interface for a tool's input schema
 */
export interface IToolSchema {
  type: 'object';
  properties?: Record<string, IToolPropertyDefinition>;
  required?: string[];
}

/**
 * Interface for a tool definition
 */
export interface ITool {
  name: string;
  description: string;
  inputSchema: IToolSchema;
}

/**
 * Interface for the tool definition provider
 * Responsible for managing the list of available tools and their schemas
 */
export interface IToolDefinitionProvider {
  /**
   * Initialize the tool definition provider
   * @param server The MCP server instance to register tools with
   */
  initialize(server: Server): void;
  
  /**
   * Get all available tools
   * @returns Array of available tools
   */
  getAvailableTools(): ITool[];
}