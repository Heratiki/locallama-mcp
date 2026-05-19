import { describe, expect, it } from '@jest/globals';

const { ProviderRateLimiter } = await import('../../../../dist/modules/core/provider/rate-limiter.js');

describe('ProviderRateLimiter', () => {
  it('queues calls when a provider exceeds its local concurrency cap', async () => {
    const limiter = new ProviderRateLimiter({
      maxConcurrentLocal: 1,
      maxConcurrentRemote: 2,
    });

    let active = 0;
    let maxObservedActive = 0;

    const run = async (label: string): Promise<string> => {
      active += 1;
      maxObservedActive = Math.max(maxObservedActive, active);
      await new Promise((resolve) => setTimeout(resolve, 20));
      active -= 1;
      return label;
    };

    const [first, second, third] = await Promise.all([
      limiter.schedule('ollama', 'local', async () => await run('first')),
      limiter.schedule('ollama', 'local', async () => await run('second')),
      limiter.schedule('ollama', 'local', async () => await run('third')),
    ]);

    expect([first, second, third]).toEqual(['first', 'second', 'third']);
    expect(maxObservedActive).toBe(1);
  });
});
