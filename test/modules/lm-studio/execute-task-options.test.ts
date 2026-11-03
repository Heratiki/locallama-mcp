/**
 * #168: `lmStudioModule.executeTask` must forward caller-provided maxTokens
 * and systemPrompt to the LM Studio API — they win over the code-task profile
 * values. With no options the outgoing request keeps today's shape.
 */
import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import axios from 'axios';

jest.unstable_mockModule('../../../dist/config/index.js', () => ({
  config: {
    rootDir: process.cwd(),
    lmStudioEndpoint: 'http://localhost:1234/v1',
    providerTimeoutMs: 120000,
    defaultModelConfig: { temperature: 0.1, maxTokens: 256, topP: 0.95, frequencyPenalty: 0, presencePenalty: 0 },
  },
}));

jest.unstable_mockModule('../../../dist/utils/logger.js', () => ({
  logger: { error: jest.fn(), warn: jest.fn(), info: jest.fn(), debug: jest.fn() },
}));

const { lmStudioModule } = await import('../../../dist/modules/lm-studio/index.js');
const { buildCodeTaskExecutionOptions } = await import('../../../dist/modules/core/prompting/execution-profile.js');

// Coding task so the code-task profile applies its own maxTokens/systemPrompt;
// the caller's values must win over those profile values (#168).
const TASK = 'Implement a function that parses a config file';

function seed(): void {
  lmStudioModule.modelTracking = {
    lastUpdated: new Date().toISOString(),
    models: {
      'qwen-x': {
        id: 'qwen-x', name: 'Qwen X', provider: 'lm-studio', contextWindow: 8192,
        capabilities: { chat: true, completion: true, contextWindow: 8192 },
        costPerToken: { prompt: 0, completion: 0 },
        promptingStrategy: { systemPrompt: 's', useChat: true },
        lastUpdated: new Date().toISOString(),
      },
    },
  } as any;
}

interface SentBody {
  messages: Array<{ role: string; content: string }>;
  max_tokens: number;
}

async function runTask(options?: { maxTokens?: number; systemPrompt?: string }): Promise<SentBody> {
  const post = jest.spyOn(axios, 'post').mockResolvedValueOnce({
    status: 200, headers: {},
    data: {
      choices: [{ index: 0, message: { role: 'assistant', content: 'body' }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
    },
  });
  await expect(lmStudioModule.executeTask('qwen-x', TASK, options)).resolves.toBe('body');
  expect(post).toHaveBeenCalledTimes(1);
  return post.mock.calls[0][1] as SentBody;
}

beforeEach(() => {
  jest.restoreAllMocks();
  seed();
});

describe('lmStudioModule.executeTask caller options (#168)', () => {
  it('sends the caller maxTokens as max_tokens and the caller systemPrompt as the system message', async () => {
    const body = await runTask({ maxTokens: 5000, systemPrompt: 'X' });
    expect(body.max_tokens).toBe(5000);
    expect(body.messages[0]).toEqual({ role: 'system', content: 'X' });
  });

  it('lets maxTokens win alone while the system message falls back to the profile', async () => {
    const profile = buildCodeTaskExecutionOptions(TASK, 'lm-studio');
    expect(profile.maxTokens).toBeDefined();
    expect(profile.maxTokens).not.toBe(5000);
    const body = await runTask({ maxTokens: 5000 });
    expect(body.max_tokens).toBe(5000);
    expect(body.messages[0]).toEqual({ role: 'system', content: profile.systemPrompt });
  });

  it('lets systemPrompt win alone while max_tokens falls back to the profile', async () => {
    const profile = buildCodeTaskExecutionOptions(TASK, 'lm-studio');
    expect(profile.systemPrompt).toBeDefined();
    expect(profile.systemPrompt).not.toBe('X');
    const body = await runTask({ systemPrompt: 'X' });
    expect(body.max_tokens).toBe(profile.maxTokens);
    expect(body.messages[0]).toEqual({ role: 'system', content: 'X' });
  });

  it('with no options sends the same request as today', async () => {
    const profile = buildCodeTaskExecutionOptions(TASK, 'lm-studio');
    const body = await runTask();
    expect(body.max_tokens).toBe(profile.maxTokens);
    expect(body.messages).toEqual([
      { role: 'system', content: profile.systemPrompt as string },
      { role: 'user', content: TASK },
    ]);
  });
});
