import { beforeEach, describe, expect, it, jest } from '@jest/globals';

jest.unstable_mockModule('../../../dist/config/index.js', () => ({
  config: {
    rootDir: process.cwd(),
    ollamaEndpoint: 'http://localhost:11434/api',
    ollamaTimeout: 25,
    defaultModelConfig: {
      temperature: 0.1,
      maxTokens: 256,
      topP: 0.95,
      frequencyPenalty: 0,
      presencePenalty: 0,
    },
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

const { ollamaModule } = await import('../../../dist/modules/ollama/index.js');
const { OllamaErrorType } = await import('../../../dist/modules/ollama/types.js');
const { InferenceTimeoutError } = await import('../../../dist/modules/utils/inferenceTimeout.js');

describe('ollamaModule timeout handling', () => {
  beforeEach(() => {
    jest.restoreAllMocks();
  });

  it('throws InferenceTimeoutError when OLLAMA_TIMEOUT expires', async () => {
    const callSpy = jest.spyOn(ollamaModule, 'callOllamaApi').mockResolvedValue({
      success: false,
      error: OllamaErrorType.TIMEOUT,
    });

    await expect(ollamaModule.executeTask('gemma3n:e2b', 'Write an add function')).rejects.toBeInstanceOf(
      InferenceTimeoutError,
    );

    await expect(ollamaModule.executeTask('gemma3n:e2b', 'Write an add function')).rejects.toMatchObject({
      providerId: 'ollama',
      timeoutMs: 25,
    });

    expect(callSpy).toHaveBeenCalled();
  });

  it('returns content when inference completes within timeout window', async () => {
    const callSpy = jest.spyOn(ollamaModule, 'callOllamaApi').mockResolvedValue({
      success: true,
      text: 'function add(a, b) { return a + b; }',
      usage: {
        prompt_tokens: 12,
        completion_tokens: 9,
      },
    });

    await expect(ollamaModule.executeTask('gemma3n:e2b', 'Write an add function')).resolves.toContain('function add');
    expect(callSpy).toHaveBeenCalled();
  });
});
