import { beforeEach, describe, expect, it, jest } from '@jest/globals';

jest.unstable_mockModule('../../../dist/utils/logger.js', () => ({
  logger: { error: jest.fn(), warn: jest.fn(), info: jest.fn(), debug: jest.fn() },
}));

const mockGetModel = jest.fn();
const mockUpdateBenchmarkSummary = jest.fn();
jest.unstable_mockModule('../../../dist/modules/core/model/index.js', () => ({
  getModelRegistry: () => ({
    getModel: mockGetModel,
    updateBenchmarkSummary: mockUpdateBenchmarkSummary,
  }),
}));

const mockGetDatabase = jest.fn();
const mockUpdateModelData = jest.fn();
jest.unstable_mockModule('../../../dist/modules/decision-engine/services/modelsDb.js', () => ({
  modelsDbService: {
    getDatabase: mockGetDatabase,
    updateModelData: mockUpdateModelData,
  },
}));

const { OutputValidator } = await import('../../../dist/modules/decision-engine/services/outputValidator.js');

describe('OutputValidator.validate (Unit Tests)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('verifies happy path with YES first line', async () => {
    const mockProvider = {
      executeTask: jest.fn<any>().mockResolvedValue({
        content: 'YES\nThe code is perfectly correct and meets all requirements.',
      }),
    };

    const result = await OutputValidator.validate('write add function', 'function add(a,b) { return a+b; }', mockProvider, 'test-model');

    expect(result.passed).toBe(true);
    expect(result.parsed_cleanly).toBe(true);
    expect(result.skipped).toBe(false);
    expect(result.confidence).toBeGreaterThanOrEqual(0.8);
    expect(result.reason).toBe('The code is perfectly correct and meets all requirements.');
  });

  it('verifies path with NO first line', async () => {
    const mockProvider = {
      executeTask: jest.fn<any>().mockResolvedValue({
        content: 'NO\nThe code has syntax errors and is missing return type.',
      }),
    };

    const result = await OutputValidator.validate('write add function', 'function add(a,b) { return a-b; }', mockProvider, 'test-model');

    expect(result.passed).toBe(false);
    expect(result.parsed_cleanly).toBe(true);
    expect(result.skipped).toBe(false);
    expect(result.confidence).toBeGreaterThanOrEqual(0.8);
    expect(result.reason).toBe('The code has syntax errors and is missing return type.');
  });

  it('performs keyword fallback for YES in prose with pinned confidence', async () => {
    const mockProvider = {
      executeTask: jest.fn<any>().mockResolvedValue({
        content: 'This solution is correct.',
      }),
    };

    const result = await OutputValidator.validate('write add function', 'function add(a,b) { return a+b; }', mockProvider, 'test-model');

    expect(result.passed).toBe(true);
    expect(result.parsed_cleanly).toBe(false);
    expect(result.skipped).toBe(false);
    expect(result.confidence).toBe(0.5); // pinned confidence
  });

  it('performs keyword fallback for NO in prose with pinned confidence', async () => {
    const mockProvider = {
      executeTask: jest.fn<any>().mockResolvedValue({
        content: 'This solution fails the tests.',
      }),
    };

    const result = await OutputValidator.validate('write add function', 'function add(a,b) { return a-b; }', mockProvider, 'test-model');

    expect(result.passed).toBe(false);
    expect(result.parsed_cleanly).toBe(false);
    expect(result.skipped).toBe(false);
    expect(result.confidence).toBe(0.5); // pinned confidence
  });

  it('handles negation trap: not correct', async () => {
    const mockProvider = {
      executeTask: jest.fn<any>().mockResolvedValue({
        content: 'This output is not correct.',
      }),
    };

    const result = await OutputValidator.validate('write add function', 'function add(a,b) { return a-b; }', mockProvider, 'test-model');

    expect(result.passed).toBe(false); // correctly identified negation
    expect(result.parsed_cleanly).toBe(false);
    expect(result.skipped).toBe(false);
  });

  it('handles empty output gracefully', async () => {
    const mockProvider = {
      executeTask: jest.fn<any>().mockResolvedValue({
        content: '   ',
      }),
    };

    const result = await OutputValidator.validate('write add function', 'function add(a,b) { return a+b; }', mockProvider, 'test-model');

    expect(result.passed).toBeNull();
    expect(result.parsed_cleanly).toBe(false);
    expect(result.skipped).toBe(true);
    expect(result.confidence).toBe(0);
    expect(result.reason).toContain('Empty response');
  });

  it('handles unparseable prose gracefully (skipped)', async () => {
    const mockProvider = {
      executeTask: jest.fn<any>().mockResolvedValue({
        content: 'I am not sure what is happening here.',
      }),
    };

    const result = await OutputValidator.validate('write add function', 'function add(a,b) { return a+b; }', mockProvider, 'test-model');

    expect(result.passed).toBeNull(); // skipped
    expect(result.parsed_cleanly).toBe(false);
    expect(result.skipped).toBe(true);
    expect(result.confidence).toBe(0);
  });

  it('handles provider throw gracefully (skipped)', async () => {
    const mockProvider = {
      executeTask: jest.fn<any>().mockRejectedValue(new Error('API failure')),
    };

    const result = await OutputValidator.validate('write add function', 'function add(a,b) { return a+b; }', mockProvider, 'test-model');

    expect(result.passed).toBeNull();
    expect(result.parsed_cleanly).toBe(false);
    expect(result.skipped).toBe(true);
    expect(result.confidence).toBe(0);
    expect(result.reason).toContain('Provider error: API failure');
  });
});

describe('OutputValidator.updateReputation (Integration / Decoupled Unit Test)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetDatabase.mockReturnValue({ models: {} });
  });

  it('updates validator model reputation in registry and db via EMA', async () => {
    mockGetModel.mockReturnValue({
      id: 'test-model',
      benchmarkSummary: {
        scores: { validate: 0.8 },
        benchmarkCount: 2,
      },
    });

    mockGetDatabase.mockReturnValue({
      models: {
        'test-model': {
          id: 'test-model',
          scores: { validate: 0.8 },
          benchmarkCount: 2,
        },
      },
    });

    await OutputValidator.updateReputation('test-model', true);

    expect(mockUpdateBenchmarkSummary).toHaveBeenCalledWith(
      'test-model',
      expect.objectContaining({
        scores: expect.objectContaining({ validate: 0.81 }),
        benchmarkCount: 3,
      }),
    );

    expect(mockUpdateModelData).toHaveBeenCalledWith(
      'test-model',
      expect.objectContaining({
        scores: expect.objectContaining({ validate: 0.81 }),
        benchmarkCount: 3,
      }),
    );
  });
});
