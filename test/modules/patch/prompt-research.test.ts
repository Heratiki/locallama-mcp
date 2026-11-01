import { describe, expect, it } from '@jest/globals';
import { buildPrompt } from '../../../dist/modules/patch/prompt/builder.js';
import { countTokens } from '../../../dist/modules/utils/tokenCount.js';
import type { CheckResult } from '../../../src/modules/patch/types.js';

const cfg = { modelContextWindow: 32768, contextTokens: 6000, maxOutputTokens: 2000, errorTailTokens: 800 };
const check = (tail: string): CheckResult => ({ name: 'tsc', exit_code: 1, timed_out: false, duration_ms: 1, tail });

describe('buildPrompt research notes (#155)', () => {
  it('adds one "## Research notes" section after the errors section on attempt 2+', async () => {
    const p = await buildPrompt({
      ...cfg, goal: 'g', attempt: 2,
      lastChecks: [check('ERR_BODY')],
      researchNotes: 'NOTE_BODY',
      search: async () => [{ path: 'rel.ts', content: 'REL_BODY' }],
    });
    expect(p.prompt).toContain('## Research notes');
    expect(p.prompt).toContain('NOTE_BODY');
    const errIndex = p.prompt.indexOf('## Errors from your last attempt');
    const researchIndex = p.prompt.indexOf('## Research notes');
    const relatedIndex = p.prompt.indexOf('## Related: rel.ts');
    expect(errIndex).toBeGreaterThanOrEqual(0);
    expect(researchIndex).toBeGreaterThan(errIndex);
    expect(relatedIndex).toBeGreaterThan(researchIndex);
  });

  it('has no research section on attempt 1 or without notes (#155 criteria 1, 14)', async () => {
    const first = await buildPrompt({ ...cfg, goal: 'g', attempt: 1, researchNotes: 'NOTE_BODY' });
    expect(first.prompt).not.toContain('## Research notes');
    const second = await buildPrompt({ ...cfg, goal: 'g', attempt: 2 });
    expect(second.prompt).not.toContain('## Research notes');
  });

  it('never lets the research section break the prompt budget (#155 criterion 11)', async () => {
    const huge = `[repo] src/a.ts: ${'export const value = compute();\n'.repeat(900)}`;
    for (const win of [3000, 4096, 6000, 32768]) {
      const p = await buildPrompt({
        ...cfg, modelContextWindow: win, goal: 'GOAL_X', attempt: 2,
        lastChecks: [check('ERR_BODY')], researchNotes: huge,
      });
      expect(p.prompt).toContain('GOAL_X');
      expect(countTokens(p.prompt) + countTokens(p.system) + cfg.maxOutputTokens)
        .toBeLessThanOrEqual(Math.min(win, cfg.contextTokens));
    }
  });

  it('research notes are dropped before the goal and errors when the budget is tight', async () => {
    const p = await buildPrompt({
      ...cfg, modelContextWindow: 2200, goal: 'GOAL_X', attempt: 2,
      lastChecks: [check('ERR_BODY')], researchNotes: 'RESEARCH_MUST_DROP',
    });
    expect(p.prompt).toContain('GOAL_X');
    expect(p.prompt).toContain('ERR_BODY');
    expect(p.prompt).not.toContain('## Research notes');
    expect(p.prompt).not.toContain('RESEARCH_MUST_DROP');
  });
});
