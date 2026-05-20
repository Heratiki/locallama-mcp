import { describe, expect, it, jest, beforeEach } from '@jest/globals';

jest.unstable_mockModule('../../../dist/utils/logger.js', () => ({
  logger: {
    error: jest.fn(),
    warn: jest.fn(),
    info: jest.fn(),
    debug: jest.fn(),
  },
}));

const capModule = await import(
  '../../../dist/modules/core/capability-detector.js'
);
const {
  CapabilityDetector,
  initCapabilityDetector,
  getCapabilityDetector,
  _setCapabilityDetectorForTests,
} = capModule;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function fakeProviderModel(
  id: string,
  overrides: Record<string, unknown> = {},
) {
  return { id, displayName: id, family: undefined, contextWindow: 4096, ...overrides };
}

/**
 * Minimal ModelRegistry shape used by the CapabilityDetector instance.
 */
function fakeRegistry(models: Record<string, unknown> = {}) {
  return {
    getModel: (id: string) => models[id] as unknown,
  };
}

// ---------------------------------------------------------------------------
// Static inferFromProviderModel — data-driven heuristic table
// ---------------------------------------------------------------------------

describe('CapabilityDetector.inferFromProviderModel', () => {
  const cases: Array<{
    label: string;
    model: { id: string; family?: string; contextWindow?: number };
    expected: { code: boolean; vision: boolean; toolUse: boolean; largeContext: boolean };
  }> = [
    // Acceptance criterion: qwen2.5-coder-7b → code + toolUse, no largeContext
    {
      label: 'qwen2.5-coder-7b',
      model: { id: 'qwen2.5-coder-7b' },
      expected: { code: true, toolUse: true, largeContext: false, vision: false },
    },
    // Llama 3.1 — toolUse from id pattern, large context from contextWindow
    {
      label: 'llama-3.1-70b-instruct (128k ctx)',
      model: { id: 'llama-3.1-70b-instruct', contextWindow: 131072 },
      expected: { code: false, vision: false, toolUse: true, largeContext: true },
    },
    // Llava — vision model, no tool-use pattern match
    {
      label: 'llava-13b',
      model: { id: 'llava-13b' },
      expected: { code: false, vision: true, toolUse: false, largeContext: false },
    },
    // DeepSeek Coder — code by family
    {
      label: 'deepseek-coder-33b',
      model: { id: 'deepseek-coder-33b', family: 'deepseek-coder' },
      expected: { code: true, vision: false, toolUse: false, largeContext: false },
    },
    // DeepSeek Coder — small (6.7B < 7B), no toolUse
    {
      label: 'deepseek-coder-6.7b',
      model: { id: 'deepseek-coder-6.7b', family: 'deepseek-coder' },
      expected: { code: true, vision: false, toolUse: false, largeContext: false },
    },
    // CodeLlama by family
    {
      label: 'codellama-13b-instruct (family: codellama)',
      model: { id: 'codellama-13b-instruct', family: 'codellama' },
      expected: { code: true, vision: false, toolUse: false, largeContext: false },
    },
    // Starcoder by family
    {
      label: 'starcoder2-15b (family: starcoder)',
      model: { id: 'starcoder2-15b', family: 'starcoder' },
      expected: { code: true, vision: false, toolUse: false, largeContext: false },
    },
    // Mistral-large — toolUse from id pattern
    {
      label: 'mistral-large-2411',
      model: { id: 'mistral-large-2411' },
      expected: { code: false, vision: false, toolUse: true, largeContext: false },
    },
    // Generic chat model — only chat
    {
      label: 'phi-3-mini-4k',
      model: { id: 'phi-3-mini-4k', contextWindow: 4096 },
      expected: { code: false, vision: false, toolUse: false, largeContext: false },
    },
    // largeContext: contextWindow exactly 32768
    {
      label: 'any-model-32k (contextWindow=32768)',
      model: { id: 'any-model-32k', contextWindow: 32768 },
      expected: { code: false, vision: false, toolUse: false, largeContext: true },
    },
    // largeContext: just below threshold
    {
      label: 'any-model-31k (contextWindow=31768)',
      model: { id: 'any-model-31k', contextWindow: 31768 },
      expected: { code: false, vision: false, toolUse: false, largeContext: false },
    },
    // Vision by id pattern — qwen2-vl (not qwen2.5, so no toolUse)
    {
      label: 'qwen2-vl-7b',
      model: { id: 'qwen2-vl-7b' },
      expected: { code: false, vision: true, toolUse: false, largeContext: false },
    },
    // qwen2.5 with smaller parameters — still toolUse via id pattern (no size tag)
    {
      label: 'qwen2.5-7b-instruct (no size in id check)',
      model: { id: 'qwen2.5-7b-instruct' },
      expected: { code: false, vision: false, toolUse: true, largeContext: false },
    },
    // 1.5B model — below toolUse floor
    {
      label: 'qwen2.5-coder-1.5b',
      model: { id: 'qwen2.5-coder-1.5b' },
      expected: { code: true, vision: false, toolUse: false, largeContext: false },
    },
  ];

  for (const { label, model, expected } of cases) {
    it(`${label}`, () => {
      const caps = CapabilityDetector.inferFromProviderModel(fakeProviderModel(model.id, {
        family: model.family,
        contextWindow: model.contextWindow ?? 4096,
      }));
      expect(caps.chat).toBe(true); // always true
      expect(caps.code).toBe(expected.code);
      expect(caps.vision).toBe(expected.vision);
      expect(caps.toolUse).toBe(expected.toolUse);
      expect(caps.largeContext).toBe(expected.largeContext);
    });
  }
});

