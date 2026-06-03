import { describe, expect, it, jest, beforeEach } from '@jest/globals';

// ── Mocks ─────────────────────────────────────────────────────────────────────

jest.unstable_mockModule('../../../dist/utils/logger.js', () => ({
  logger: {
    error: jest.fn(),
    warn: jest.fn(),
    info: jest.fn(),
    debug: jest.fn(),
  },
}));

const mockReadFile = jest.fn<any>();
const mockMkdir = jest.fn<any>().mockResolvedValue(undefined);
const mockWriteFile = jest.fn<any>().mockResolvedValue(undefined);
jest.unstable_mockModule('fs/promises', () => ({
  default: {
    readFile: mockReadFile,
    mkdir: mockMkdir,
    writeFile: mockWriteFile,
  },
  readFile: mockReadFile,
  mkdir: mockMkdir,
  writeFile: mockWriteFile,
}));

// Load the module after mocks
const { loadValidateTasks } = await import('../../../dist/modules/benchmark/core/model-benchmarker.js');

describe('loadValidateTasks (Unit Tests)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should load validation fixtures and transform into YES/NO tasks', async () => {
    const mockFixtures = [
      {
        task: 'Write a python addition function.',
        known_good_output: 'def add(a, b):\n    return a + b',
        known_bad_output: 'def add(a, b):\n    return a - b',
        language: 'python'
      }
    ];
    mockReadFile.mockResolvedValue(JSON.stringify(mockFixtures));

    const tasks = await loadValidateTasks();
    expect(tasks).toHaveLength(2);

    // First task should test known good output expecting YES
    expect(tasks[0].expectedVerdict).toBe('YES');
    expect(tasks[0].task).toContain('Write a python addition function.');
    expect(tasks[0].task).toContain('def add(a, b):\n    return a + b');
    expect(tasks[0].complexity).toBe(0.3);
    expect(tasks[0].expectedOutputLength).toBe(4);

    // Second task should test known bad output expecting NO
    expect(tasks[1].expectedVerdict).toBe('NO');
    expect(tasks[1].task).toContain('def add(a, b):\n    return a - b');
  });

  it('should support language filtering', async () => {
    const mockFixtures = [
      {
        task: 'Python task',
        known_good_output: 'good py',
        known_bad_output: 'bad py',
        language: 'python'
      },
      {
        task: 'JS task',
        known_good_output: 'good js',
        known_bad_output: 'bad js',
        language: 'javascript'
      }
    ];
    mockReadFile.mockResolvedValue(JSON.stringify(mockFixtures));

    const pyTasks = await loadValidateTasks('python');
    expect(pyTasks).toHaveLength(2);
    expect(pyTasks[0].task).toContain('Python task');

    const jsTasks = await loadValidateTasks('javascript');
    expect(jsTasks).toHaveLength(2);
    expect(jsTasks[0].task).toContain('JS task');
  });
});
