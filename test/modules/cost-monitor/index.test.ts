import { costMonitor } from '../../../src/modules/cost-monitor/index.js';
import { config } from '../../../src/config/index.js';
import axios from 'axios';

// Mock dependencies
jest.mock('axios');
jest.mock('../../../src/config/index.js');
jest.mock('../../../src/utils/logger.js', () => ({
  logger: {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn()
  }
}));

describe('Cost Monitor', () => {
  // Reset mocks before each test
  beforeEach(() => {
    jest.resetAllMocks();
    
    // Set default config values for testing
    (config as jest.Mocked<typeof config>).lmStudioEndpoint = 'http://localhost:1234/v1';
    (config as jest.Mocked<typeof config>).ollamaEndpoint = 'http://localhost:11434/api';
    (config as jest.Mocked<typeof config>).costThreshold = 0.02;
    (config as jest.Mocked<typeof config>).defaultLocalModel = 'llama3';
  });
  
  describe('getApiUsage', () => {
    test('returns API usage statistics for a given API', async () => {
      const result = await costMonitor.getApiUsage('openai');
      
      expect(result.api).toBe('openai');
      expect(result.tokenUsage).toHaveProperty('prompt');
      expect(result.tokenUsage).toHaveProperty('completion');
      expect(result.tokenUsage).toHaveProperty('total');
      expect(result.cost).toHaveProperty('prompt');
      expect(result.cost).toHaveProperty('completion');
      expect(result.cost).toHaveProperty('total');
      expect(result.timestamp).toBeDefined();
    });
  });
  
  describe('getAvailableModels', () => {
    test('fetches models from LM Studio and Ollama', async () => {
      // Mock LM Studio response
      (axios.get as jest.Mock).mockResolvedValueOnce({
        data: {
          data: [
            { id: 'llama3' },
            { id: 'mistral-7b' }
          ]
        }
      });
      
      // Mock Ollama response
      (axios.get as jest.Mock).mockResolvedValueOnce({
        data: {
          models: [
            { name: 'llama3:8b' },
            { name: 'phi3:mini' }
          ]
        }
      });
      
      const result = await costMonitor.getAvailableModels();
      
      // Should combine models from both providers
      expect(result.length).toBe(4);
      expect(result.some(m => m.id === 'llama3' && m.provider === 'lm-studio')).toBe(true);
      expect(result.some(m => m.id === 'mistral-7b' && m.provider === 'lm-studio')).toBe(true);
      expect(result.some(m => m.id === 'llama3:8b' && m.provider === 'ollama')).toBe(true);
      expect(result.some(m => m.id === 'phi3:mini' && m.provider === 'ollama')).toBe(true);
      
      // Verify context window assignment
      const llama3Model = result.find(m => m.id === 'llama3');
      expect(llama3Model?.contextWindow).toBe(8192); // From the modelContextWindows mapping
      
      // Verify axios calls
      expect(axios.get).toHaveBeenCalledWith('http://localhost:1234/v1/models');
      expect(axios.get).toHaveBeenCalledWith('http://localhost:11434/api/tags');
    });
    
    test('handles LM Studio API failure', async () => {
      // Mock LM Studio failure
      (axios.get as jest.Mock).mockRejectedValueOnce(new Error('Connection refused'));
      
      // Mock Ollama success
      (axios.get as jest.Mock).mockResolvedValueOnce({
        data: {
          models: [
            { name: 'llama3:8b' },
            { name: 'phi3:mini' }
          ]
        }
      });
      
      const result = await costMonitor.getAvailableModels();
      
      // Should still return Ollama models
      expect(result.length).toBe(2);
      expect(result.some(m => m.id === 'llama3:8b' && m.provider === 'ollama')).toBe(true);
      expect(result.some(m => m.id === 'phi3:mini' && m.provider === 'ollama')).toBe(true);
    });
    
    test('handles Ollama API failure', async () => {
      // Mock LM Studio success
      (axios.get as jest.Mock).mockResolvedValueOnce({
        data: {
          data: [
            { id: 'llama3' },
            { id: 'mistral-7b' }
          ]
        }
      });
      
      // Mock Ollama failure
      (axios.get as jest.Mock).mockRejectedValueOnce(new Error('Connection refused'));
      
      const result = await costMonitor.getAvailableModels();
      
      // Should still return LM Studio models
      expect(result.length).toBe(2);
      expect(result.some(m => m.id === 'llama3' && m.provider === 'lm-studio')).toBe(true);
      expect(result.some(m => m.id === 'mistral-7b' && m.provider === 'lm-studio')).toBe(true);
    });
    
    test('returns default models when both APIs fail', async () => {
      // Mock both APIs failing
      (axios.get as jest.Mock).mockRejectedValueOnce(new Error('Connection refused'));
      (axios.get as jest.Mock).mockRejectedValueOnce(new Error('Connection refused'));
      
      const result = await costMonitor.getAvailableModels();
      
      // Should return default fallback models
      expect(result.length).toBe(1);
      expect(result[0].id).toBe('llama3');
      expect(result[0].provider).toBe('local');
      expect(result[0].contextWindow).toBe(8192);
    });
  });
  
  describe('estimateCost', () => {
    test('estimates cost based on context and output length', async () => {
      const result = await costMonitor.estimateCost({
        contextLength: 5000,
        outputLength: 1000
      });
      
      // Local cost should be 0
      expect(result.local.cost.total).toBe(0);
      
      // Paid cost should be calculated based on token counts
      expect(result.paid.cost.prompt).toBe(5000 * 0.000001);
      expect(result.paid.cost.completion).toBe(1000 * 0.000002);
      expect(result.paid.cost.total).toBe(5000 * 0.000001 + 1000 * 0.000002);
      
      // Token counts should be correct
      expect(result.local.tokenCount.prompt).toBe(5000);
      expect(result.local.tokenCount.completion).toBe(1000);
      expect(result.local.tokenCount.total).toBe(6000);
      
      expect(result.paid.tokenCount.prompt).toBe(5000);
      expect(result.paid.tokenCount.completion).toBe(1000);
      expect(result.paid.tokenCount.total).toBe(6000);
    });
    
    test('handles default output length', async () => {
      const result = await costMonitor.estimateCost({
        contextLength: 3000,
        // Not providing outputLength
      });
      
      // Should use default output length of 0
      expect(result.local.tokenCount.completion).toBe(0);
      expect(result.local.tokenCount.total).toBe(3000);
      
      expect(result.paid.tokenCount.completion).toBe(0);
      expect(result.paid.tokenCount.total).toBe(3000);
      
      // Paid cost should only include prompt tokens
      expect(result.paid.cost.prompt).toBe(3000 * 0.000001);
      expect(result.paid.cost.completion).toBe(0);
      expect(result.paid.cost.total).toBe(3000 * 0.000001);
    });
    
    test('recommendation based on cost threshold', async () => {
      // Set cost threshold
      (config as jest.Mocked<typeof config>).costThreshold = 0.005;
      
      // Test with cost below threshold
      const resultBelowThreshold = await costMonitor.estimateCost({
        contextLength: 2000,
        outputLength: 500
      });
      
      // Total cost = 2000 * 0.000001 + 500 * 0.000002 = 0.003
      // This is below threshold, so should recommend paid
      expect(resultBelowThreshold.recommendation).toBe('paid');
      
      // Test with cost above threshold
      const resultAboveThreshold = await costMonitor.estimateCost({
        contextLength: 8000,
        outputLength: 2000
      });
      
      // Total cost = 8000 * 0.000001 + 2000 * 0.000002 = 0.012
      // This is above threshold, so should recommend local
      expect(resultAboveThreshold.recommendation).toBe('local');
    });
  });
});