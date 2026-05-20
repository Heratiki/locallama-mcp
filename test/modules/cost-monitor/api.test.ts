import { beforeEach, describe, expect, it, jest } from '@jest/globals';

const axiosGetMock = jest.fn();
const handleOpenRouterErrorMock = jest.fn();

jest.unstable_mockModule('axios', () => ({
  default: { get: axiosGetMock },
  get: axiosGetMock,
}));

jest.unstable_mockModule('../../../dist/config/index.js', () => ({
  config: {
    openRouterApiKey: 'test-key',
  },
}));

jest.unstable_mockModule('../../../dist/utils/logger.js', () => ({
  logger: {
    error: jest.fn(),
    warn: jest.fn(),
    info: jest.fn(),
    debug: jest.fn(),
  },
}));

jest.unstable_mockModule('../../../dist/modules/openrouter/index.js', () => ({
  openRouterModule: {
    handleOpenRouterError: handleOpenRouterErrorMock,
  },
}));

const { getOpenRouterUsage } = await import('../../../dist/modules/cost-monitor/api.js');

describe('getOpenRouterUsage', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('uses the current OpenRouter credits endpoint and computes remaining credits', async () => {
    axiosGetMock.mockResolvedValue({
      data: {
        data: {
          total_credits: 110,
          total_usage: 108.355814047,
        },
      },
    });

    const usage = await getOpenRouterUsage();

    expect(axiosGetMock).toHaveBeenCalledWith(
      'https://openrouter.ai/api/v1/credits',
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: 'Bearer test-key',
        }),
      }),
    );
    expect(usage.cost.total).toBe(108.355814047);
    expect(usage.cost.remaining).toBeCloseTo(1.644185953);
  });
});
