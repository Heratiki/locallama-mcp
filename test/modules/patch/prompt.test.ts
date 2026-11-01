import { describe, expect, it } from '@jest/globals';
import { buildPrompt } from '../../../dist/modules/patch/prompt/builder.js';
import { PATCH_SYSTEM_PROMPT } from '../../../dist/modules/patch/prompt/system.js';
import { countTokens } from '../../../dist/modules/utils/tokenCount.js';
import type { CheckResult, EditBlock } from '../../../src/modules/patch/types.js';

const cfg = { modelContextWindow: 32768, contextTokens: 6000, maxOutputTokens: 2000, errorTailTokens: 800 };
const check = (tail: string): CheckResult => ({ name: 'tsc', exit_code: 1, timed_out: false, duration_ms: 1, tail });
const blk = (s: string, r: string): EditBlock => ({ path: 'src/a.ts', search: s, replace: r });

describe('buildPrompt', () => {
  it('system prompt is the edit-block prompt, not whole-implementation', () => {
    expect(PATCH_SYSTEM_PROMPT).toContain('<<<<<<< SEARCH');
    expect(PATCH_SYSTEM_PROMPT.toLowerCase()).not.toContain('whole implementation');
  });

  it('attempt 1 has goal and files, no errors', async () => {
    const p = await buildPrompt({ ...cfg, goal: 'fix the bug', attempt: 1, hintedFiles: [{ path: 'src/a.ts', content: 'const a=1;\n' }] });
    expect(p.prompt).toContain('fix the bug');
    expect(p.prompt).toContain('src/a.ts');
    expect(p.prompt).not.toContain('Errors from your last attempt');
  });

  it('attempt 2+ has the last check tail and last blocks and nothing older', async () => {
    const p = await buildPrompt({
      ...cfg, goal: 'g', attempt: 3,
      lastChecks: [check('LAST_TAIL error TS2322')],
      lastBlocks: [blk('LAST_SEARCH\n', 'LAST_REPLACE\n')],
    });
    expect(p.prompt).toContain('LAST_TAIL error TS2322');
    expect(p.prompt).toContain('LAST_SEARCH');
    expect(p.prompt).toContain('LAST_REPLACE');
    expect(p.prompt).not.toContain('OLD_TAIL');
    expect(p.prompt).not.toContain('OLD_SEARCH');
  });

  it('never exceeds the budget, with huge inputs and a small window', async () => {
    const big = 'let value = compute(items);\n'.repeat(7000);
    for (const win of [3000, 4096, 8192, 32768]) {
      const p = await buildPrompt({
        ...cfg, modelContextWindow: win, goal: big, attempt: 2,
        hintedFiles: [{ path: 'a', content: big }, { path: 'b', content: big }],
        lastChecks: [check(big)], lastBlocks: [blk(big, big)],
        search: async () => [{ path: 'c', content: big }],
      });
      expect(countTokens(p.prompt) + countTokens(p.system) + cfg.maxOutputTokens)
        .toBeLessThanOrEqual(Math.min(win, cfg.contextTokens));
    }
  });

  it('fill order: goal, hinted files, errors and blocks, then BM25', async () => {
    const p = await buildPrompt({
      ...cfg, goal: 'GOAL_X', attempt: 2,
      hintedFiles: [{ path: 'hint.ts', content: 'HINT_BODY' }],
      lastChecks: [check('ERR_BODY')], lastBlocks: [blk('S\n', 'R\n')],
      search: async () => [{ path: 'rel.ts', content: 'REL_BODY' }],
    });
    const idx = ['GOAL_X', 'HINT_BODY', 'ERR_BODY', 'S\n=======', 'REL_BODY'].map(s => p.prompt.indexOf(s));
    expect(idx.every(i => i >= 0)).toBe(true);
    expect([...idx].sort((a, b) => a - b)).toEqual(idx);
  });

  it('never exceeds the budget with code-heavy text (many short tokens)', async () => {
    const code = '{[(a=>b)]};\n'.repeat(8000);
    for (const win of [3000, 4096, 6000, 32768]) {
      const p = await buildPrompt({
        ...cfg, modelContextWindow: win, goal: code, attempt: 2,
        hintedFiles: [{ path: 'a', content: code }],
        lastChecks: [check(code)], lastBlocks: [blk(code, code)],
        search: async () => [{ path: 'c', content: code }],
      });
      expect(countTokens(p.prompt) + countTokens(p.system) + cfg.maxOutputTokens)
        .toBeLessThanOrEqual(Math.min(win, cfg.contextTokens));
    }
  });

  it('when the budget is tight, BM25 is dropped before the goal and hinted files', async () => {
    const p = await buildPrompt({
      ...cfg, modelContextWindow: 2900, contextTokens: 6000, maxOutputTokens: 2000, goal: 'GOAL_X', attempt: 1,
      hintedFiles: [{ path: 'hint.ts', content: 'let h = go();\n'.repeat(300) }],
      search: async () => [{ path: 'rel.ts', content: 'REL_BODY' }],
    });
    expect(p.prompt).toContain('GOAL_X');
    expect(p.prompt).toContain('[file cut: hint.ts]');
    expect(p.prompt).not.toContain('REL_BODY');
  });

  it('a hinted file is not repeated by search', async () => {
    const p = await buildPrompt({
      ...cfg, goal: 'g', attempt: 1, hintedFiles: [{ path: 'a.ts', content: 'A' }],
      search: async () => [{ path: 'a.ts', content: 'DUP' }],
    });
    expect(p.prompt).not.toContain('DUP');
  });
});
