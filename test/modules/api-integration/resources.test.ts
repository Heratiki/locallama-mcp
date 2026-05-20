import { describe, expect, it, jest, beforeEach, afterAll } from '@jest/globals';
import { setupResourceHandlers } from '../../../dist/modules/api-integration/resources.js';
import { shutdownJobTracker } from '../../../dist/modules/decision-engine/services/jobTracker.js';

jest.mock('@modelcontextprotocol/sdk/server/index.js'); // Keep external mock
jest.mock('../../../dist/modules/cost-monitor/index.js'); // Corrected path (added ../)
jest.mock('../../../dist/modules/openrouter/index.js'); // Corrected path (added ../)
jest.mock('../../../dist/config/index.js'); // Corrected path (added ../)
jest.mock('../../../dist/utils/logger.js'); // Corrected path (added ../)
jest.mock('../../../dist/modules/decision-engine/services/jobTracker.js'); // Corrected path (added ../)

describe('setupResourceHandlers', () => {
  let mockServer: any;

  beforeEach(() => {
    // Reset mocks between tests
    jest.clearAllMocks();
    mockServer = {
      setRequestHandler: jest.fn()
    };
  });

  afterAll(async () => {
    await shutdownJobTracker();
  });

  it('should register resource handlers with the server', async () => {
    await setupResourceHandlers(mockServer);

    expect(mockServer.setRequestHandler).toHaveBeenCalledTimes(3);
  });
});
