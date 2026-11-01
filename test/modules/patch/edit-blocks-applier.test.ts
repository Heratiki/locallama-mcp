import { afterEach, beforeEach, describe, expect, it } from '@jest/globals';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { applyEditBlocks } from '../../../dist/modules/patch/edit-blocks/applier.js';
import type { EditBlock, Workspace } from '../../../dist/modules/patch/types.js';

let root: string;
let outside: string;
let ws: Workspace;

const write = (rel: string, text: string) => {
  fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
  fs.writeFileSync(path.join(root, rel), text);
};
const read = (rel: string) => fs.readFileSync(path.join(root, rel), 'utf8');
const b = (p: string, search: string, replace: string, whole_file?: boolean): EditBlock =>
  whole_file ? { path: p, search, replace, whole_file } : { path: p, search, replace };

beforeEach(() => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'eb-'));
  root = path.join(base, 'ws');
  outside = path.join(base, 'outside');
  fs.mkdirSync(root);
  fs.mkdirSync(outside);
  ws = { path: root, repoPath: root, base: 'x', jobId: 'j', links: ['node_modules'] };
});
afterEach(() => {
  fs.rmSync(path.dirname(root), { recursive: true, force: true });
});

describe('applyEditBlocks: path safety', () => {
  it.each([
    ['../outside/x.ts'],
    ['a/../../outside/x.ts'],
    ['/etc/passwd'],
    ['.git/config'],
    ['sub/.git/hooks/pre-commit'],
    ['node_modules/pkg/index.js'],
    ['node_modules'],
  ])('refuses %s', (p) => {
    const res = applyEditBlocks(ws, [b(p, '', 'x\n')]);
    expect(res.ok).toBe(false);
    expect(res.errors).toHaveLength(1);
    expect(res.errors[0]).toContain(p);
    expect(res.errors[0].length).toBeLessThan(200);
    expect(fs.existsSync(path.join(outside, 'x.ts'))).toBe(false);
  });

  it('refuses a path through a symlink', () => {
    fs.symlinkSync(outside, path.join(root, 'lnk'));
    const res = applyEditBlocks(ws, [b('lnk/x.ts', '', 'x\n')]);
    expect(res.ok).toBe(false);
    expect(res.errors[0]).toMatch(/link/);
    expect(fs.existsSync(path.join(outside, 'x.ts'))).toBe(false);
  });

  it('refuses a file that is itself a symlink', () => {
    fs.writeFileSync(path.join(outside, 'f.ts'), 'a\n');
    fs.symlinkSync(path.join(outside, 'f.ts'), path.join(root, 'f.ts'));
    const res = applyEditBlocks(ws, [b('f.ts', 'a\n', 'b\n')]);
    expect(res.ok).toBe(false);
    expect(fs.readFileSync(path.join(outside, 'f.ts'), 'utf8')).toBe('a\n');
  });
});

