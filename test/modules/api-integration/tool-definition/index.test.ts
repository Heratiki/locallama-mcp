import { describe, expect, it, jest, beforeEach } from '@jest/globals';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { toolDefinitionProvider } from '../../../../dist/modules/api-integration/tool-definition/index.js';

jest.mock('@modelcontextprotocol/sdk/server/index.js');

describe('toolDefinitionProvider', () => {
    let mockServer: Server;

    beforeEach(() => {
        // Add 'tools' capability to the mock server
        mockServer = new Server({name: 'test', version: '0.0.0'}, { capabilities: { tools: { list: true } } });
        jest.clearAllMocks();
    });

    it('should be defined', () => {
        expect(toolDefinitionProvider).toBeDefined();
    });

    it('should initialize', () => {
        toolDefinitionProvider.initialize(mockServer);
    });
});