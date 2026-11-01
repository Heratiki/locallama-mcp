import { describe, expect, it } from '@jest/globals';
import { parseEditBlocks } from '../../../dist/modules/patch/edit-blocks/parser.js';

const blk = (p: string, s: string, r: string) =>
  `${p}\n<<<<<<< SEARCH\n${s}=======\n${r}>>>>>>> REPLACE\n`;

describe('parseEditBlocks', () => {
  it('parses a plain block', () => {
    const out = parseEditBlocks(blk('src/a.ts', 'old\n', 'new\n'));
    expect(out.errors).toEqual([]);
    expect(out.blocks).toEqual([{ path: 'src/a.ts', search: 'old\n', replace: 'new\n' }]);
  });

  it('parses several blocks with prose around them', () => {
    const text = `Sure, here you go:\n\n${blk('a.ts', 'x\n', 'y\n')}\nand also\n\n${blk('b.ts', '', 'z\n')}\nHope that helps.`;
    const out = parseEditBlocks(text);
    expect(out.blocks.map(b => b.path)).toEqual(['a.ts', 'b.ts']);
    expect(out.blocks[1].search).toBe('');
  });

  it('strips <think> blocks, including markers inside them', () => {
    const text = `<think>try\n${blk('bad.ts', 'q\n', 'w\n')}</think>\n${blk('good.ts', 'a\n', 'b\n')}`;
    const out = parseEditBlocks(text);
    expect(out.blocks.map(b => b.path)).toEqual(['good.ts']);
  });

  it('accepts blocks wrapped in a fence with the path inside', () => {
    const text = '```ts\n' + blk('a.ts', 'x\n', 'y\n') + '```\n';
    const out = parseEditBlocks(text);
    expect(out.errors).toEqual([]);
    expect(out.blocks).toHaveLength(1);
    expect(out.blocks[0].path).toBe('a.ts');
  });

  it('accepts a fence line between the path and the marker', () => {
    const text = 'a.ts\n```ts\n<<<<<<< SEARCH\nx\n=======\ny\n>>>>>>> REPLACE\n```\n';
    const out = parseEditBlocks(text);
    expect(out.errors).toEqual([]);
    expect(out.blocks[0]).toMatchObject({ path: 'a.ts', search: 'x\n', replace: 'y\n' });
  });

  it('cleans decorated paths', () => {
    const out = parseEditBlocks(blk('**`src/a.ts`**:', 'x\n', 'y\n'));
    expect(out.blocks[0].path).toBe('src/a.ts');
  });

  it('reports a missing divider', () => {
    const out = parseEditBlocks('a.ts\n<<<<<<< SEARCH\nx\n>>>>>>> REPLACE\n');
    expect(out.blocks).toEqual([]);
    expect(out.errors.length).toBe(1);
    expect(out.errors[0]).toMatch(/a\.ts/);
    expect(out.errors[0]).toMatch(/=======/);
  });

  it('reports a missing end marker', () => {
    const out = parseEditBlocks('a.ts\n<<<<<<< SEARCH\nx\n=======\ny\n');
    expect(out.blocks).toEqual([]);
    expect(out.errors[0]).toMatch(/REPLACE/);
  });

  it('reports a missing path', () => {
    const out = parseEditBlocks('<<<<<<< SEARCH\nx\n=======\ny\n>>>>>>> REPLACE\n');
    expect(out.blocks).toEqual([]);
    expect(out.errors[0]).toMatch(/path/i);
  });

  it('keeps a good block after a broken one', () => {
    const text = 'a.ts\n<<<<<<< SEARCH\nx\n' + blk('b.ts', 'p\n', 'q\n');
    const out = parseEditBlocks(text);
    expect(out.blocks.map(b => b.path)).toContain('b.ts');
    expect(out.errors.length).toBeGreaterThan(0);
  });

  it('parses a whole-file fenced block', () => {
    const out = parseEditBlocks('Here:\nsrc/new.ts\n```ts\nexport const a = 1;\n```\n');
    expect(out.errors).toEqual([]);
    expect(out.blocks).toEqual([
      { path: 'src/new.ts', search: '', replace: 'export const a = 1;\n', whole_file: true },
    ]);
  });

  it('ignores a fenced block without a path line', () => {
    const out = parseEditBlocks('Use this snippet and then do things\n```ts\nconst x = 1;\n```\n');
    expect(out.blocks).toEqual([]);
  });

  it('reports an unclosed whole-file fence', () => {
    const out = parseEditBlocks('a.ts\n```ts\nconst x = 1;\n');
    expect(out.blocks).toEqual([]);
    expect(out.errors[0]).toMatch(/a\.ts/);
  });

  it('returns nothing for text with no blocks', () => {
    expect(parseEditBlocks('I could not do it.')).toEqual({ blocks: [], errors: [] });
  });
});
