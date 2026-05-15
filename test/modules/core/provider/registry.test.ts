import { describe, expect, it, jest, beforeEach } from '@jest/globals';

jest.unstable_mockModule('../../../../dist/utils/logger.js', () => ({
  logger: {
    error: jest.fn(),
    warn: jest.fn(),
    info: jest.fn(),
    debug: jest.fn(),
  },
}));

const providerModule = await import('../../../../dist/modules/core/provider/index.js');
const { ProviderRegistry, getProviderRegistry, _setProviderRegistryForTests } = providerModule;

type CostClass = 'local' | 'free' | 'paid';

interface FakeProviderOptions {
  id: string;
  costClass: CostClass;
  isLocal: boolean;
  initImpl?: () => Promise<void>;
  modelIds?: string[];
}

function makeProvider(opts: FakeProviderOptions) {
  const provider = {
    id: opts.id,
    displayName: opts.id,
    costClass: opts.costClass,
    isLocal: opts.isLocal,
    init: jest.fn(opts.initImpl ?? (() => Promise.resolve())),
    isAvailable: jest.fn(() => Promise.resolve(true)),
    listModels: jest.fn(() =>
      Promise.resolve((opts.modelIds ?? []).map((id) => ({ id }))),
    ),
    supportsModel: jest.fn((id: string) => (opts.modelIds ?? []).includes(id)),
    executeTask: jest.fn(() =>
      Promise.resolve({ content: 'ok', model: opts.id }),
    ),
    getCost: jest.fn(() => ({ prompt: 0, completion: 0 })),
  };
  return provider;
}

describe('ProviderRegistry', () => {
  let registry: InstanceType<typeof ProviderRegistry>;

  beforeEach(() => {
    registry = new ProviderRegistry();
  });

  it('registers and retrieves providers by id', () => {
    const p = makeProvider({ id: 'lm-studio', costClass: 'local', isLocal: true });
    registry.register(p);
    expect(registry.has('lm-studio')).toBe(true);
    expect(registry.get('lm-studio')).toBe(p);
    expect(registry.get('nope')).toBeUndefined();
  });

  it('lists providers and filters by cost class', () => {
    const local = makeProvider({ id: 'lm-studio', costClass: 'local', isLocal: true });
    const paid = makeProvider({ id: 'openrouter', costClass: 'paid', isLocal: false });
    registry.register(local);
    registry.register(paid);
    expect(registry.list().map((p) => p.id).sort()).toEqual(['lm-studio', 'openrouter']);
    expect(registry.listByCostClass('local').map((p) => p.id)).toEqual(['lm-studio']);
    expect(registry.listByCostClass('paid').map((p) => p.id)).toEqual(['openrouter']);
    expect(registry.listByCostClass('free')).toEqual([]);
  });

  it('isLocalProvider returns false for unknown providers', () => {
    const local = makeProvider({ id: 'ollama', costClass: 'local', isLocal: true });
    registry.register(local);
    expect(registry.isLocalProvider('ollama')).toBe(true);
    expect(registry.isLocalProvider('mystery')).toBe(false);
  });

  it('warns and overwrites when the same id is registered twice', () => {
    const a = makeProvider({ id: 'dup', costClass: 'local', isLocal: true });
    const b = makeProvider({ id: 'dup', costClass: 'paid', isLocal: false });
    registry.register(a);
    registry.register(b);
    expect(registry.get('dup')).toBe(b);
  });

  it('initAll isolates a failing provider from the others', async () => {
    const ok = makeProvider({ id: 'ok', costClass: 'local', isLocal: true });
    const bad = makeProvider({
      id: 'bad',
      costClass: 'paid',
      isLocal: false,
      initImpl: () => Promise.reject(new Error('boom')),
    });
    const okToo = makeProvider({ id: 'ok-too', costClass: 'free', isLocal: false });
    registry.register(ok);
    registry.register(bad);
    registry.register(okToo);

    const ready = await registry.initAll();
    expect(ready.sort()).toEqual(['ok', 'ok-too']);
    expect(ok.init).toHaveBeenCalledTimes(1);
    expect(bad.init).toHaveBeenCalledTimes(1);
    expect(okToo.init).toHaveBeenCalledTimes(1);
  });

  it('initAll is idempotent for already-initialized providers', async () => {
    const p = makeProvider({ id: 'p', costClass: 'local', isLocal: true });
    registry.register(p);
    await registry.initAll();
    await registry.initAll();
    expect(p.init).toHaveBeenCalledTimes(1);
  });

  it('unregister removes the provider and clears init state', async () => {
    const p = makeProvider({ id: 'p', costClass: 'local', isLocal: true });
    registry.register(p);
    await registry.initAll();
    expect(registry.unregister('p')).toBe(true);
    expect(registry.has('p')).toBe(false);
    registry.register(p);
    await registry.initAll();
    expect(p.init).toHaveBeenCalledTimes(2);
  });

  it('singleton accessor returns the same instance across calls', () => {
    const a = getProviderRegistry();
    const b = getProviderRegistry();
    expect(a).toBe(b);
    _setProviderRegistryForTests(undefined);
    const c = getProviderRegistry();
    expect(c).not.toBe(a);
    _setProviderRegistryForTests(undefined);
  });
});
