import { describe, expect, it } from '@jest/globals';
import { buildLadder } from '../../../dist/modules/patch/ladder/build.js';
import { normalizeModelId, parseParamsB } from '../../../dist/modules/patch/ladder/model-match.js';

function local(id: string, ids: string[]): any {
  return {
    id, displayName: id, costClass: 'local', isLocal: true,
    isAvailable: async () => true,
    listModels: async () => ids.map(i => ({ id: i })),
    getCost: () => ({ prompt: 0, completion: 0 }),
  };
}
const base = { localModels: 3, freeModels: 0, paidModels: 0, allowPaid: false, freeOnly: true };

/** A registry shaped like the real one: key -> metadata. */
function registry(entries: Record<string, any>): any {
  return {
    getModel: (id: string) => entries[id],
    listAll: () => Object.entries(entries).map(([id, m]) => ({ id, ...m })),
  };
}
const benched = (code: number) => ({
  capabilities: { scores: { code } },
  benchmarkSummary: { lastRunAt: 1, taskCategories: ['code'], scores: { code } },
});
// rate_model EMA / seeding writes a code score with no 'code' benchmark category
const seeded = (code: number) => ({
  capabilities: { scores: { code } },
  benchmarkSummary: { lastRunAt: 1, taskCategories: [], scores: { code }, benchmarkCount: 2 },
});

describe('ladder ranking (#153)', () => {
  it('a seeded/heuristic code score counts as no score', async () => {
    const p = local('ollama', ['ollama:tinyllama:latest', 'ollama:mistral:7b']);
    const l = await buildLadder({
      ...base, providers: { list: () => [p] },
      models: registry({
        'ollama:tinyllama:latest': seeded(0.9),
        'ollama:mistral:7b': benched(0.4),
      }),
    });
    expect(l.map(e => e.model_id)).toEqual(['ollama:mistral:7b', 'ollama:tinyllama:latest']);
  });

  it('normalizer strips provider prefix and .gguf; matches stored rows', async () => {
    expect(normalizeModelId('llama-cpp:Qwen3-8B-Q4_K_M.gguf')).toBe(normalizeModelId('Qwen3-8B-Q4_K_M'));
    expect(normalizeModelId('ollama:tinyllama:latest')).toBe('tinyllama:latest');
    const p = local('llama-cpp', ['Qwen3-8B-Q4_K_M', 'other-3B']);
    const l = await buildLadder({
      ...base, localModels: 2, providers: { list: () => [p] },
      models: registry({
        'llama-cpp:Qwen3-8B-Q4_K_M.gguf': benched(0.75),
        'other-3B': benched(0.3),
      }),
    });
    expect(l.map(e => e.model_id)).toEqual(['Qwen3-8B-Q4_K_M', 'other-3B']);
  });

  it('unscored models rank by parameter size parsed from the id', async () => {
    expect(parseParamsB('Qwen3-8B-Q4_K_M')).toBe(8);
    expect(parseParamsB('gemma-4-12B-it-qat-UD-Q4_K_XL')).toBe(12);
    expect(parseParamsB('Qwen3-4B-Instruct-2507-Q4_K_M')).toBe(4);
    expect(parseParamsB('mistral:7b')).toBe(7);
    expect(parseParamsB('llama3.2:3b')).toBe(3);
    expect(parseParamsB('ollama:tinyllama:latest')).toBe(1.1);
    expect(parseParamsB('mystery')).toBeUndefined();
    const p = local('x', ['ollama:tinyllama:latest', 'llama3.2:3b', 'Qwen3-4B-Instruct-2507-Q4_K_M', 'Qwen3-8B-Q4_K_M']);
    const l = await buildLadder({ ...base, localModels: 4, providers: { list: () => [p] }, models: registry({}) });
    expect(l.map(e => e.model_id)).toEqual([
      'Qwen3-8B-Q4_K_M', 'Qwen3-4B-Instruct-2507-Q4_K_M', 'llama3.2:3b', 'ollama:tinyllama:latest',
    ]);
  });

  it('current data: scored Qwen3-8B (via normalization) ranks above seeded tinyllama', async () => {
    const p = local('mixed', ['ollama:tinyllama:latest', 'ollama:mistral:7b', 'Qwen3-8B-Q4_K_M']);
    const l = await buildLadder({
      ...base, providers: { list: () => [p] },
      models: registry({
        'ollama:tinyllama:latest': seeded(0.6),
        'llama-cpp:Qwen3-8B-Q4_K_M.gguf': benched(0.76),
      }),
    });
    expect(l.map(e => e.model_id)).toEqual(['Qwen3-8B-Q4_K_M', 'ollama:mistral:7b', 'ollama:tinyllama:latest']);
  });
});
