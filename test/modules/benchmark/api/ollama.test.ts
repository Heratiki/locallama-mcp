import { describe, expect, it, jest, beforeEach } from '@jest/globals';
import { logger } from '../../../../dist/utils/logger.js'; // Changed path and extension

// Manually mock axios to ensure axios.post is a jest.Mock
jest.mock('axios', () => ({
  post: jest.fn(),
}));

// Import axios *after* the mock
import axios from 'axios';

import { callOllamaApi } from '../../../../dist/modules/benchmark/api/ollama.js'; // Changed path and extension

jest.mock('../../../../dist/utils/logger.js'); // Changed path and extension

describe('callOllamaApi', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Ensure the mock function itself is reset if needed, though clearAllMocks might suffice
    (axios.post as jest.Mock).mockClear(); 
  });

  it('should handle a successful API response', async () => {
    const mockResponse = {
      status: 200,
      data: {
        message: { content: 'Hello, Ollama!', role: 'assistant' },
        done: true,
      },
    };

    // Use the mock function directly
    (axios.post as jest.Mock).mockResolvedValue(mockResponse); 

    const result = await callOllamaApi('test-model', 'Say hello', 5000);

    expect(result).toEqual({
      success: true,
      text: 'Hello, Ollama!',
      usage: {
        prompt_tokens: Math.ceil('Say hello'.length / 4),
        completion_tokens: Math.ceil('Hello, Ollama!'.length / 4),
      },
    });
    expect(axios.post).toHaveBeenCalledTimes(1);
  });

  it('should handle speculative decoding stats', async () => {
    const mockResponse = {
      status: 200,
      data: {
        message: { content: 'Speculative response', role: 'assistant' },
        done: true,
        speculativeDecoding: {
          draft_model: 'draft-test-model',
          total_draft_tokens: 20,
          accepted_draft_tokens: 10,
          tokens_per_second: 5,
        },
      },
    };

    // Use the mock function directly
    (axios.post as jest.Mock).mockResolvedValue(mockResponse);

    const result = await callOllamaApi('test-model', 'Speculative task', 5000, 'draft-test-model');

    expect(result).toEqual({
      success: true,
      text: 'Speculative response',
      usage: {
        prompt_tokens: Math.ceil('Speculative task'.length / 4),
        completion_tokens: Math.ceil('Speculative response'.length / 4),
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
    // Use the mock function directly
    (axios.post as jest.Mock).mockRejectedValue(new Error('API error'));

    const result = await callOllamaApi('test-model', 'Error task', 5000);

    expect(result).toEqual({ success: false });
    expect(axios.post).toHaveBeenCalledTimes(1);
  });

  it('should handle timeouts', async () => {
    jest.useFakeTimers();

    // Use the mock function directly
    (axios.post as jest.Mock).mockImplementation(() => {
      return new Promise((_, reject) => {
        setTimeout(() => reject(new Error('Timeout')), 6000);
      });
    });

    const resultPromise = callOllamaApi('test-model', 'Timeout task', 5000);

    jest.advanceTimersByTime(5000);

    const result = await resultPromise;

    expect(result).toEqual({ success: false });
    expect(axios.post).toHaveBeenCalledTimes(1);

    jest.useRealTimers();
  });
});