import { describe, expect, it } from '@jest/globals';

const { ProviderRateLimiter } = await import('../../../../dist/modules/core/provider/rate-limiter.js');

describe('ProviderRateLimiter', () => {
  it('queues calls when a local provider exceeds the shared local concurrency cap', async () => {
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

  it('shares the local slot across different local providers', async () => {
    const limiter = new ProviderRateLimiter({
      maxConcurrentLocal: 1,
      maxConcurrentRemote: 1,
    });

    const events: string[] = [];
    let releaseFirst: (() => void) | undefined;

    const first = limiter.schedule('ollama', 'local', async () => {
      events.push('ollama:start');
      await new Promise<void>((resolve) => {
        releaseFirst = resolve;
      });
      events.push('ollama:end');
      return 'ollama';
    });

    const second = limiter.schedule('lm-studio', 'local', async () => {
      events.push('lm-studio:start');
      return 'lm-studio';
    });

    await Promise.resolve();
    await new Promise((resolve) => setTimeout(resolve, 5));

    expect(events).toEqual(['ollama:start']);

    releaseFirst?.();
    await expect(Promise.all([first, second])).resolves.toEqual(['ollama', 'lm-studio']);
    expect(events).toEqual(['ollama:start', 'ollama:end', 'lm-studio:start']);
  });

  it('runs a remote provider and a local provider at the same time', async () => {
    const limiter = new ProviderRateLimiter({
      maxConcurrentLocal: 1,
      maxConcurrentRemote: 1,
    });

    const active = new Set<string>();
    let observedOverlap = false;

    const run = async (label: string): Promise<string> => {
      active.add(label);
      observedOverlap = observedOverlap || (active.has('ollama') && active.has('openrouter'));
      await new Promise((resolve) => setTimeout(resolve, 20));
      active.delete(label);
      return label;
    };

    const [local, remote] = await Promise.all([
      limiter.schedule('ollama', 'local', async () => await run('ollama')),
      limiter.schedule('openrouter', 'remote', async () => await run('openrouter')),
    ]);

    expect([local, remote]).toEqual(['ollama', 'openrouter']);
    expect(observedOverlap).toBe(true);
  });
});
