import axios from 'axios';
import { callLmStudioApi } from '../../../../../src/modules/benchmark/api/lm-studio.js';
import { logger } from '../../../../../src/modules/utils/logger.js';

jest.mock('axios');
jest.mock('../../../../../src/modules/utils/logger.js');

describe('callLmStudioApi', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should handle a successful API response', async () => {
    const mockResponse = {
      status: 200,
      data: {
        choices: [
          {
            message: { content: 'Hello, world!', role: 'assistant' },
            index: 0,
          },
        ],
        usage: {
          prompt_tokens: 10,
          completion_tokens: 20,
          total_tokens: 30,
        },
      },
    };

    (axios.post as jest.Mock).mockResolvedValue(mockResponse);

    const result = await callLmStudioApi('test-model', 'Say hello', 5000);

    expect(result).toEqual({
      success: true,
      text: 'Hello, world!',
      usage: {
        prompt_tokens: 10,
        completion_tokens: 20,
      },
    });
    expect(axios.post).toHaveBeenCalledTimes(1);
  });

  it('should handle speculative decoding stats', async () => {
    const mockResponse = {
      status: 200,
      data: {
        choices: [
          {
            message: { content: 'Speculative response', role: 'assistant' },
            index: 0,
          },
        ],
        usage: {
          prompt_tokens: 15,
          completion_tokens: 25,
          total_tokens: 40,
        },
        stats: {
          tokens_per_second: 5,
          draft_model: 'draft-test-model',
          accepted_draft_tokens_count: 10,
          total_draft_tokens_count: 20,
        },
      },
    };

    (axios.post as jest.Mock).mockResolvedValue(mockResponse);

    const result = await callLmStudioApi('test-model', 'Speculative task', 5000, 'draft-test-model');

    expect(result).toEqual({
      success: true,
      text: 'Speculative response',
      usage: {
        prompt_tokens: 15,
        completion_tokens: 25,
      },
      stats: {
        tokens_per_second: 5,
        draft_model: 'draft-test-model',
        accepted_draft_tokens_count: 10,
        total_draft_tokens_count: 20,
      },
    });
    expect(axios.post).toHaveBeenCalledTimes(1);
  });

  it('should handle API errors gracefully', async () => {
    (axios.post as jest.Mock).mockRejectedValue(new Error('API error'));

    const result = await callLmStudioApi('test-model', 'Error task', 5000);

    expect(result).toEqual({ success: false });
    expect(axios.post).toHaveBeenCalledTimes(1);
  });

  it('should handle timeouts', async () => {
    jest.useFakeTimers();

    (axios.post as jest.Mock).mockImplementation(() => {
      return new Promise((_, reject) => {
        setTimeout(() => reject(new Error('Timeout')), 6000);
      });
    });

    const resultPromise = callLmStudioApi('test-model', 'Timeout task', 5000);

    jest.advanceTimersByTime(5000);

    const result = await resultPromise;

    expect(result).toEqual({ success: false });
    expect(axios.post).toHaveBeenCalledTimes(1);

    jest.useRealTimers();
  });
});