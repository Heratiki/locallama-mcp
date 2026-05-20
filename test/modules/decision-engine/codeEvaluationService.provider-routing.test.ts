import { describe, expect, it, jest, beforeEach } from '@jest/globals';

jest.unstable_mockModule('../../../dist/utils/logger.js', () => ({
  logger: {
    error: jest.fn(),
    warn: jest.fn(),
    info: jest.fn(),
    debug: jest.fn(),
  },
}));

const mockExecuteProviderTask = jest.fn();
jest.unstable_mockModule('../../../dist/modules/core/provider/index.js', () => ({
  executeProviderTask: mockExecuteProviderTask,
}));

jest.unstable_mockModule('../../../dist/modules/cost-monitor/index.js', () => ({
  costMonitor: {
    getFreeModels: jest.fn(async () => [{ id: 'openrouter:free-model' }]),
  },
}));

const { codeEvaluationService } = await import('../../../dist/modules/decision-engine/services/codeEvaluationService.js');

describe('codeEvaluationService provider routing', () => {
  beforeEach(() => {
    mockExecuteProviderTask.mockReset();
  });

  it('routes model evaluation through executeProviderTask with openrouter provider', async () => {
    mockExecuteProviderTask.mockResolvedValue({
      content: '{"qualityScore":0.8,"explanation":"ok","isValid":true}',
      model: 'free-model',
    });

    const result = await codeEvaluationService.evaluateCodeWithModel(
      'Write a sum function',
      'function sum(a,b){return a+b;}',
      'general',
      { timeoutMs: 1234 },
    );

    expect(mockExecuteProviderTask).toHaveBeenCalledWith(
      'openrouter',
      'openrouter:free-model',
      expect.any(String),
      { timeoutMs: 1234 },
    );
    expect(result.qualityScore).toBe(0.8);
    expect(result.isValid).toBe(true);
  });

  it('surfaces circuit-open provider errors during model evaluation', async () => {
    mockExecuteProviderTask.mockRejectedValue(
      new Error("Provider 'openrouter' is temporarily unavailable (circuit open)"),
    );

    await expect(
      codeEvaluationService.evaluateCodeWithModel(
        'Write a sum function',
        'function sum(a,b){return a+b;}',
        'general',
        { modelId: 'openrouter:free-model', timeoutMs: 500 },
      ),
    ).rejects.toThrow(/temporarily unavailable \(circuit open\)/);
  });
});
