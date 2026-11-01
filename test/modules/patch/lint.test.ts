import { afterEach, beforeEach, describe, expect, it } from '@jest/globals';
import { chmod, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { planLint } from '../../../dist/modules/patch/checks/lint/index.js';
import { loadChecksConfig, resolveChecks, runChecks } from '../../../dist/modules/patch/checks/index.js';

describe('auto lint planning with fake tools', () => {
  let root: string;
  let bin: string;
  let worktree: string;
  let home: string;

  async function fake(name: string, dir = bin) {
    await mkdir(dir, { recursive: true });
    const file = path.join(dir, name);
    await writeFile(file, '#!/bin/sh\nexit 0\n');
    await chmod(file, 0o755);
    return file;
  }
  const plan = (files: string[], lint: 'auto' | { auto: true; exclude?: string[] } = 'auto') =>
    planLint({ worktree, files, lint, pathEnv: bin, home });
  const names = (specs: { name: string }[]) => specs.map(s => s.name);

  beforeEach(async () => {
    root = await mkdtemp(path.join(tmpdir(), 'patch-lint-'));
    bin = path.join(root, 'bin');
    worktree = path.join(root, 'wt');
    home = path.join(root, 'home');
    await mkdir(bin);
    await mkdir(worktree);
    await mkdir(home);
    await writeFile(path.join(worktree, 'a.go'), 'package a\n');
    await writeFile(path.join(worktree, 'run.sh'), 'echo\n');
  });
  afterEach(async () => { await rm(root, { recursive: true, force: true }); });

  it('detects fake tools on PATH and builds the right argv', async () => {
    const gofmt = await fake('gofmt');
    const go = await fake('go');
    const { specs } = await plan(['a.go']);
    expect(specs.find(s => s.name === 'lint:gofmt')).toMatchObject({ argv: [gofmt, '-l', 'a.go'], fail_on_stdout: true });
    expect(specs.find(s => s.name === 'lint:go-vet')).toMatchObject({ argv: [go, 'vet', './...'] });
  });

  it('finds tools in ~/go/bin and the repo node_modules/.bin', async () => {
    const staticcheck = await fake('staticcheck', path.join(home, 'go', 'bin'));
    const { specs } = await plan(['a.go']);
    expect(specs.find(s => s.name === 'lint:staticcheck')!.argv[0]).toBe(staticcheck);
    await writeFile(path.join(worktree, 'a.js'), '');
    const oxlint = await fake('oxlint', path.join(worktree, 'node_modules', '.bin'));
    const js = await plan(['a.js']);
    expect(js.specs.find(s => s.name === 'lint:oxlint')).toMatchObject({ argv: [oxlint, 'a.js'] });
  });

  it('skips a missing tool and notes the reason', async () => {
    await fake('gofmt');
    const { specs, skipped } = await plan(['a.go']);
    expect(names(specs)).toEqual(['lint:gofmt']);
    expect(skipped.map(s => s.tool)).toEqual(expect.arrayContaining(['go', 'staticcheck']));
    expect(skipped.every(s => s.reason.length > 0)).toBe(true);
  });

  it('lints only the languages of the changed files', async () => {
    await fake('gofmt');
    await fake('go');
    await fake('shellcheck');
    const { specs, skipped } = await plan(['run.sh']);
    expect(specs).toHaveLength(1);
    expect(specs[0]).toMatchObject({ name: 'lint:shellcheck', argv: [expect.stringContaining('shellcheck'), '--severity=style', 'run.sh'] });
    expect(skipped).toEqual([]);
  });

  it('runs package-scope tools whole-package and honours the exclude list', async () => {
    await fake('gofmt');
    await fake('go');
    const { specs, skipped } = await plan(['a.go'], { auto: true, exclude: ['gofmt'] });
    expect(names(specs)).toEqual(['lint:go-vet']);
    expect(skipped).toEqual(expect.arrayContaining([{ tool: 'gofmt', reason: expect.stringContaining('exclude') }]));
  });

  it('does not lint files that no longer exist', async () => {
    await fake('shellcheck');
    const { specs } = await plan(['run.sh', 'gone.sh']);
    expect(specs[0].argv.slice(-1)).toEqual(['run.sh']);
  });
});

describe('stdout-means-fail wrapper', () => {
  let worktree: string;
  beforeEach(async () => { worktree = await mkdtemp(path.join(tmpdir(), 'patch-lint-run-')); });
  afterEach(async () => { await rm(worktree, { recursive: true, force: true }); });
  const spec = (code: string) => ({ name: 'fmt', argv: [process.execPath, '-e', code], fail_on_stdout: true });

  it('fails on non-empty stdout with exit 0', async () => {
    const [result] = await runChecks([spec("console.log('a.go')")], { worktree });
    expect(result.exit_code).not.toBe(0);
    expect(result.tail).toContain('a.go');
  });

  it('passes on empty stdout', async () => {
    const [result] = await runChecks([spec("console.error('noise')")], { worktree });
    expect(result.exit_code).toBe(0);
  });
});

describe('lint config in checks.json', () => {
  let snapshot: string;
  beforeEach(async () => { snapshot = await mkdtemp(path.join(tmpdir(), 'patch-lint-cfg-')); });
  afterEach(async () => { await rm(snapshot, { recursive: true, force: true }); });
  async function defaults(value: unknown) {
    await mkdir(path.join(snapshot, '.locallama'), { recursive: true });
    await writeFile(path.join(snapshot, '.locallama', 'checks.json'), JSON.stringify(value));
  }
  const unit = { name: 'unit', argv: ['true'] };

  it('absent lint leaves the config and the no_checks refusal unchanged', async () => {
    await defaults({ checks: [unit] });
    const loaded = await loadChecksConfig(snapshot);
    expect(loaded).toEqual({ checks: [unit] });
    expect(loaded).not.toHaveProperty('lint');
    await defaults({ checks: [] });
    await expect(resolveChecks(snapshot)).resolves.toEqual({ ok: false, reason: 'no_checks' });
  });

  it('lint alone never satisfies the no_checks refusal', async () => {
    await defaults({ checks: [], lint: 'auto' });
    await expect(resolveChecks(snapshot)).resolves.toEqual({ ok: false, reason: 'no_checks' });
  });

  it('loads "auto" and the object form, and rejects anything else', async () => {
    await defaults({ checks: [unit], lint: 'auto' });
    await expect(resolveChecks(snapshot)).resolves.toEqual({ ok: true, config: { checks: [unit], lint: 'auto' } });
    await defaults({ checks: [unit], lint: { auto: true, exclude: ['eslint'] } });
    await expect(loadChecksConfig(snapshot)).resolves.toMatchObject({ lint: { auto: true, exclude: ['eslint'] } });
    for (const bad of ['yes', true, { auto: false }, { auto: true, exclude: 'eslint' }]) {
      await defaults({ checks: [unit], lint: bad });
      await expect(loadChecksConfig(snapshot)).rejects.toThrow(/lint/);
    }
  });
});
