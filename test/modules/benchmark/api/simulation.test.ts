import { simulateOpenAiApi, simulateGenericApi } from '../../../../../src/modules/benchmark/api/simulation.js';

jest.mock('../../../../../src/modules/utils/logger.js');

describe('simulateOpenAiApi', () => {
  it('should return a successful response with token usage', async () => {
    jest.spyOn(global.Math, 'random').mockReturnValue(0.5); // Force success

    const task = 'Test OpenAI simulation';
    const result = await simulateOpenAiApi(task, 1000);

    expect(result.success).toBe(true);
    expect(result.text).toContain('Simulated response for: Test OpenAI simulation');
    expect(result.usage).toEqual({
      prompt_tokens: Math.ceil(task.length / 4),
      completion_tokens: Math.ceil((task.length / 4) * 0.8),
    });
  });

  it('should return a failure response', async () => {
    jest.spyOn(global.Math, 'random').mockReturnValue(0.05); // Force failure

    const result = await simulateOpenAiApi('Test failure', 1000);

    expect(result.success).toBe(false);
    expect(result.text).toBeUndefined();
    expect(result.usage).toBeUndefined();
  });
});

describe('simulateGenericApi', () => {
  it('should return a successful response with token usage', async () => {
    jest.spyOn(global.Math, 'random').mockReturnValue(0.5); // Force success

    const task = 'Test generic API simulation';
    const result = await simulateGenericApi(task, 1500);

    expect(result.success).toBe(true);
    expect(result.text).toContain('Simulated generic API response for: Test generic API simulation');
    expect(result.usage).toEqual({
      prompt_tokens: Math.ceil(task.length / 4),
      completion_tokens: Math.ceil((task.length / 4) * 0.7),
    });
  });

  it('should return a failure response', async () => {
    jest.spyOn(global.Math, 'random').mockReturnValue(0.15); // Force failure

    const result = await simulateGenericApi('Test failure', 1500);

    expect(result.success).toBe(false);
    expect(result.text).toBeUndefined();
    expect(result.usage).toBeUndefined();
  });
});