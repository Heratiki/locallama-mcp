import NewComponent from '../../../src/modules/new-module/newComponent.js';
import { logger } from '../../../src/utils/logger.js';

// Mock dependencies
jest.mock('../../../src/utils/logger.js');

describe('New Component', () => {
  let newComponent: NewComponent;

  beforeEach(() => {
    jest.clearAllMocks();
    newComponent = new NewComponent();
  });

  describe('data management', () => {
    test('initializes with empty data array', () => {
      // Access private field using type assertion
      expect((newComponent as any).data).toEqual([]);
    });

    test('adds data to internal storage', () => {
      const testData = { key: 'value' };
      newComponent.addData(testData);
      // Access private field using type assertion
      expect((newComponent as any).data).toContainEqual(testData);
    });

    test('retrieves stored data', () => {
      const testData1 = { key: 'value1' };
      const testData2 = { key: 'value2' };
      newComponent.addData(testData1);
      newComponent.addData(testData2);
      expect(newComponent.getData()).toEqual([testData1, testData2]);
    });

    test('maintains data order', () => {
      const testData1 = { key: 'value1' };
      const testData2 = { key: 'value2' };
      const testData3 = { key: 'value3' };
      newComponent.addData(testData1);
      newComponent.addData(testData2);
      newComponent.addData(testData3);
      expect(newComponent.getData()).toEqual([testData1, testData2, testData3]);
    });
  });

  describe('validation', () => {
    test('validates data before adding', () => {
      const invalidData = null;
      expect(() => newComponent.addData(invalidData)).toThrow('Invalid data');
    });

    test('handles undefined data', () => {
      const undefinedData = undefined;
      expect(() => newComponent.addData(undefinedData)).toThrow('Invalid data');
    });

    test('handles non-object data', () => {
      const nonObjectData = 'string';
      expect(() => newComponent.addData(nonObjectData)).toThrow('Invalid data type');
    });
  });

  describe('performance', () => {
    test('handles large amounts of data', () => {
      const largeDataSet = Array.from({ length: 1000 }, (_, i) => ({ key: `value${i}` }));
      largeDataSet.forEach(data => newComponent.addData(data));
      expect(newComponent.getData()).toHaveLength(1000);
    });

    test('maintains performance with repeated operations', () => {
      const start = performance.now();
      for (let i = 0; i < 1000; i++) {
        newComponent.addData({ key: `value${i}` });
      }
      const end = performance.now();
      expect(end - start).toBeLessThan(1000); // Should take less than 1 second
    });
  });

  describe('error handling', () => {
    test('logs errors when adding invalid data', () => {
      const invalidData = null;
      try {
        newComponent.addData(invalidData);
      } catch (error) {
        // Error should be logged
      }
      expect(logger.error).toHaveBeenCalled();
    });

    test('preserves existing data when error occurs', () => {
      const validData = { key: 'valid' };
      const invalidData = null;
      
      newComponent.addData(validData);
      try {
        newComponent.addData(invalidData);
      } catch (error) {
        // Error is expected
      }
      
      expect(newComponent.getData()).toEqual([validData]);
    });

    test('throws appropriate error types', () => {
      expect(() => newComponent.addData(null)).toThrow('Invalid data');
      expect(() => newComponent.addData(undefined)).toThrow('Invalid data');
      expect(() => newComponent.addData('string')).toThrow('Invalid data type');
      expect(() => newComponent.addData(123)).toThrow('Invalid data type');
    });
  });
});