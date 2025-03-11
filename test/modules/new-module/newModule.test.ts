import NewModule from '../../../src/modules/new-module/newModule.js';
import NewComponent from '../../../src/modules/new-module/newComponent.js';
import { logger } from '../../../src/utils/logger.js';

// Mock dependencies
jest.mock('../../../src/modules/new-module/newComponent.js');
jest.mock('../../../src/utils/logger.js');

describe('New Module', () => {
  let newModule: NewModule;

  beforeEach(() => {
    jest.clearAllMocks();
    newModule = new NewModule();
  });

  describe('initialization', () => {
    test('creates new component instance', () => {
      expect(NewComponent).toHaveBeenCalled();
    });
  });

  describe('data management', () => {
    test('adds data to component', () => {
      const testData = { key: 'value' };
      newModule.addDataToComponent(testData);
      expect((newModule as any).newComponent.addData).toHaveBeenCalledWith(testData);
    });

    test('retrieves data from component', () => {
      const mockData = [{ key: 'value1' }, { key: 'value2' }];
      (NewComponent as jest.Mock).mockImplementation(() => ({
        getData: jest.fn().mockReturnValue(mockData)
      }));

      const result = newModule.getDataFromComponent();
      expect(result).toEqual(mockData);
    });
  });

  describe('error handling', () => {
    test('handles component initialization failure', () => {
      (NewComponent as jest.Mock).mockImplementation(() => {
        throw new Error('Initialization failed');
      });

      expect(() => new NewModule()).toThrow('Initialization failed');
    });

    test('handles data addition errors', () => {
      (NewComponent as jest.Mock).mockImplementation(() => ({
        addData: jest.fn().mockImplementation(() => {
          throw new Error('Data addition failed');
        })
      }));

      expect(() => newModule.addDataToComponent({ key: 'value' })).toThrow('Data addition failed');
    });

    test('handles data retrieval errors', () => {
      (NewComponent as jest.Mock).mockImplementation(() => ({
        getData: jest.fn().mockImplementation(() => {
          throw new Error('Data retrieval failed');
        })
      }));

      expect(() => newModule.getDataFromComponent()).toThrow('Data retrieval failed');
    });
  });
});