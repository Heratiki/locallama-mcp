import { benchmarkModule } from '../../../src/modules/benchmark/index.js';
import { costMonitor } from '../../../src/modules/cost-monitor/index.js';
import { BenchmarkTaskParams, BenchmarkResult } from '../../../src/types/index.js';
import axios from 'axios';

// Mock dependencies
jest.mock('axios');
jest.mock('../../../src/modules/cost-monitor/index.js');
jest.mock('../../../src/utils/logger.js', () => ({
  logger: {
    info: jest.fn(),
    debug: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
}));
jest.mock('fs/promises', () => ({
  mkdir: jest.fn().mockResolvedValue(undefined),
  writeFile: jest.fn().mockResolvedValue(undefined),
}));

describe('Benchmark Module', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    
    // Mock costMonitor.getAvailableModels
    (costMonitor.getAvailableModels as jest.Mock).mockResolvedValue([
      {
        id: 'llama3',
        name: 'Llama 3',
        provider: 'lm-studio',
        capabilities: {
          chat: true,
          completion: true,
        },
        costPerToken: {
          prompt: 0,
          completion: 0,
        },
        contextWindow: 8192,
      },
      {
        id: 'gpt-3.5-turbo',
        name: 'GPT-3.5 Turbo',
        provider: 'openai',
        capabilities: {
          chat: true,
          completion: true,
        },
        costPerToken: {
          prompt: 0.000001,
          completion: 0.000002,
        },
        contextWindow: 16384,
      },
    ]);
    
    // Mock axios.post for LM Studio
    (axios.post as jest.Mock).mockImplementation((url, data, config) => {
      if (url.includes('lm-studio')) {
        return Promise.resolve({
          status: 200,
          data: {
            choices: [
              {
                message: {
                  content: 'This is a test response from LM Studio',
                },
              },
            ],
            usage: {
              prompt_tokens: 10,
              completion_tokens: 20,
              total_tokens: 30,
            },
          },
        });
      } else if (url.includes('ollama')) {
        return Promise.resolve({
          status: 200,
          data: {
            message: {
              content: 'This is a test response from Ollama',
            },
          },
        });
      } else {
        return Promise.reject(new Error('Unknown API endpoint'));
      }
    });
  });
  
  describe('benchmarkTask', () => {
    it('should benchmark a single task with local and paid models', async () => {
      // Arrange
      const taskParams: BenchmarkTaskParams = {
        taskId: 'test-task-1',
        task: 'Write a function to calculate the factorial of a number',
        contextLength: 100,
        expectedOutputLength: 50,
        complexity: 0.5,
      };
      
      // Act
      const result = await benchmarkModule.benchmarkTask(taskParams, {
        ...benchmarkModule.defaultConfig,
        runsPerTask: 1, // Use 1 run for faster tests
        saveResults: false, // Don't save results to disk
      });
      
      // Assert
      expect(result).toBeDefined();
      expect(result.taskId).toBe('test-task-1');
      expect(result.local.model).toBe('llama3');
      expect(result.paid.model).toBe('gpt-3.5-turbo');
      expect(result.local.successRate).toBeGreaterThanOrEqual(0);
      expect(result.local.successRate).toBeLessThanOrEqual(1);
      expect(result.paid.successRate).toBeGreaterThanOrEqual(0);
      expect(result.paid.successRate).toBeLessThanOrEqual(1);
      expect(result.local.tokenUsage.total).toBeGreaterThan(0);
      expect(result.paid.tokenUsage.total).toBeGreaterThan(0);
      expect(result.paid.cost).toBeGreaterThan(0);
    });
    
    it('should throw an error if no local model is available', async () => {
      // Arrange
      (costMonitor.getAvailableModels as jest.Mock).mockResolvedValue([
        {
          id: 'gpt-3.5-turbo',
          name: 'GPT-3.5 Turbo',
          provider: 'openai',
          capabilities: {
            chat: true,
            completion: true,
          },
          costPerToken: {
            prompt: 0.000001,
            completion: 0.000002,
          },
        },
      ]);
      
      const taskParams: BenchmarkTaskParams = {
        taskId: 'test-task-2',
        task: 'Write a function to calculate the factorial of a number',
        contextLength: 100,
        expectedOutputLength: 50,
        complexity: 0.5,
      };
      
      // Act & Assert
      await expect(benchmarkModule.benchmarkTask(taskParams)).rejects.toThrow('No local model available for benchmarking');
    });
  });
  
  describe('benchmarkTasks', () => {
    it('should benchmark multiple tasks and generate a summary', async () => {
      // Arrange
      const taskParams: BenchmarkTaskParams[] = [
        {
          taskId: 'test-task-1',
          task: 'Write a function to calculate the factorial of a number',
          contextLength: 100,
          expectedOutputLength: 50,
          complexity: 0.5,
        },
        {
          taskId: 'test-task-2',
          task: 'Implement a binary search algorithm',
          contextLength: 150,
          expectedOutputLength: 75,
          complexity: 0.7,
        },
      ];
      
      // Act
      const summary = await benchmarkModule.benchmarkTasks(taskParams, {
        ...benchmarkModule.defaultConfig,
        runsPerTask: 1, // Use 1 run for faster tests
        saveResults: false, // Don't save results to disk
      });
      
      // Assert
      expect(summary).toBeDefined();
      expect(summary.taskCount).toBe(2);
      expect(summary.local.avgTimeTaken).toBeGreaterThan(0);
      expect(summary.paid.avgTimeTaken).toBeGreaterThan(0);
      expect(summary.comparison.timeRatio).toBeGreaterThan(0);
      expect(summary.comparison.costSavings).toBeGreaterThan(0);
    });
  });
  
  describe('evaluateQuality', () => {
    it('should evaluate the quality of a response', () => {
      // Arrange
      const task = 'Write a function to calculate the factorial of a number';
      const response = `
Here's a function to calculate the factorial of a number:

\`\`\`javascript
function factorial(n) {
  if (n === 0 || n === 1) {
    return 1;
  }
  return n * factorial(n - 1);
}
\`\`\`

This is a recursive implementation. For large numbers, you might want to use an iterative approach to avoid stack overflow.
`;
      
      // Act
      const quality = benchmarkModule.evaluateQuality(task, response);
      
      // Assert
      expect(quality).toBeGreaterThan(0);
      expect(quality).toBeLessThanOrEqual(1);
    });
  });
  
  describe('generateSummary', () => {
    it('should generate a summary from benchmark results', () => {
      // Arrange
      const results: BenchmarkResult[] = [
        {
          taskId: 'test-task-1',
          task: 'Write a function to calculate the factorial of a number',
          contextLength: 100,
          outputLength: 50,
          complexity: 0.5,
          local: {
            model: 'llama3',
            timeTaken: 1000,
            successRate: 0.9,
            qualityScore: 0.8,
            tokenUsage: {
              prompt: 100,
              completion: 50,
              total: 150,
            },
          },
          paid: {
            model: 'gpt-3.5-turbo',
            timeTaken: 500,
            successRate: 1.0,
            qualityScore: 0.9,
            tokenUsage: {
              prompt: 100,
              completion: 50,
              total: 150,
            },
            cost: 0.0002,
          },
          timestamp: new Date().toISOString(),
        },
        {
          taskId: 'test-task-2',
          task: 'Implement a binary search algorithm',
          contextLength: 150,
          outputLength: 75,
          complexity: 0.7,
          local: {
            model: 'llama3',
            timeTaken: 1500,
            successRate: 0.8,
            qualityScore: 0.7,
            tokenUsage: {
              prompt: 150,
              completion: 75,
              total: 225,
            },
          },
          paid: {
            model: 'gpt-3.5-turbo',
            timeTaken: 600,
            successRate: 1.0,
            qualityScore: 0.95,
            tokenUsage: {
              prompt: 150,
              completion: 75,
              total: 225,
            },
            cost: 0.0003,
          },
          timestamp: new Date().toISOString(),
        },
      ];
      
      // Act
      const summary = benchmarkModule.generateSummary(results);
      
      // Assert
      expect(summary).toBeDefined();
      expect(summary.taskCount).toBe(2);
      expect(summary.avgContextLength).toBe(125);
      expect(summary.avgOutputLength).toBe(62.5);
      expect(summary.avgComplexity).toBe(0.6);
      expect(summary.local.avgTimeTaken).toBe(1250);
      expect(summary.paid.avgTimeTaken).toBe(550);
      expect(summary.local.avgSuccessRate).toBe(0.85);
      expect(summary.paid.avgSuccessRate).toBe(1.0);
      expect(summary.comparison.timeRatio).toBeCloseTo(1250 / 550, 5);
      expect(summary.comparison.successRateDiff).toBe(-0.15);
      expect(summary.comparison.qualityScoreDiff).toBe(-0.175);
      expect(summary.comparison.costSavings).toBe(0.0005);
    });
    
    it('should throw an error if no results are provided', () => {
      // Act & Assert
      expect(() => benchmarkModule.generateSummary([])).toThrow('No benchmark results to summarize');
    });
  });
});