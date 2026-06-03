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

    it('updates generator model scores on negative outcome', async () => {
      const mockModel = {
        id: 'gen-model',
        capabilities: { scores: { code: 0.5 } },
        benchmarkSummary: {
          lastRunAt: 1000,
          taskCategories: ['code'],
          scores: { code: 0.5 },
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
        outcome: 'negative',
      });

      expect(mockUpdateBenchmarkSummary).toHaveBeenCalled();
      const summary = mockUpdateBenchmarkSummary.mock.calls[0][1];
      expect(summary.scores.code).toBeCloseTo(0.45, 5); // 0.5 * 0.9 + 0.0 * 0.1
      expect(summary.qualityScore).toBeCloseTo(0.45, 5);

      expect(mockUpdateModelData).toHaveBeenCalled();
      const dbData = mockUpdateModelData.mock.calls[0][1];
      expect(dbData.scores.code).toBeCloseTo(0.45, 5);
      expect(dbData.qualityScore).toBeCloseTo(0.45, 5);
    });

    it('updates generator model scores on partial outcome', async () => {
      const mockModel = {
        id: 'gen-model',
        capabilities: { scores: { code: 0.5 } },
        benchmarkSummary: {
          lastRunAt: 1000,
          taskCategories: ['code'],
          scores: { code: 0.5 },
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
        outcome: 'partial',
      });

      expect(mockUpdateBenchmarkSummary).toHaveBeenCalled();
      const summary = mockUpdateBenchmarkSummary.mock.calls[0][1];
      expect(summary.scores.code).toBeCloseTo(0.50, 5); // 0.5 * 0.9 + 0.5 * 0.1
      expect(summary.qualityScore).toBeCloseTo(0.50, 5);

      expect(mockUpdateModelData).toHaveBeenCalled();
      const dbData = mockUpdateModelData.mock.calls[0][1];
      expect(dbData.scores.code).toBeCloseTo(0.50, 5);
      expect(dbData.qualityScore).toBeCloseTo(0.50, 5);
    });

    it('gracefully handles SQLite database miss for generator updates', async () => {
      const mockModel = {
        id: 'gen-model',
        capabilities: { scores: { code: 0.5 } },
        benchmarkSummary: {
          lastRunAt: 1000,
          taskCategories: ['code'],
          scores: { code: 0.5 },
          qualityScore: 0.5,
          benchmarkCount: 2,
        },
      };
      mockGetModel.mockReturnValue(mockModel);
      mockGetDatabase.mockReturnValue({ models: {} });

      const result = await rateModel({
        modelId: 'gen-model',
        jobId: 'job-123',
        role: 'generator',
        outcome: 'positive',
      });

      expect(result.success).toBe(true);
      expect(mockUpdateBenchmarkSummary).toHaveBeenCalled();
      expect(mockUpdateModelData).not.toHaveBeenCalled();
    });

    it('updates validator model scores on positive outcome', async () => {
      const mockModel = {
        id: 'val-model',
        capabilities: { scores: { validate: 0.8 } },
        benchmarkSummary: {
          lastRunAt: 1000,
          taskCategories: ['validate'],
          scores: { validate: 0.8 },
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

      const result = await rateModel({
        modelId: 'val-model',
        jobId: 'job-123',
        role: 'validator',
        outcome: 'positive',
      });

      expect(result.success).toBe(true);
      expect(mockUpdateBenchmarkSummary).toHaveBeenCalled();
      const summary = mockUpdateBenchmarkSummary.mock.calls[0][1];
      expect(summary.scores.validate).toBeCloseTo(0.82, 5); // 0.8 * 0.9 + 1.0 * 0.1
      expect(summary.benchmarkCount).toBe(5);

      expect(mockUpdateModelData).toHaveBeenCalled();
      const dbData = mockUpdateModelData.mock.calls[0][1];
      expect(dbData.scores.validate).toBeCloseTo(0.82, 5);
      expect(dbData.benchmarkCount).toBe(5);
    });

    it('updates validator model scores on partial outcome', async () => {
      const mockModel = {
        id: 'val-model',
        capabilities: { scores: { validate: 0.8 } },
        benchmarkSummary: {
          lastRunAt: 1000,
          taskCategories: ['validate'],
          scores: { validate: 0.8 },
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

      const result = await rateModel({
        modelId: 'val-model',
        jobId: 'job-123',
        role: 'validator',
        outcome: 'partial',
      });

      expect(result.success).toBe(true);
      expect(mockUpdateBenchmarkSummary).toHaveBeenCalled();
      const summary = mockUpdateBenchmarkSummary.mock.calls[0][1];
      expect(summary.scores.validate).toBeCloseTo(0.77, 5); // 0.8 * 0.9 + 0.5 * 0.1
      expect(summary.benchmarkCount).toBe(5);

      expect(mockUpdateModelData).toHaveBeenCalled();
      const dbData = mockUpdateModelData.mock.calls[0][1];
      expect(dbData.scores.validate).toBeCloseTo(0.77, 5);
      expect(dbData.benchmarkCount).toBe(5);
    });

    it('gracefully handles SQLite database miss for validator updates', async () => {
      const mockModel = {
        id: 'val-model',
        contextWindow: 8000,
        benchmarkSummary: {
          lastRunAt: 1000,
          taskCategories: ['validate'],
          scores: { validate: 0.8 },
          successRate: 0.9,
          qualityScore: 0.85,
          avgResponseTime: 1200,
          benchmarkCount: 4,
        },
      };
      mockGetModel.mockReturnValue(mockModel);
      mockGetDatabase.mockReturnValue({ models: {} });

      const result = await rateModel({
        modelId: 'val-model',
        jobId: 'job-123',
        role: 'validator',
        outcome: 'positive',
      });

      expect(result.success).toBe(true);
      expect(mockUpdateBenchmarkSummary).toHaveBeenCalled();
      expect(mockUpdateModelData).not.toHaveBeenCalled();
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

    it('handles job result when it is not a JSON array (e.g. plain object or string)', async () => {
      mockGetModel.mockReturnValue({ id: 'gen-model', capabilities: { scores: {} } });
      mockGetJob.mockResolvedValue({
        id: 'job-123',
        task_text: 'write quicksort',
        result: JSON.stringify({ code: 'function quicksort() {}' }),
      });
      mockReadFile.mockResolvedValue(JSON.stringify([]));

      const result = await rateModel({
        modelId: 'gen-model',
        jobId: 'job-123',
        role: 'generator',
        outcome: 'negative',
      });

      expect(result.success).toBe(true);
      expect(mockWriteFile).toHaveBeenCalled();
      const [, writtenContent] = mockWriteFile.mock.calls[0];
      const parsed = JSON.parse(writtenContent);
      expect(parsed[0].output).toBe('[object Object]');
    });

    it('respects process.env.DB_DIR when writing candidate and handles file errors', async () => {
      const originalDbDir = process.env.DB_DIR;
      process.env.DB_DIR = 'custom-db-dir';
      
      mockGetModel.mockReturnValue({ id: 'gen-model', capabilities: { scores: {} } });
      mockGetJob.mockResolvedValue({
        id: 'job-123',
        task_text: 'write test',
        result: 'plain output',
      });
      mockReadFile.mockResolvedValue(JSON.stringify([]));
      
      try {
        const result = await rateModel({
          modelId: 'gen-model',
          jobId: 'job-123',
          role: 'generator',
          outcome: 'negative',
        });
        
        expect(result.success).toBe(true);
        const [writtenPath] = mockWriteFile.mock.calls[0];
        expect(writtenPath).toContain('custom-db-dir');
      } finally {
        process.env.DB_DIR = originalDbDir;
      }
    });

    it('fails gracefully when writing fixture candidate fails', async () => {
      mockGetModel.mockReturnValue({ id: 'gen-model', capabilities: { scores: {} } });
      mockGetJob.mockResolvedValue({
        id: 'job-123',
        task_text: 'write test',
        result: 'some output',
      });
      mockReadFile.mockResolvedValue(JSON.stringify([]));
      mockWriteFile.mockRejectedValueOnce(new Error('Disk Full'));

      const result = await rateModel({
        modelId: 'gen-model',
        jobId: 'job-123',
        role: 'generator',
        outcome: 'negative',
      });

      expect(result.success).toBe(false);
      expect(result.message).toContain('Disk Full');
    });
  });
});
