import { describe, expect, it, jest, beforeEach } from '@jest/globals';

// ── Mocks ─────────────────────────────────────────────────────────────────────

const mockGetModel = jest.fn<any>();
const mockUpdateBenchmarkSummary = jest.fn<any>();
jest.unstable_mockModule('../../../dist/modules/core/model/index.js', () => ({
  getModelRegistry: () => ({
    getModel: mockGetModel,
    updateBenchmarkSummary: mockUpdateBenchmarkSummary,
  }),
}));

const mockGetDatabase = jest.fn<any>();
const mockUpdateModelData = jest.fn<any>();
jest.unstable_mockModule('../../../dist/modules/decision-engine/services/modelsDb.js', () => ({
  modelsDbService: {
    getDatabase: mockGetDatabase,
    updateModelData: mockUpdateModelData,
  },
}));

const mockGetJob = jest.fn<any>();
jest.unstable_mockModule('../../../dist/modules/job-store/index.js', () => ({
  getJob: mockGetJob,
}));

const mockWriteFile = jest.fn<any>().mockResolvedValue(undefined);
const mockReadFile = jest.fn<any>();
const mockMkdir = jest.fn<any>().mockResolvedValue(undefined);
jest.unstable_mockModule('fs/promises', () => ({
  default: {
    writeFile: mockWriteFile,
    readFile: mockReadFile,
    mkdir: mockMkdir,
  },
  writeFile: mockWriteFile,
  readFile: mockReadFile,
  mkdir: mockMkdir,
}));

// Dynamic import after mocks are registered
const { rateModel } = await import('../../../dist/modules/decision-engine/services/modelRating.js');
const { toolDefinitionProvider } = await import('../../../dist/modules/api-integration/tool-definition/index.js');

describe('rate_model tool definition', () => {
  it('should define rate_model tool', () => {
    const tools = toolDefinitionProvider.getAvailableTools();
    const rateModelTool = tools.find(t => t.name === 'rate_model');
    expect(rateModelTool).toBeDefined();
    expect(rateModelTool?.inputSchema?.required).toContain('model_id');
    expect(rateModelTool?.inputSchema?.required).toContain('job_id');
    expect(rateModelTool?.inputSchema?.required).toContain('role');
    expect(rateModelTool?.inputSchema?.required).toContain('outcome');
  });
});

