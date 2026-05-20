import { beforeEach, describe, expect, it, jest } from '@jest/globals';

const axiosPostMock = jest.fn();

jest.unstable_mockModule('axios', () => ({
  default: { post: axiosPostMock },
  post: axiosPostMock
}));

jest.unstable_mockModule('../../../../dist/utils/logger.js', () => ({
  logger: {
    error: jest.fn(),
    warn: jest.fn(),
    info: jest.fn(),
    debug: jest.fn()
  }
}));

const { callLmStudioApi } = await import('../../../../dist/modules/benchmark/api/lm-studio.js');

describe('callLmStudioApi', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should handle a successful API response', async () => {
    axiosPostMock.mockResolvedValue({
      status: 200,
      data: {
        choices: [
          {
            message: { content: 'Hello, world!', role: 'assistant' },
            index: 0
          }
        ],
        usage: {
          prompt_tokens: 10,
          completion_tokens: 20,
          total_tokens: 30
        }
      }
    });

    const result = await callLmStudioApi('test-model', 'Say hello', 5000);

    expect(result).toEqual({
      success: true,
      text: 'Hello, world!',
      usage: {
        prompt_tokens: 10,
        completion_tokens: 20,
        total_tokens: 30
      }
    });
    expect(axiosPostMock).toHaveBeenCalledTimes(1);
  });

  it('should handle speculative decoding stats', async () => {
    axiosPostMock.mockResolvedValue({
      status: 200,
      data: {
        choices: [
          {
            message: { content: 'Speculative response', role: 'assistant' },
            index: 0
          }
        ],
        usage: {
          prompt_tokens: 15,
          completion_tokens: 25,
          total_tokens: 40
        },
        stats: {
          tokens_per_second: 5,
          draft_model: 'draft-test-model',
          accepted_draft_tokens_count: 10,
          total_draft_tokens_count: 20
        }
      }
    });

    const result = await callLmStudioApi('test-model', 'Speculative task', 5000, 'draft-test-model');

    expect(result).toEqual({
      success: true,
      text: 'Speculative response',
      usage: {
        prompt_tokens: 15,
        completion_tokens: 25,
        total_tokens: 40
      },
      stats: {
        tokens_per_second: 5,
        draft_model: 'draft-test-model',
        accepted_draft_tokens_count: 10,
        total_draft_tokens_count: 20
      }
    });
    expect(axiosPostMock).toHaveBeenCalledTimes(1);
  });

  it('should handle API errors gracefully', async () => {
    axiosPostMock.mockRejectedValue(new Error('API error'));

    const result = await callLmStudioApi('test-model', 'Error task', 5000);

    expect(result).toEqual({ success: false });
    expect(axiosPostMock).toHaveBeenCalledTimes(1);
  });

  it('should handle timeouts', async () => {
    axiosPostMock.mockRejectedValue(new Error('Timeout'));

    const result = await callLmStudioApi('test-model', 'Timeout task', 5000);

    expect(result).toEqual({ success: false });
    expect(axiosPostMock).toHaveBeenCalledTimes(1);
  });
});
