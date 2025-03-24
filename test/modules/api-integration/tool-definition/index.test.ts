import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { toolDefinitionProvider } from '../../../../src/modules/api-integration/tool-definition/index.js';

jest.mock('@modelcontextprotocol/sdk/server/index.js');

describe('toolDefinitionProvider', () => {
    let mockServer: Server;

    beforeEach(() => {
        mockServer = new Server({name: 'test', version: '0.0.0'}, { capabilities: {} });
        jest.clearAllMocks();
    });

    it('should be defined', () => {
        expect(toolDefinitionProvider).toBeDefined();
    });

    it('should initialize', () => {
        toolDefinitionProvider.initialize(mockServer);
    });
});