describe('rateModel service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('Input Validation', () => {
    it('fails with invalid role', async () => {
      const result = await rateModel({
        modelId: 'test-model',
        jobId: 'job-123',
        role: 'invalid-role' as any,
        outcome: 'positive',
      });
      expect(result.success).toBe(false);
      expect(result.message).toContain('Invalid role');
    });

    it('fails with invalid outcome', async () => {
      const result = await rateModel({
        modelId: 'test-model',
        jobId: 'job-123',
        role: 'generator',
        outcome: 'invalid-outcome' as any,
      });
      expect(result.success).toBe(false);
      expect(result.message).toContain('Invalid outcome');
    });

    it('fails when validator_verdict passed for generator role', async () => {
      const result = await rateModel({
        modelId: 'test-model',
        jobId: 'job-123',
        role: 'generator',
        outcome: 'positive',
        validatorVerdict: 'accurate',
      });
      expect(result.success).toBe(false);
      expect(result.message).toContain('validator_verdict is only allowed when role is "validator"');
    });
  });

  describe('Model Scoring and Updates', () => {
    it('returns error if model is not in registry', async () => {
      mockGetModel.mockReturnValue(undefined);

      const result = await rateModel({
        modelId: 'unknown-model',
        jobId: 'job-123',
        role: 'generator',
        outcome: 'positive',
      });

      expect(result.success).toBe(false);
      expect(result.message).toContain('Model "unknown-model" not found');
    });

    it('updates generator model scores on positive outcome', async () => {
      const mockModel = {
        id: 'gen-model',
        capabilities: {
          scores: {
            code: 0.5,
          },
        },
        benchmarkSummary: {
          lastRunAt: 1000,
          taskCategories: ['code'],
          scores: {
            code: 0.5,
          },
          qualityScore: 0.5,
          benchmarkCount: 2,
        },
      };
      mockGetModel.mockReturnValue(mockModel);
      mockGetDatabase.mockReturnValue({
        models: {
          'gen-model': {
            id: 'gen-model',
            scores: { code: 0.5 },
            qualityScore: 0.5,
            benchmarkCount: 2,
          },
        },
      });

      const result = await rateModel({
        modelId: 'gen-model',
        jobId: 'job-123',
        role: 'generator',
        outcome: 'positive',
      });

      expect(mockUpdateBenchmarkSummary).toHaveBeenCalled();
      const genCallSummary = mockUpdateBenchmarkSummary.mock.calls[0][1];
      expect(genCallSummary.scores.code).toBeCloseTo(0.55, 5);
      expect(genCallSummary.qualityScore).toBeCloseTo(0.55, 5);
      expect(genCallSummary.benchmarkCount).toBe(3);

      expect(mockUpdateModelData).toHaveBeenCalled();
      const genCallDb = mockUpdateModelData.mock.calls[0][1];
      expect(genCallDb.scores.code).toBeCloseTo(0.55, 5);
      expect(genCallDb.qualityScore).toBeCloseTo(0.55, 5);
      expect(genCallDb.benchmarkCount).toBe(3);
    });

    it('updates validator model scores on negative outcome', async () => {
      const mockModel = {
        id: 'val-model',
        capabilities: {
          scores: {
            validate: 0.8,
          },
        },
        benchmarkSummary: {
          lastRunAt: 1000,
          taskCategories: ['validate'],
          scores: {
            validate: 0.8,
          },
          benchmarkCount: 4,
        },
      };
      mockGetModel.mockReturnValue(mockModel);
      mockGetDatabase.mockReturnValue({
        models: {
          'val-model': {
            id: 'val-model',
            scores: { validate: 0.8 },
            benchmarkCount: 4,
          },
        },
      });
      // also mock getJob so negative outcome doesn't fail on missing job
      mockGetJob.mockResolvedValue({
        id: 'job-123',
        task_text: 'write test',
        result: JSON.stringify(['console.log("bad")']),
      });
      mockReadFile.mockRejectedValue({ code: 'ENOENT' });

      const result = await rateModel({
        modelId: 'val-model',
        jobId: 'job-123',
        role: 'validator',
        outcome: 'negative',
      });

      expect(result.success).toBe(true);
      // EMA logic with alpha=0.10: 0.8 * 0.9 + 0.0 * 0.1 = 0.72
      expect(mockUpdateBenchmarkSummary).toHaveBeenCalled();
      const valCallSummary = mockUpdateBenchmarkSummary.mock.calls[0][1];
      expect(valCallSummary.scores.validate).toBeCloseTo(0.72, 5);
      expect(valCallSummary.benchmarkCount).toBe(5);
    });
  });

  describe('Fixture Candidate Queueing', () => {
    it('errors if job is not found for negative outcome', async () => {
      mockGetModel.mockReturnValue({ id: 'gen-model', capabilities: { scores: {} } });
      mockGetJob.mockResolvedValue(undefined);

      const result = await rateModel({
        modelId: 'gen-model',
        jobId: 'non-existent-job',
        role: 'generator',
        outcome: 'negative',
      });

      expect(result.success).toBe(false);
      expect(result.message).toContain('Job "non-existent-job" not found');
    });

    it('successfully appends candidate to JSON file on negative outcome', async () => {
      mockGetModel.mockReturnValue({ id: 'gen-model', capabilities: { scores: {} } });
      mockGetJob.mockResolvedValue({
        id: 'job-123',
        task_text: 'write bubble sort',
        result: JSON.stringify(['function bubbleSort() {}']),
      });
      mockReadFile.mockResolvedValue(JSON.stringify([
        { task: 'existing task', output: 'existing output', label: 'bad' }
      ]));

      const result = await rateModel({
        modelId: 'gen-model',
        jobId: 'job-123',
        role: 'generator',
        outcome: 'negative',
        comment: 'Too slow and buggy',
      });

      expect(result.success).toBe(true);
      expect(mockWriteFile).toHaveBeenCalled();
      
      const [writtenPath, writtenContent] = mockWriteFile.mock.calls[0];
      expect(writtenPath).toContain('fixture-candidates.json');
      
      const parsed = JSON.parse(writtenContent);
      expect(parsed).toHaveLength(2);
      expect(parsed[1]).toEqual(expect.objectContaining({
        task: 'write bubble sort',
        output: 'function bubbleSort() {}',
        label: 'bad',
        model_id: 'gen-model',
        job_id: 'job-123',
        role: 'generator',
        comment: 'Too slow and buggy',
      }));
    });
  });
});
