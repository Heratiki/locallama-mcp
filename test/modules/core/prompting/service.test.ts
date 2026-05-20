import { describe, expect, it, jest, beforeEach, afterEach } from '@jest/globals';
import os from 'os';
import path from 'path';
import fs from 'fs/promises';

// ---------------------------------------------------------------------------
// Mock logger so tests don't produce log output
// ---------------------------------------------------------------------------
jest.unstable_mockModule('../../../../dist/utils/logger.js', () => ({
  logger: {
    error: jest.fn(),
    warn: jest.fn(),
    info: jest.fn(),
    debug: jest.fn(),
  },
}));

// ---------------------------------------------------------------------------
// Import the module under test (from compiled dist)
// ---------------------------------------------------------------------------
const {
  PromptingStrategyService,
  getPromptingStrategyService,
  _setPromptingStrategyServiceForTests,
} = await import('../../../../dist/modules/core/prompting/service.js');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Write a minimal strategies.json to a temp file and return its path. */
async function writeTempStrategiesFile(
  tmpDir: string,
  content: object,
): Promise<string> {
  const filePath = path.join(tmpDir, 'test-strategies.json');
  await fs.writeFile(filePath, JSON.stringify(content));
  return filePath;
}

const MINIMAL_CONFIG = {
  strategies: [
    {
      id: 'default',
      systemPrompt: 'You are a helpful assistant.',
      useChat: true,
    },
    {
      id: 'coding',
      appliesTo: {
        families: ['codellama', 'qwen-coder'],
        modelIdPatterns: ['coder'],
      },
      systemPrompt: 'You are a coding assistant.',
      useChat: true,
    },
    {
      id: 'anthropic-or',
      appliesTo: {
        providerIds: ['openrouter'],
        families: ['claude'],
      },
      systemPrompt: 'You are Claude.',
      useChat: true,
    },
    {
      id: 'openrouter-generic',
      appliesTo: {
        providerIds: ['openrouter'],
      },
      systemPrompt: 'You are a helpful AI via OpenRouter.',
      useChat: true,
    },
    {
      id: 'llama',
      appliesTo: {
        families: ['llama'],
      },
      systemPrompt: 'You are Llama.',
      useChat: true,
    },
  ],
  defaultStrategyId: 'default',
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('PromptingStrategyService', () => {
  let svc: InstanceType<typeof PromptingStrategyService>;
  let tmpDir: string;

  beforeEach(async () => {
    svc = new PromptingStrategyService();
    _setPromptingStrategyServiceForTests(svc);
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'locallama-test-'));
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  // -------------------------------------------------------------------------
  // Loading
  // -------------------------------------------------------------------------

  describe('loadFromFile', () => {
    it('loads strategies from a valid JSON file', async () => {
      const filePath = await writeTempStrategiesFile(tmpDir, MINIMAL_CONFIG);
      await svc.loadFromFile(filePath);
      expect(svc.listStrategies()).toHaveLength(5);
      expect(svc.defaultId).toBe('default');
    });

    it('is a no-op when the file does not exist (ENOENT)', async () => {
      await svc.loadFromFile(path.join(tmpDir, 'nonexistent.json'));
      expect(svc.listStrategies()).toHaveLength(0);
    });

    it('logs a warning and skips on malformed JSON', async () => {
      const filePath = path.join(tmpDir, 'bad.json');
      await fs.writeFile(filePath, '{ not json }');
      await svc.loadFromFile(filePath); // should not throw
      expect(svc.listStrategies()).toHaveLength(0);
    });

    it('warns and skips when strategies field is not an array', async () => {
      const filePath = path.join(tmpDir, 'wrong-type.json');
      await fs.writeFile(filePath, JSON.stringify({ strategies: 'not-an-array', defaultStrategyId: 'default' }));
      await svc.loadFromFile(filePath);
      expect(svc.listStrategies()).toHaveLength(0);
    });

    it('uses defaultStrategyId from config', async () => {
      const cfg = { ...MINIMAL_CONFIG, defaultStrategyId: 'coding' };
      const filePath = await writeTempStrategiesFile(tmpDir, cfg);
      await svc.loadFromFile(filePath);
      expect(svc.defaultId).toBe('coding');
    });
  });

  // -------------------------------------------------------------------------
  // resolveStrategyId — priority order
  // -------------------------------------------------------------------------

  describe('resolveStrategyId', () => {
    beforeEach(async () => {
      const filePath = await writeTempStrategiesFile(tmpDir, MINIMAL_CONFIG);
      await svc.loadFromFile(filePath);
    });

    it('priority 1: provider + family match beats family-only match', () => {
      // 'anthropic-or' requires openrouter + claude.
      // 'llama' would match family='claude' if it existed — but it doesn't.
      // This test verifies the provider+family tuple wins.
      const id = svc.resolveStrategyId('anthropic/claude-3-opus', 'claude', 'openrouter');
      expect(id).toBe('anthropic-or');
    });

    it('priority 2: provider-only match when no family restriction on that strategy', () => {
      // 'openrouter-generic' matches any openrouter model with no family
      // restriction. 'mistral' family has no strategy here, so falls to provider match.
      const id = svc.resolveStrategyId('mistralai/mistral-7b', 'mistral', 'openrouter');
      expect(id).toBe('openrouter-generic');
    });

    it('priority 3: family match when no provider given', () => {
      const id = svc.resolveStrategyId('llama3.2', 'llama', undefined);
      expect(id).toBe('llama');
    });

    it('priority 3: family match "qwen-coder" → coding strategy', () => {
      const id = svc.resolveStrategyId('qwen2.5-coder-7b', 'qwen-coder', 'lm-studio');
      expect(id).toBe('coding');
    });

    it('priority 4: modelId pattern match — "coder" in id', () => {
      // family='unknown', provider='lm-studio' — no strategy matches by provider or family
      // but the modelId contains "coder" which the coding strategy's modelIdPatterns cover
      const id = svc.resolveStrategyId('some-coder-model', 'unknown', 'lm-studio');
      expect(id).toBe('coding');
    });

    it('priority 4: invalid regex in modelIdPatterns is silently skipped', async () => {
      const configWithBadPattern = {
        ...MINIMAL_CONFIG,
        strategies: [
          ...MINIMAL_CONFIG.strategies,
          {
            id: 'bad-pattern-strategy',
            appliesTo: {
              modelIdPatterns: ['[invalid-regex'],
            },
            systemPrompt: 'Will not match.',
            useChat: true,
          },
        ],
      };
      const filePath = await writeTempStrategiesFile(tmpDir, configWithBadPattern);
      await svc.loadFromFile(filePath);
      // Should not throw; the bad pattern is silently skipped and falls back to default
      const id = svc.resolveStrategyId('[invalid-regex', undefined, undefined);
      expect(typeof id).toBe('string');
    });

    it('fallback: returns defaultStrategyId when nothing matches', () => {
      const id = svc.resolveStrategyId('gpt-4o', 'gpt', 'some-unknown-provider');
      expect(id).toBe('default');
    });

    it('fallback: returns defaultStrategyId when no strategies are loaded', () => {
      const emptySvc = new PromptingStrategyService();
      const id = emptySvc.resolveStrategyId('any-model', 'any-family', 'any-provider');
      expect(id).toBe('default');
    });
  });

  // -------------------------------------------------------------------------
  // getStrategy
  // -------------------------------------------------------------------------

  describe('getStrategy', () => {
    beforeEach(async () => {
      const filePath = await writeTempStrategiesFile(tmpDir, MINIMAL_CONFIG);
      await svc.loadFromFile(filePath);
    });

    it('returns the strategy definition for a known id', () => {
      const strategy = svc.getStrategy('coding');
      expect(strategy).toBeDefined();
      expect(strategy?.systemPrompt).toContain('coding');
    });

    it('returns undefined for an unknown id', () => {
      expect(svc.getStrategy('nonexistent')).toBeUndefined();
    });
  });

  // -------------------------------------------------------------------------
  // User override file helpers
  // -------------------------------------------------------------------------

  describe('mergeUserOverrides / readUserOverrides', () => {
    const overridePath = () => path.join(tmpDir, 'strategies.json');

    it('readUserOverrides returns {} when file does not exist', async () => {
      const result = await svc.readUserOverrides(overridePath());
      expect(result).toEqual({});
    });

    it('mergeUserOverrides creates the file on first write', async () => {
      await svc.mergeUserOverrides(
        { 'my-model': { modelId: 'my-model', systemPrompt: 'Custom!' } },
        overridePath(),
      );
      const written = JSON.parse(await fs.readFile(overridePath(), 'utf-8'));
      expect(written['my-model'].systemPrompt).toBe('Custom!');
    });

    it('mergeUserOverrides preserves existing entries for other models', async () => {
      // Write initial entry
      await svc.mergeUserOverrides(
        { 'model-a': { modelId: 'model-a', systemPrompt: 'A' } },
        overridePath(),
      );
      // Merge a second entry
      await svc.mergeUserOverrides(
        { 'model-b': { modelId: 'model-b', systemPrompt: 'B' } },
        overridePath(),
      );
      const result = await svc.readUserOverrides(overridePath());
      expect(result['model-a']?.systemPrompt).toBe('A');
      expect(result['model-b']?.systemPrompt).toBe('B');
    });

    it('mergeUserOverrides overwrites the entry for the same model id', async () => {
      await svc.mergeUserOverrides(
        { 'my-model': { modelId: 'my-model', systemPrompt: 'v1' } },
        overridePath(),
      );
      await svc.mergeUserOverrides(
        { 'my-model': { modelId: 'my-model', systemPrompt: 'v2' } },
        overridePath(),
      );
      const result = await svc.readUserOverrides(overridePath());
      expect(result['my-model']?.systemPrompt).toBe('v2');
    });

    it('readUserOverrides returns {} and warns for non-ENOENT errors', async () => {
      // Create a directory at the target path so fs.readFile fails with EISDIR
      const dirPath = path.join(tmpDir, 'dir-not-file.json');
      await fs.mkdir(dirPath, { recursive: true });
      const result = await svc.readUserOverrides(dirPath);
      expect(result).toEqual({});
    });

    it('mergeUserOverrides warns and does not throw when write fails', async () => {
      // Create a directory at the output path so fs.writeFile fails with EISDIR
      const dirPath = path.join(tmpDir, 'not-a-file.json');
      await fs.mkdir(dirPath, { recursive: true });
      await expect(
        svc.mergeUserOverrides({ 'x': { modelId: 'x', systemPrompt: 'y' } }, dirPath),
      ).resolves.not.toThrow();
    });
  });

  // -------------------------------------------------------------------------
  // Singleton accessor
  // -------------------------------------------------------------------------

  describe('getPromptingStrategyService singleton', () => {
    it('returns the same instance on repeated calls', () => {
      const a = getPromptingStrategyService();
      const b = getPromptingStrategyService();
      expect(a).toBe(b);
    });

    it('_setPromptingStrategyServiceForTests replaces the singleton', () => {
      const custom = new PromptingStrategyService();
      _setPromptingStrategyServiceForTests(custom);
      expect(getPromptingStrategyService()).toBe(custom);
    });

    it('auto-creates singleton when reset to undefined', () => {
      _setPromptingStrategyServiceForTests(undefined);
      const auto = getPromptingStrategyService();
      expect(auto).toBeInstanceOf(PromptingStrategyService);
      // Restore
      _setPromptingStrategyServiceForTests(svc);
    });
  });
});
