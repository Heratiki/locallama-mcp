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

const { callOllamaApi } = await import('../../../../dist/modules/benchmark/api/ollama.js');

describe('callOllamaApi', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should handle a successful API response', async () => {
    axiosPostMock.mockResolvedValue({
      status: 200,
      data: {
        message: { content: 'Hello, Ollama!', role: 'assistant' },
        done: true
      }
    });

    const result = await callOllamaApi('test-model', 'Say hello', 5000);

    expect(result).toEqual({
      success: true,
      text: 'Hello, Ollama!',
      usage: {
        prompt_tokens: Math.ceil('Say hello'.length / 4),
        completion_tokens: Math.ceil('Hello, Ollama!'.length / 4)
      }
    });
    expect(axiosPostMock).toHaveBeenCalledTimes(1);
  });

  it('should handle speculative decoding stats', async () => {
    axiosPostMock.mockResolvedValue({
      status: 200,
      data: {
        message: { content: 'Speculative response', role: 'assistant' },
        done: true,
        speculativeDecoding: {
          draft_model: 'draft-test-model',
          total_draft_tokens: 20,
          accepted_draft_tokens: 10,
          tokens_per_second: 5
        }
      }
    });

    const result = await callOllamaApi('test-model', 'Speculative task', 5000, 'draft-test-model');

    expect(result).toEqual({
      success: true,
      text: 'Speculative response',
      usage: {
        prompt_tokens: Math.ceil('Speculative task'.length / 4),
        completion_tokens: Math.ceil('Speculative response'.length / 4)
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

    const result = await callOllamaApi('test-model', 'Error task', 5000);

    expect(result).toEqual({ success: false });
    expect(axiosPostMock).toHaveBeenCalledTimes(1);
  });

  it('should handle timeouts', async () => {
    axiosPostMock.mockRejectedValue(new Error('Timeout'));

    const result = await callOllamaApi('test-model', 'Timeout task', 5000);

    expect(result).toEqual({ success: false });
    expect(axiosPostMock).toHaveBeenCalledTimes(1);
  });
});