// ---------------------------------------------------------------------------
// Instance detectCapabilities — three-layer logic
// ---------------------------------------------------------------------------

describe('CapabilityDetector.detectCapabilities', () => {
  let detector: InstanceType<typeof CapabilityDetector>;

  beforeEach(() => {
    _setCapabilityDetectorForTests(undefined);
  });

  it('returns conservative defaults for an unknown model', () => {
    const registry = fakeRegistry({});
    detector = new CapabilityDetector(registry);
    const caps = detector.detectCapabilities('unknown-model');
    expect(caps.chat).toBe(true);
    expect(caps.code).toBe(false);
    expect(caps.vision).toBe(false);
    expect(caps.toolUse).toBe(false);
    expect(caps.largeContext).toBe(false);
    expect(caps.maxContextTokens).toBe(4096);
  });

  it('returns stored capabilities for a known model with no benchmark data', () => {
    const registry = fakeRegistry({
      'qwen2.5-coder-7b': {
        id: 'qwen2.5-coder-7b',
        capabilities: { chat: true, code: true, vision: false, toolUse: true, largeContext: false, maxContextTokens: 4096 },
        benchmarkSummary: undefined,
      },
    });
    detector = new CapabilityDetector(registry);
    const caps = detector.detectCapabilities('qwen2.5-coder-7b');
    expect(caps.code).toBe(true);
    expect(caps.toolUse).toBe(true);
  });

  it('applies empirical correction: code score 0.1 flips code to false', () => {
    const registry = fakeRegistry({
      'qwen2.5-coder-7b': {
        id: 'qwen2.5-coder-7b',
        family: 'qwen-coder',
        capabilities: {
          chat: true, code: true, vision: false, toolUse: true,
          largeContext: false, maxContextTokens: 4096,
        },
        benchmarkSummary: {
          lastRunAt: Date.now(),
          taskCategories: ['code'],
          scores: { code: 0.1 },
        },
      },
    });
    detector = new CapabilityDetector(registry);
    const caps = detector.detectCapabilities('qwen2.5-coder-7b');
    // Score 0.1 < 0.3 threshold — code flag must flip to false
    expect(caps.code).toBe(false);
    expect(caps.scores?.code).toBe(0.1);
  });

  it('keeps code=true when benchmark score is 0.3 (threshold boundary)', () => {
    const registry = fakeRegistry({
      'coder-model': {
        id: 'coder-model',
        capabilities: {
          chat: true, code: true, vision: false, toolUse: false,
          largeContext: false, maxContextTokens: 4096,
        },
        benchmarkSummary: {
          lastRunAt: Date.now(),
          taskCategories: ['code'],
          scores: { code: 0.3 },
        },
      },
    });
    detector = new CapabilityDetector(registry);
    const caps = detector.detectCapabilities('coder-model');
    expect(caps.code).toBe(true); // 0.3 >= 0.3 — stays true
  });

  it('derives toolUse heuristic even if stored capability is false', () => {
    // Simulates a model seeded before toolUse heuristic existed
    const registry = fakeRegistry({
      'llama-3.1-70b': {
        id: 'llama-3.1-70b',
        family: 'llama',
        capabilities: {
          chat: true, code: false, vision: false, toolUse: false, // old value
          largeContext: false, maxContextTokens: 8192,
        },
        benchmarkSummary: undefined,
      },
    });
    detector = new CapabilityDetector(registry);
    const caps = detector.detectCapabilities('llama-3.1-70b');
    expect(caps.toolUse).toBe(true); // heuristic layer catches it
  });
});

// ---------------------------------------------------------------------------
// Singleton lifecycle
// ---------------------------------------------------------------------------

describe('initCapabilityDetector / getCapabilityDetector', () => {
  beforeEach(() => {
    _setCapabilityDetectorForTests(undefined);
  });

  it('throws if getCapabilityDetector() is called before init', () => {
    expect(() => getCapabilityDetector()).toThrow('not initialized');
  });

  it('returns the same instance after init', () => {
    const registry = fakeRegistry({});
    const d1 = initCapabilityDetector(registry);
    const d2 = getCapabilityDetector();
    expect(d1).toBe(d2);
  });

  it('_setCapabilityDetectorForTests resets the singleton', () => {
    const registry = fakeRegistry({});
    initCapabilityDetector(registry);
    _setCapabilityDetectorForTests(undefined);
    expect(() => getCapabilityDetector()).toThrow('not initialized');
  });
});
