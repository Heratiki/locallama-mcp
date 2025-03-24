import { LocalLamaMcpServer } from '../src/index';

describe('LocalLamaMcpServer', () => {
  it('should start the server without errors', async () => {
    const server = new LocalLamaMcpServer();
    try {
      await server.run();
    } catch (error) {
      expect(error).toBeUndefined();
    }
  });
});