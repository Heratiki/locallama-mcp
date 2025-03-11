import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { toolDefinitionProvider } from '../../../../src/modules/api-integration/tool-definition/index.js';
import { config } from '../../../../src/config/index.js';

describe('Tool Definition Provider', () => {
  let mockServer: jest.Mocked<Server>;

  beforeEach(() => {
    // Create mock server
    mockServer = {
      setRequestHandler: jest.fn()
    } as any;

    // Reset OpenRouter config before each test
    delete (config as any).openRouterApiKey;
  });

  describe('initialize', () => {
    it('should register the ListToolsRequestSchema handler', () => {
      toolDefinitionProvider.initialize(mockServer);
      expect(mockServer.setRequestHandler).toHaveBeenCalledWith(
        ListToolsRequestSchema,
        expect.any(Function)
      );
    });

    it('should call getAvailableTools when handling ListToolsRequestSchema', async () => {
      const getAvailableToolsSpy = jest.spyOn(toolDefinitionProvider, 'getAvailableTools');
      toolDefinitionProvider.initialize(mockServer);

      // Get the handler function that was registered
      const handler = mockServer.setRequestHandler.mock.calls[0][1];
      await handler({ params: {} } as any, {} as any);

      expect(getAvailableToolsSpy).toHaveBeenCalled();
    });
  });

  describe('getAvailableTools', () => {
    it('should always include core tools', () => {
      const tools = toolDefinitionProvider.getAvailableTools();
      
      // Check core tools are present
      const coreToolNames = [
        'route_task',
        'retriv_init',
        'cancel_job',
        'preemptive_route_task',
        'get_cost_estimate',
        'benchmark_task',
        'benchmark_tasks'
      ];

      coreToolNames.forEach(toolName => {
        expect(tools.some(t => t.name === toolName)).toBe(true);
      });
    });

    it('should not include OpenRouter tools when API key is not configured', () => {
      const tools = toolDefinitionProvider.getAvailableTools();
      
      // Check OpenRouter tools are not present
      const openRouterToolNames = [
        'get_free_models',
        'clear_openrouter_tracking',
        'benchmark_free_models',
        'set_model_prompting_strategy'
      ];

      openRouterToolNames.forEach(toolName => {
        expect(tools.some(t => t.name === toolName)).toBe(false);
      });
    });

    it('should include OpenRouter tools when API key is configured', () => {
      // Configure OpenRouter API key
      (config as any).openRouterApiKey = 'test-key';

      const tools = toolDefinitionProvider.getAvailableTools();
      
      // Check OpenRouter tools are present
      const openRouterToolNames = [
        'get_free_models',
        'clear_openrouter_tracking',
        'benchmark_free_models',
        'set_model_prompting_strategy'
      ];

      openRouterToolNames.forEach(toolName => {
        expect(tools.some(t => t.name === toolName)).toBe(true);
      });
    });

    it('should define required input schema properties for each tool', () => {
      const tools = toolDefinitionProvider.getAvailableTools();
      
      tools.forEach(tool => {
        // Check each tool has the required properties
        expect(tool).toHaveProperty('name');
        expect(tool).toHaveProperty('description');
        expect(tool).toHaveProperty('inputSchema');
        expect(tool.inputSchema).toHaveProperty('type', 'object');
        
        // If required properties are defined, they should be an array
        if (tool.inputSchema.required) {
          expect(Array.isArray(tool.inputSchema.required)).toBe(true);
        }

        // If properties are defined, they should be an object
        if (tool.inputSchema.properties) {
          expect(typeof tool.inputSchema.properties).toBe('object');
        }
      });
    });
  });
});