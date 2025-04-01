import { describe, it, expect, beforeEach, jest, afterEach } from '@jest/globals';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { setupResourceHandlers } from '../../../../src/modules/api-integration/resources.js';

jest.mock('@modelcontextprotocol/sdk/server/index.js');

describe('setupResourceHandlers', () => {
  let mockServer: any;

  beforeEach(() => {
    // Reset mocks between tests
    jest.clearAllMocks();
    mockServer = {
      setHandler: jest.fn().mockResolvedValue(undefined)
    };
  });

  it('should register resource handlers with the server', async () => {
    await setupResourceHandlers(mockServer);

    // Verify the server's setHandler method was called
    expect(mockServer.setHandler).toHaveBeenCalled();
  });
});