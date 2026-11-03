import { afterEach, beforeEach, describe, expect, it } from '@jest/globals';
import { mkdtemp, mkdir, writeFile, chmod, rm } from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { explainAdapter, explainCommands } from '../../../../dist/modules/patch/research/explain.js';

let tmp: string;
let binDir: string;
let realPath: string;
let realHome: string | undefined;

async function fakeTool(name: string): Promise<void> {
  await writeFile(path.join(binDir, name), `#!/bin/sh\necho "${name}:$*"\n`, 'utf8');
  await chmod(path.join(binDir, name), 0o755);
}
const run = (errorText: string) => explainAdapter.run(
  { text: 'q', kind: 'code' },
  { workspacePath: tmp, repoSearch: async () => [], timeoutMs: 4000, errorText },
);

beforeEach(async () => {
  tmp = await mkdtemp(path.join(os.tmpdir(), 'research-explain-'));
  binDir = path.join(tmp, 'bin');
  await mkdir(binDir, { recursive: true });
  realPath = process.env.PATH ?? '';
  realHome = process.env.HOME;
  process.env.PATH = `${binDir}${path.delimiter}${realPath}`;
});
afterEach(async () => {
  process.env.PATH = realPath;
  if (realHome === undefined) delete process.env.HOME; else process.env.HOME = realHome;
  await rm(tmp, { recursive: true, force: true });
});

describe('explain adapter (#163)', () => {
  it('maps each error code pattern to its offline argv', () => {
    expect(explainCommands('error[E0308]: mismatched types')).toEqual([{ argv: ['rustc', '--explain', 'E0308'] }]);
    expect(explainCommands('warning: needless return\n  = note: `#[warn(clippy::needless_return)]` on by default'))
      .toEqual([{ argv: ['cargo', 'clippy', '--explain', 'needless_return'] }]);
    expect(explainCommands('app.py:1:8: F401 [*] `os` imported but unused')).toEqual([{ argv: ['ruff', 'rule', 'F401'] }]);
    expect(explainCommands('main.go:5:2: this value of x is never used (SA4006)')).toEqual([{ argv: ['staticcheck', '-explain', 'SA4006'] }]);
    expect(explainCommands('In x.sh line 3:\n^-- SC2206 (warning): Quote to prevent word splitting'))
      .toEqual([{ hint: 'https://www.shellcheck.net/wiki/SC2206' }]);
    expect(explainCommands('plain failure with no codes')).toEqual([]);
  });

  it('runs rustc, cargo clippy, ruff and staticcheck with the matching argv', async () => {
    for (const name of ['rustc', 'cargo', 'ruff', 'staticcheck']) await fakeTool(name);
    expect((await run('error[E0308]: mismatched types')).text).toContain('rustc:--explain E0308');
    expect((await run('#[warn(clippy::needless_return)]')).text).toContain('cargo:clippy --explain needless_return');
    expect((await run('app.py:1:8: F401 [*] unused')).text).toContain('ruff:rule F401');
    expect((await run('main.go:5:2: never used (SA4006)')).text).toContain('staticcheck:-explain SA4006');
  });

  it('gives only the URL hint for shellcheck and runs no tool', async () => {
    const result = await run('^-- SC2206 (warning): Quote to prevent word splitting');
    expect(result.text).toContain('https://www.shellcheck.net/wiki/SC2206');
    expect(result.skipped).toBeUndefined();
  });

  it('gives a skip note when the tool is missing', async () => {
    process.env.PATH = binDir;
    process.env.HOME = tmp;
    const result = await run('error[E0308]: mismatched types');
    expect(result.text).toBe('');
    expect(result.skipped).toBe('tool_missing');
  });

  it('finds a tool in ~/.cargo/bin', async () => {
    process.env.PATH = '/nonexistent-dir-for-test';
    process.env.HOME = tmp;
    await mkdir(path.join(tmp, '.cargo', 'bin'), { recursive: true });
    await writeFile(path.join(tmp, '.cargo', 'bin', 'rustc'), '#!/bin/sh\necho "cargo-home-rustc:$*"\n', 'utf8');
    await chmod(path.join(tmp, '.cargo', 'bin', 'rustc'), 0o755);
    expect((await run('error[E0599]: no method')).text).toContain('cargo-home-rustc:--explain E0599');
  });

  it('skips with a note when no error code is present', async () => {
    expect((await run('nothing here')).skipped).toBe('no_error_code');
  });
});
