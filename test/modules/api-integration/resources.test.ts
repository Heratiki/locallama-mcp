import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { setupResourceHandlers } from '../../../src/modules/api-integration/resources.js';
import {
  ListResourcesRequestSchema,
  ListResourceTemplatesRequestSchema,
  ReadResourceRequestSchema,
  ListResourcesResult,
  ListResourceTemplatesResult,
  ReadResourceResult
} from '@modelcontextprotocol/sdk/types.js';
import { costMonitor } from '../../../src/modules/cost-monitor/index.js';
import { openRouterModule } from '../../../src/modules/openrouter/index.js';
import { config } from '../../../src/config/index.js';
import { logger } from '../../../src/utils/logger.js';
import { jobTracker } from '../../../src/modules/decision-engine/services/jobTracker.js';

jest.mock('@modelcontextprotocol/sdk/server/index.js');
jest.mock('../../../src/modules/cost-monitor/index.js');
jest.mock('../../../src/modules/openrouter/index.js');
jest.mock('../../../src/config/index.js');
jest.mock('../../../src/utils/logger.js');
jest.mock('../../../src/modules/decision-engine/services/jobTracker.js');

describe('setupResourceHandlers', () => {
  let mockServer: Server;

  beforeEach(() => {
    mockServer = new Server({ name: 'test', version: '0.0.0' }, { capabilities: {} });
    (mockServer.setRequestHandler as jest.Mock).mockClear();
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(setupResourceHandlers).toBeDefined();
  });

  it('should set up resource handlers', () => {
    setupResourceHandlers(mockServer);
    expect(mockServer.setRequestHandler).toHaveBeenCalledWith(
      ListResourcesRequestSchema,
      expect.any(Function),
    );
    expect(mockServer.setRequestHandler).toHaveBeenCalledWith(
      ListResourceTemplatesRequestSchema,
      expect.any(Function),
    );
    expect(mockServer.setRequestHandler).toHaveBeenCalledWith(
      ReadResourceRequestSchema,
      expect.any(Function),
    );
  });

  it('should handle ListResourcesRequest', async () => {
    setupResourceHandlers(mockServer);
    const listResourcesHandler = (mockServer.setRequestHandler as jest.Mock).mock
      .calls[0][1];

    // Mock isOpenRouterConfigured to return false
    config.openRouterApiKey = '';

    const result: ListResourcesResult = await listResourcesHandler();
    expect(result).toEqual({
      resources: [
        {
          uri: 'locallama://status',
          name: 'LocalLama MCP Server Status',
          mimeType: 'application/json',
          description: 'Current status of the LocalLama MCP Server',
        },
        {
          uri: 'locallama://models',
          name: 'Available Models',
          mimeType: 'application/json',
          description: 'List of available local LLM models',
        },
        {
          uri: 'locallama://jobs/active',
          name: 'Active Jobs',
          mimeType: 'application/json',
          description: 'List of currently active jobs',
        },
      ],
    });

    // Mock isOpenRouterConfigured to return true
    config.openRouterApiKey = 'test-key';
    const result2: ListResourcesResult = await listResourcesHandler();
    expect(result2.resources.length).toBe(6);
  });

  it('should handle ListResourceTemplatesRequest', async () => {
    setupResourceHandlers(mockServer);
    const listResourceTemplatesHandler = (mockServer.setRequestHandler as jest.Mock).mock
      .calls[1][1];

    // Mock isOpenRouterConfigured to return false
    config.openRouterApiKey = '';

    const result: ListResourceTemplatesResult = await listResourceTemplatesHandler();
    expect(result).toEqual({
      resourceTemplates: [
        {
          uriTemplate: 'locallama://usage/{api}',
          name: 'API Usage Statistics',
          mimeType: 'application/json',
          description: 'Token usage and cost statistics for a specific API',
        },
        {
          uriTemplate: 'locallama://jobs/progress/{jobId}',
          name: 'Job Progress',
          mimeType: 'application/json',
          description: 'Progress information for a specific job',
        },
      ],
    });

    // Mock isOpenRouterConfigured to return true
    config.openRouterApiKey = 'test-key';
    const result2: ListResourceTemplatesResult = await listResourceTemplatesHandler();
    expect(result2.resourceTemplates.length).toBe(4);
  });

  it('should handle ReadResourceRequest for locallama://status', async () => {
    setupResourceHandlers(mockServer);
    const readResourceHandler = (mockServer.setRequestHandler as jest.Mock).mock.calls[2][1];

    const result = await readResourceHandler({
      params: { uri: 'locallama://status' },
    }) as ReadResourceResult;
    expect(result.contents[0].uri).toBe('locallama://status');
    expect(result.contents[0].mimeType).toBe('application/json');
    expect(JSON.parse(result.contents[0].text as string)).toEqual({
      status: 'running',
      version: expect.any(String),
      uptime: expect.any(Number),
      timestamp: expect.any(String),
    });
  });

  it('should handle ReadResourceRequest for locallama://models', async () => {
    setupResourceHandlers(mockServer);
    const readResourceHandler = (mockServer.setRequestHandler as jest.Mock).mock.calls[2][1];

    (costMonitor.getAvailableModels as jest.Mock).mockResolvedValue([{ id: 'test-model' }]);

    const result = await readResourceHandler({
      params: { uri: 'locallama://models' },
    }) as ReadResourceResult;
    expect(result.contents[0].uri).toBe('locallama://models');
    expect(result.contents[0].mimeType).toBe('application/json');
    expect(JSON.parse(result.contents[0].text as string)).toEqual([{ id: 'test-model' }]);
  });

  it('should handle ReadResourceRequest for locallama://openrouter/models', async () => {
    setupResourceHandlers(mockServer);
    const readResourceHandler = (mockServer.setRequestHandler as jest.Mock).mock.calls[2][1];

    // Mock isOpenRouterConfigured to return true
    config.openRouterApiKey = 'test-key';
    (openRouterModule.getAvailableModels as jest.Mock).mockResolvedValue([
      { id: 'openrouter-model' },
    ]);
    (openRouterModule.initialize as jest.Mock).mockResolvedValue(undefined);
    openRouterModule.modelTracking = { models: {}, freeModels: [], lastUpdated: '' };

    const result = await readResourceHandler({
      params: { uri: 'locallama://openrouter/models' },
    }) as ReadResourceResult;
    expect(result.contents[0].uri).toBe('locallama://openrouter/models');
    expect(result.contents[0].mimeType).toBe('application/json');
    expect(JSON.parse(result.contents[0].text as string)).toEqual([{ id: 'openrouter-model' }]);
  });

  it('should handle ReadResourceRequest for locallama://jobs/active', async () => {
    setupResourceHandlers(mockServer);
    const readResourceHandler = (mockServer.setRequestHandler as jest.Mock).mock.calls[2][1];
    (jobTracker.getActiveJobs as jest.Mock).mockReturnValue([{ id: 'test-job' }]);

    const result = await readResourceHandler({
      params: { uri: 'locallama://jobs/active' },
    }) as ReadResourceResult;

    expect(result.contents[0].uri).toBe('locallama://jobs/active');
    expect(result.contents[0].mimeType).toBe('application/json');
    expect(JSON.parse(result.contents[0].text as string)).toEqual({
      count: 1,
      jobs: [{ id: 'test-job' }],
      timestamp: expect.any(String),
    });
  });
});