describe('applyEditBlocks: matching', () => {
  it('applies an exact match', () => {
    write('a.ts', 'one\ntwo\nthree\n');
    const res = applyEditBlocks(ws, [b('a.ts', 'two\n', 'TWO\n')]);
    expect(res).toEqual({ ok: true, files: ['a.ts'], errors: [] });
    expect(read('a.ts')).toBe('one\nTWO\nthree\n');
  });

  it('applies when only trailing whitespace differs', () => {
    write('a.ts', 'one  \ntwo\t\nthree\n');
    const res = applyEditBlocks(ws, [b('a.ts', 'one\ntwo\n', 'X\n')]);
    expect(res.ok).toBe(true);
    expect(read('a.ts')).toBe('X\nthree\n');
  });

  it('applies when only indent differs', () => {
    write('a.ts', 'function f() {\n  return 1;\n}\n');
    const res = applyEditBlocks(ws, [b('a.ts', '    return 1;\n', '  return 2;\n')]);
    expect(res.ok).toBe(true);
    expect(read('a.ts')).toBe('function f() {\n  return 2;\n}\n');
  });

  it('does not match anything fuzzier', () => {
    write('a.ts', 'const value = 1;\n');
    const res = applyEditBlocks(ws, [b('a.ts', 'const  value  =  1;\n', 'x\n')]);
    expect(res.ok).toBe(false);
    expect(read('a.ts')).toBe('const value = 1;\n');
    const res2 = applyEditBlocks(ws, [b('a.ts', 'const valu = 1;\n', 'x\n')]);
    expect(res2.ok).toBe(false);
  });

  it('reports not found with the 3 nearest lines', () => {
    write('a.ts', 'alpha\nconst total = compute(a, b);\nbeta\nconst totals = compute(a);\ngamma\nconst totally = 3;\ndelta\n');
    const res = applyEditBlocks(ws, [b('a.ts', 'const total = compute(a, c);\n', 'x\n')]);
    expect(res.ok).toBe(false);
    expect(res.errors).toHaveLength(1);
    const e = res.errors[0];
    expect(e).toContain('a.ts');
    expect(e).toContain('SEARCH text not found');
    expect(e).toContain('const total = compute(a, b);');
    expect(e).toContain('const totals = compute(a);');
    expect(e).toContain('const totally = 3;');
    expect(e).not.toContain('alpha');
    expect(e).not.toContain('delta');
  });

  it('reports multiple matches', () => {
    write('a.ts', 'x = 1;\ny\nx = 1;\n');
    const res = applyEditBlocks(ws, [b('a.ts', 'x = 1;\n', 'z\n')]);
    expect(res.ok).toBe(false);
    expect(res.errors[0]).toContain('a.ts');
    expect(res.errors[0]).toContain('matches 2 places');
    expect(res.errors[0]).toContain('x = 1;');
    expect(read('a.ts')).toBe('x = 1;\ny\nx = 1;\n');
  });

  it('reports multiple matches under loose matching', () => {
    write('a.ts', '  x\ny\n    x\n');
    const res = applyEditBlocks(ws, [b('a.ts', 'x\n', 'z\n')]);
    expect(res.ok).toBe(false);
    expect(res.errors[0]).toContain('matches 2 places');
  });

  it('reports a missing file for a non-empty SEARCH', () => {
    const res = applyEditBlocks(ws, [b('nope.ts', 'x\n', 'y\n')]);
    expect(res.ok).toBe(false);
    expect(res.errors[0]).toContain('nope.ts');
  });

  it('applies several blocks to one file in order', () => {
    write('a.ts', 'a\nb\nc\n');
    const res = applyEditBlocks(ws, [b('a.ts', 'a\n', 'A\n'), b('a.ts', 'c\n', 'C\n')]);
    expect(res).toEqual({ ok: true, files: ['a.ts'], errors: [] });
    expect(read('a.ts')).toBe('A\nb\nC\n');
  });

  it('writes nothing when any block fails', () => {
    write('a.ts', 'a\n');
    write('b.ts', 'b\n');
    const res = applyEditBlocks(ws, [b('a.ts', 'a\n', 'A\n'), b('b.ts', 'zzz\n', 'B\n')]);
    expect(res.ok).toBe(false);
    expect(read('a.ts')).toBe('a\n');
  });
});

describe('applyEditBlocks: new and whole files', () => {
  it('creates a file for empty SEARCH on a missing path', () => {
    const res = applyEditBlocks(ws, [b('src/deep/new.ts', '', 'hello\n')]);
    expect(res).toEqual({ ok: true, files: ['src/deep/new.ts'], errors: [] });
    expect(read('src/deep/new.ts')).toBe('hello\n');
  });

  it('refuses empty SEARCH on an existing file', () => {
    write('a.ts', 'a\n');
    const res = applyEditBlocks(ws, [b('a.ts', '', 'x\n')]);
    expect(res.ok).toBe(false);
    expect(read('a.ts')).toBe('a\n');
  });

  it('whole-file creates a new file', () => {
    const res = applyEditBlocks(ws, [b('n.ts', '', 'x\n', true)]);
    expect(res.ok).toBe(true);
    expect(read('n.ts')).toBe('x\n');
  });

  it('whole-file overwrites a file under the line limit', () => {
    write('s.ts', 'a\nb\n');
    const res = applyEditBlocks(ws, [b('s.ts', '', 'new\n', true)]);
    expect(res.ok).toBe(true);
    expect(read('s.ts')).toBe('new\n');
  });

  it('whole-file refuses a file at or over the limit (default 150)', () => {
    write('big.ts', Array.from({ length: 150 }, (_, i) => `l${i}`).join('\n') + '\n');
    const res = applyEditBlocks(ws, [b('big.ts', '', 'new\n', true)]);
    expect(res.ok).toBe(false);
    expect(res.errors[0]).toContain('big.ts');
    expect(res.errors[0]).toContain('150');
  });

  it('honours a configured limit', () => {
    write('m.ts', 'a\nb\nc\n');
    expect(applyEditBlocks(ws, [b('m.ts', '', 'n\n', true)], { wholeFileMaxLines: 3 }).ok).toBe(false);
    expect(applyEditBlocks(ws, [b('m.ts', '', 'n\n', true)], { wholeFileMaxLines: 4 }).ok).toBe(true);
  });
});
