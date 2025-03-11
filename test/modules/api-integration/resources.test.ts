import { setupResourceHandlers } from '../../../src/modules/api-integration/resources.js';
import { costMonitor } from '../../../src/modules/cost-monitor/index.js';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import {
  ErrorCode,
  ListResourcesRequestSchema,
  ListResourceTemplatesRequestSchema,
  McpError,
  ReadResourceRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';

// Mock dependencies
jest.mock('../../../src/modules/cost-monitor/index.js');
jest.mock('../../../src/utils/logger.js', () => ({
  logger: {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn()
  }
}));

describe('API Integration - Resources', () => {
  let server: Server;
  let listResourcesHandler: any;
  let listResourceTemplatesHandler: any;
  let readResourceHandler: any;
  
  beforeEach(() => {
    // Reset mocks
    jest.resetAllMocks();
    
    // Create a mock server
    server = {
      setRequestHandler: jest.fn((schema, handler) => {
        if (schema === ListResourcesRequestSchema) {
          listResourcesHandler = handler;
        } else if (schema === ListResourceTemplatesRequestSchema) {
          listResourceTemplatesHandler = handler;
        } else if (schema === ReadResourceRequestSchema) {
          readResourceHandler = handler;
        }
      }),
      onerror: jest.fn(),
      connect: jest.fn(),
      close: jest.fn(),
    } as unknown as Server;
    
    // Set up resource handlers
    setupResourceHandlers(server);
    
    // Set up costMonitor mock responses
    (costMonitor.getApiUsage as jest.Mock).mockResolvedValue({
      api: 'openai',
      tokenUsage: {
        prompt: 1000000,
        completion: 500000,
        total: 1500000,
      },
      cost: {
        prompt: 0.01,
        completion: 0.02,
        total: 0.03,
      },
      timestamp: '2025-02-25T12:00:00.000Z',
    });
    
    (costMonitor.getAvailableModels as jest.Mock).mockResolvedValue([
      {
        id: 'llama3',
        name: 'Llama 3',
        provider: 'local',
        capabilities: {
          chat: true,
          completion: true,
        },
        costPerToken: {
          prompt: 0,
          completion: 0,
        },
        contextWindow: 8192,
      },
    ]);
  });
  
  describe('ListResourcesRequestSchema', () => {
    test('returns list of available static resources', async () => {
      const result = await listResourcesHandler();
      
      expect(result.resources).toHaveLength(2);
      expect(result.resources[0].uri).toBe('locallama://status');
      expect(result.resources[1].uri).toBe('locallama://models');
    });
  });
  
  describe('ListResourceTemplatesRequestSchema', () => {
    test('returns list of available resource templates', async () => {
      const result = await listResourceTemplatesHandler();
      
      expect(result.resourceTemplates).toHaveLength(1);
      expect(result.resourceTemplates[0].uriTemplate).toBe('locallama://usage/{api}');
    });
  });
  
  describe('ReadResourceRequestSchema', () => {
    test('returns status resource', async () => {
      const result = await readResourceHandler({
        params: { uri: 'locallama://status' }
      });
      
      expect(result.contents).toHaveLength(1);
      expect(result.contents[0].uri).toBe('locallama://status');
      expect(result.contents[0].mimeType).toBe('application/json');
      
      const status = JSON.parse(result.contents[0].text);
      expect(status.status).toBe('running');
      expect(status.version).toBe('0.1.0');
      expect(status.uptime).toBeDefined();
      expect(status.timestamp).toBeDefined();
    });
    
    test('returns models resource', async () => {
      const result = await readResourceHandler({
        params: { uri: 'locallama://models' }
      });
      
      expect(result.contents).toHaveLength(1);
      expect(result.contents[0].uri).toBe('locallama://models');
      expect(result.contents[0].mimeType).toBe('application/json');
      
      const models = JSON.parse(result.contents[0].text);
      expect(models).toHaveLength(1);
      expect(models[0].id).toBe('llama3');
    });
    
    test('returns API usage resource for specific API', async () => {
      const result = await readResourceHandler({
        params: { uri: 'locallama://usage/openai' }
      });
      
      expect(result.contents).toHaveLength(1);
      expect(result.contents[0].uri).toBe('locallama://usage/openai');
      expect(result.contents[0].mimeType).toBe('application/json');
      
      const usage = JSON.parse(result.contents[0].text);
      expect(usage.api).toBe('openai');
      expect(usage.tokenUsage).toBeDefined();
      expect(usage.cost).toBeDefined();
    });
    
    test('throws error for invalid resource URI', async () => {
      await expect(
        readResourceHandler({
          params: { uri: 'locallama://invalid' }
        })
      ).rejects.toThrow(McpError);
    });
    
    test('handles API usage errors', async () => {
      (costMonitor.getApiUsage as jest.Mock).mockRejectedValue(new Error('API error'));
      
      await expect(
        readResourceHandler({
          params: { uri: 'locallama://usage/openai' }
        })
      ).rejects.toThrow(McpError);
    });
    
    test('handles model list errors', async () => {
      (costMonitor.getAvailableModels as jest.Mock).mockRejectedValue(new Error('API error'));
      
      await expect(
        readResourceHandler({
          params: { uri: 'locallama://models' }
        })
      ).rejects.toThrow(McpError);
    });
  });
});