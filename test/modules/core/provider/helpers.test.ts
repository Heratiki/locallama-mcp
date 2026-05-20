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
const {
  ProviderRegistry,
  _setProviderRegistryForTests,
  isProviderLocal,
  providerCostClass,
  isProviderId,
} = providerModule;

function fakeProvider(id: string, costClass: 'local' | 'free' | 'paid', isLocal: boolean) {
  return {
    id,
    displayName: id,
    costClass,
    isLocal,
    init: jest.fn(() => Promise.resolve()),
    isAvailable: jest.fn(() => Promise.resolve(true)),
    listModels: jest.fn(() => Promise.resolve([])),
    supportsModel: jest.fn(() => false),
    executeTask: jest.fn(() => Promise.resolve({ content: '', model: id })),
    getCost: jest.fn(() => ({ prompt: 0, completion: 0 })),
  };
}

describe('provider helpers', () => {
  beforeEach(() => {
    _setProviderRegistryForTests(new ProviderRegistry());
  });

  describe('isProviderLocal', () => {
    it('trusts a registered provider', () => {
      const registry = new ProviderRegistry();
      registry.register(fakeProvider('custom', 'local', true));
      _setProviderRegistryForTests(registry);
      expect(isProviderLocal('custom')).toBe(true);
    });

    it('returns false for a registered non-local provider', () => {
      const registry = new ProviderRegistry();
      registry.register(fakeProvider('openrouter', 'paid', false));
      _setProviderRegistryForTests(registry);
      expect(isProviderLocal('openrouter')).toBe(false);
    });

    it('falls back to the known-local set when registry is empty', () => {
      expect(isProviderLocal('lm-studio')).toBe(true);
      expect(isProviderLocal('ollama')).toBe(true);
      expect(isProviderLocal('local')).toBe(true);
      expect(isProviderLocal('openrouter')).toBe(false);
      expect(isProviderLocal('mystery')).toBe(false);
    });

    it('handles null/undefined gracefully', () => {
      expect(isProviderLocal(undefined)).toBe(false);
      expect(isProviderLocal(null)).toBe(false);
      expect(isProviderLocal('')).toBe(false);
    });
  });

  describe('providerCostClass', () => {
    it('returns the registered cost class', () => {
      const registry = new ProviderRegistry();
      registry.register(fakeProvider('mystery-free', 'free', false));
      _setProviderRegistryForTests(registry);
      expect(providerCostClass('mystery-free')).toBe('free');
    });

    it("falls back to 'local' for known-local ids and 'paid' otherwise", () => {
      expect(providerCostClass('lm-studio')).toBe('local');
      expect(providerCostClass('openrouter')).toBe('paid');
      expect(providerCostClass(undefined)).toBe('paid');
    });
  });

  describe('isProviderId', () => {
    it('matches when the registered provider id equals expected', () => {
      const registry = new ProviderRegistry();
      registry.register(fakeProvider('lm-studio', 'local', true));
      _setProviderRegistryForTests(registry);
      expect(isProviderId('lm-studio', 'lm-studio')).toBe(true);
      expect(isProviderId('lm-studio', 'ollama')).toBe(false);
    });

    it('falls back to direct comparison when registry has no entry', () => {
      expect(isProviderId('lm-studio', 'lm-studio')).toBe(true);
      expect(isProviderId('lm-studio', 'openrouter')).toBe(false);
    });

    it('handles null/undefined', () => {
      expect(isProviderId(undefined, 'lm-studio')).toBe(false);
      expect(isProviderId(null, 'lm-studio')).toBe(false);
    });
  });
});
