import { tokenManager } from '../../../src/modules/cost-monitor/tokenManager.js';
import { logger } from '../../../src/utils/logger.js';

// Mock dependencies
jest.mock('../../../src/utils/logger');

describe('Token Manager', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    tokenManager.clearCache();
  });

  describe('token counting', () => {
    test('counts tokens in text', () => {
      const text = 'This is a test text';
      const count = tokenManager.countTokens(text);
      expect(count).toBeGreaterThan(0);
    });

    test('counts tokens in chat messages', () => {
      const messages = [
        { role: 'system', content: 'You are a helpful assistant.' },
        { role: 'user', content: 'Hello' },
        { role: 'assistant', content: 'Hi there!' }
      ];
      const count = tokenManager.countTokensInMessages(messages);
      expect(count).toBeGreaterThan(0);
    });

    test('handles messages with name field', () => {
      const messages = [
        { role: 'system', content: 'You are a helpful assistant.' },
        { role: 'user', content: 'Hello', name: 'User1' },
        { role: 'assistant', content: 'Hi there!', name: 'Assistant1' }
      ];
      const count = tokenManager.countTokensInMessages(messages);
      expect(count).toBeGreaterThan(0);
    });
  });

  describe('token usage calculation', () => {
    test('calculates usage for prompt and completion', () => {
      const prompt = 'This is a test prompt';
      const completion = 'This is a test completion';
      const usage = tokenManager.calculateUsage(prompt, completion);
      
      expect(usage.promptTokens).toBeGreaterThan(0);
      expect(usage.completionTokens).toBeGreaterThan(0);
      expect(usage.totalTokens).toBe(usage.promptTokens + usage.completionTokens);
    });

    test('calculates code-specific usage', () => {
      const code = 'function test() {\n  console.log("hello");\n}';
      const componentName = 'testFunction';
      const usage = tokenManager.calculateCodeUsage(code, componentName);
      
      expect(usage.promptTokens).toBeGreaterThan(0);
      expect(usage.codeComponentTokens![componentName]).toBeGreaterThan(0);
    });
  });

  describe('code task optimization', () => {
    test('splits code task by tokens', () => {
      const taskDescription = 'Create a React component with state management';
      const codeContext = {
        language: 'typescript',
        imports: ['react', 'useState'],
        symbols: ['Button', 'Input'],
        dependencies: { 'react-dom': '18.2.0' },
        tokensPerSection: { 'components': 100, 'utils': 50 }
      };
      const maxContextWindow = 4096;

      const subtasks = tokenManager.splitCodeTaskByTokens(
        taskDescription,
        codeContext,
        maxContextWindow
      );

      expect(subtasks.length).toBeGreaterThan(0);
      expect(subtasks[0]).toHaveProperty('description');
      expect(subtasks[0]).toHaveProperty('tokenCount');
    });

    test('identifies code sections', () => {
      const code = `
        import React from 'react';
        
        function TestComponent() {
          const [state, setState] = useState(null);
          return <div>Test</div>;
        }
        
        export default TestComponent;
      `;

      const sections = tokenManager.identifyCodeSections(code);
      expect(sections.length).toBeGreaterThan(0);
      expect(sections[0]).toHaveProperty('content');
      expect(sections[0]).toHaveProperty('complexity');
    });

    test('estimates code complexity', () => {
      const simpleCode = 'console.log("hello");';
      const complexCode = `
        async function processData(input) {
          try {
            const results = await Promise.all(
              input.map(async item => {
                const processed = await transform(item);
                return processed.filter(x => x.valid);
              })
            );
            return results.reduce((acc, curr) => ({ ...acc, ...curr }), {});
          } catch (error) {
            console.error('Processing failed:', error);
            throw new Error('Data processing failed');
          }
        }
      `;

      const simpleComplexity = tokenManager.estimateComplexity(simpleCode);
      const highComplexity = tokenManager.estimateComplexity(complexCode);

      expect(simpleComplexity).toBeLessThan(highComplexity);
      expect(simpleComplexity).toBeLessThanOrEqual(1);
      expect(highComplexity).toBeLessThanOrEqual(1);
    });

    test('infers code type', () => {
      const reactComponent = `
        function Button() {
          return <button>Click me</button>;
        }
      `;
      const utilityFunction = `
        function formatDate(date) {
          return new Date(date).toLocaleDateString();
        }
      `;

      const componentType = tokenManager.inferCodeType(reactComponent);
      const utilityType = tokenManager.inferCodeType(utilityFunction);

      expect(componentType).toBe('component');
      expect(utilityType).toBe('utility');
    });
  });

  describe('context optimization', () => {
    test('optimizes code context', () => {
      const context = `
        import React from 'react';
        import { useState, useEffect } from 'react';
        
        // Old component implementation
        function OldComponent() {
          return <div>Old</div>;
        }
        
        // Current implementation
        function CurrentComponent() {
          const [state, setState] = useState(null);
          useEffect(() => {
            // Some effect
          }, []);
          return <div>Current</div>;
        }
      `;
      const taskDescription = 'Update CurrentComponent to handle new requirements';
      const maxTokens = 2048;

      const optimized = tokenManager.optimizeCodeContext(context, taskDescription, maxTokens);
      expect(optimized.length).toBeLessThan(context.length);
      expect(optimized).toContain('CurrentComponent');
      expect(optimized).not.toContain('OldComponent');
    });

    test('calculates section relevance', () => {
      const section = `
        function processUserData(user) {
          return {
            id: user.id,
            name: user.name,
            email: user.email
          };
        }
      `;
      const relevantTask = 'Update user data processing';
      const irrelevantTask = 'Create a new UI component';

      const relevantScore = tokenManager.calculateRelevance(section, relevantTask);
      const irrelevantScore = tokenManager.calculateRelevance(section, irrelevantTask);

      expect(relevantScore).toBeGreaterThan(irrelevantScore);
    });

    test('summarizes code sections', () => {
      const section = `
        function calculateTotal(items) {
          return items
            .map(item => item.price * item.quantity)
            .reduce((sum, current) => sum + current, 0);
        }
      `;

      const summary = tokenManager.summarizeSection(section);
      expect(summary.length).toBeLessThan(section.length);
      expect(summary).toContain('calculate');
      expect(summary).toContain('total');
    });
  });

  describe('cache management', () => {
    test('caches token counts', () => {
      const text = 'This is a test text';
      
      // First call should calculate
      const count1 = tokenManager.countTokens(text);
      // Second call should use cache
      const count2 = tokenManager.countTokens(text);

      expect(count1).toBe(count2);
    });

    test('clears cache', () => {
      const text = 'This is a test text';
      const count1 = tokenManager.countTokens(text);
      
      tokenManager.clearCache();
      
      // Cache was cleared, should recalculate
      const count2 = tokenManager.countTokens(text);
      expect(count1).toBe(count2);
    });

    test('generates consistent cache keys', () => {
      const prompt1 = 'Test prompt';
      const prompt2 = 'Different prompt';

      const key1a = tokenManager.generateCacheKey(prompt1);
      const key1b = tokenManager.generateCacheKey(prompt1);
      const key2 = tokenManager.generateCacheKey(prompt2);

      expect(key1a).toBe(key1b);
      expect(key1a).not.toBe(key2);
    });
  });
});