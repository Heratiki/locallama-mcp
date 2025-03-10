// Temporary file to test type imports
import { Tool, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';

// Print out the type structure
const tool: Tool = {
  name: 'test',
  description: 'test tool',
  inputSchema: {
    type: 'object',
    properties: {
      test: {
        type: 'string',
        description: 'test property'
      }
    }
  }
};

console.log('Tool type test:', tool);
console.log('ListToolsRequestSchema:', ListToolsRequestSchema);
