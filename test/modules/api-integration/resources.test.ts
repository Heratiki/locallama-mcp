import { setupResourceHandlers } from '../../../dist/modules/api-integration/resources.js';

jest.mock('@modelcontextprotocol/sdk/server/index.js');
jest.mock('../../dist/modules/cost-monitor/index.js');
jest.mock('../../dist/modules/openrouter/index.js');
jest.mock('../../dist/config/index.js');
jest.mock('../../dist/utils/logger.js');
jest.mock('../../dist/modules/decision-engine/services/jobTracker.js');

describe('setupResourceHandlers', () => {
  let mockServer: any;

  beforeEach(() => {
    // Reset mocks between tests
    jest.clearAllMocks();
    mockServer = {
      setHandler: jest.fn(),
      // Add missing mock function
      setRequestHandler: jest.fn()
    };
  });

  it('should register resource handlers with the server', async () => {
    await setupResourceHandlers(mockServer);

    // Verify the server's setHandler method was called
    expect(mockServer.setHandler).toHaveBeenCalled();
    expect(mockServer.setRequestHandler).toHaveBeenCalled();
  });
});