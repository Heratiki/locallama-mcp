import { Tool } from '@modelcontextprotocol/sdk/types.js';
import { IToolDefinitionProvider } from '../types.js';

// Re-export IToolDefinitionProvider for convenience
export type { IToolDefinitionProvider };

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
 * Type alias for Tool from MCP SDK to ensure consistency
 */
export type ITool = Tool;