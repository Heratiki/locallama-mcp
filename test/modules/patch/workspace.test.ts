import { afterEach, beforeEach, describe, expect, it } from '@jest/globals';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { chmod, mkdtemp, mkdir, lstat, readFile, readdir, readlink, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { GitWorkspaceBackend } from '../../../src/modules/patch/workspace/index';
import type { WorkspaceBackend } from '../../../src/modules/patch/types.js';

const exec = promisify(execFile);
const git = async (cwd: string, ...args: string[]) => (await exec('git', args, {
  cwd, env: { ...process.env, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: path.join(root, 'empty-gitconfig'), GIT_TERMINAL_PROMPT: '0' },
})).stdout;

let root: string;
let repo: string;
let rootDir: string;
let backend: GitWorkspaceBackend;

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'locallama-workspace-'));
  repo = path.join(root, 'repo');
  rootDir = path.join(root, 'state');
  await mkdir(repo);
  await git(repo, 'init', '-b', 'main');
  await git(repo, 'config', 'user.name', 'Workspace Test');
  await git(repo, 'config', 'user.email', 'workspace@example.invalid');
  await writeFile(path.join(repo, 'tracked.txt'), 'committed\n');
  await writeFile(path.join(repo, 'removed.txt'), 'remove me\n');
  await writeFile(path.join(repo, '.gitignore'), 'node_modules/\n.venv/\n');
  await git(repo, 'add', '.');
  await git(repo, 'commit', '-m', 'fixture');
  backend = new GitWorkspaceBackend(repo, { rootDir });
});

afterEach(async () => { await rm(root, { recursive: true, force: true }); });

async function userState() {
  // Capture bytes, including the index file: status alone misses index mutations.
  const indexPath = (await git(repo, 'rev-parse', '--git-path', 'index')).trim();
  const tree: Record<string, string> = {};
  async function walk(dir: string) {
    for (const entry of await readdir(path.join(repo, dir), { withFileTypes: true })) {
      if (entry.name === '.git') continue;
      const name = path.join(dir, entry.name);
      if (entry.isDirectory()) await walk(name);
      else tree[name] = (await readFile(path.join(repo, name))).toString('base64');
    }
  }
  await walk('');
  return {
    tree,
    index: (await readFile(path.resolve(repo, indexPath))).toString('base64'),
    status: await git(repo, '--no-optional-locks', 'status', '--porcelain=v1', '-uall'),
    stash: await git(repo, 'stash', 'list'),
    branches: await git(repo, 'for-each-ref', '--format=%(refname) %(objectname)', 'refs/heads/'),
    head: await git(repo, 'rev-parse', 'HEAD'),
  };
}

describe('git WorkspaceBackend', () => {
  it('rejects scratch inside the repo, including a symlink alias, without changing user state', async () => {
    const before = await userState();
    const inside = new GitWorkspaceBackend(repo, { rootDir: repo });
    await expect(inside.snapshot(repo, [], 'inside')).rejects.toThrow('outside');
    const alias = path.join(root, 'repo-alias');
    await symlink(repo, alias, process.platform === 'win32' ? 'junction' : 'dir');
    const aliased = new GitWorkspaceBackend(repo, { rootDir, scratchDir: alias });
    await expect(aliased.snapshot(repo, [], 'alias')).rejects.toThrow('outside');
    expect(await userState()).toEqual(before);
    expect(await git(repo, 'for-each-ref', 'refs/locallama/base/')).toBe('');
  });

  it.each(['../escape', '.git', 'vendor/../escape'])('rejects unsafe dependency link %s and removes the partial worktree', async link => {
    await mkdir(path.join(repo, '.locallama'));
    await writeFile(path.join(repo, '.locallama', 'checks.json'), JSON.stringify({ links: [link] }));
    const base = await backend.snapshot(repo, ['.locallama/checks.json'], 'bad-link');
    await expect(backend.create(base, 'bad-link')).rejects.toThrow('relative path');
    await expect(lstat(path.join(rootDir, 'scratch', 'bad-link'))).rejects.toThrow();
    expect(await git(repo, 'worktree', 'list', '--porcelain')).not.toContain('bad-link');
    await backend.cleanupOrphans(new Set());
    expect(await git(repo, 'for-each-ref', 'refs/locallama/base/')).toBe('');
  });

  it('respects an explicit empty links array and a root-relative scratch override', async () => {
    await mkdir(path.join(repo, '.locallama'));
    await writeFile(path.join(repo, '.locallama', 'checks.json'), JSON.stringify({ links: [] }));
    await mkdir(path.join(repo, 'node_modules'));
    const custom = new GitWorkspaceBackend(repo, { rootDir, scratchDir: 'custom-scratch' });
    const base = await custom.snapshot(repo, ['.locallama/checks.json'], 'empty-links');
    const ws = await custom.create(base, 'empty-links');
    expect(ws.path).toBe(path.join(rootDir, 'custom-scratch', 'empty-links'));
    expect(ws.links).toEqual([]);
    await expect(lstat(path.join(ws.path, 'node_modules'))).rejects.toThrow();
    await custom.dispose(ws);
  });

  it('recovers or disposes a worktree whose directory disappeared', async () => {
    const base = await backend.snapshot(repo, [], 'missing-dir');
    const ws = await backend.create(base, 'missing-dir');
    await rm(ws.path, { recursive: true });
    const recovered = await new GitWorkspaceBackend(repo, { rootDir }).create(base, 'missing-dir');
    expect(await readFile(path.join(recovered.path, 'tracked.txt'), 'utf8')).toBe('committed\n');
    await rm(recovered.path, { recursive: true });
    await backend.dispose(recovered);
    expect(await git(repo, 'for-each-ref', 'refs/locallama/base/')).toBe('');
    expect(await git(repo, 'worktree', 'list', '--porcelain')).not.toContain(ws.path);
  });

  it('makes every explicit link even when its source is absent', async () => {
    await mkdir(path.join(repo, '.locallama'));
    await writeFile(path.join(repo, '.locallama', 'checks.json'), JSON.stringify({ links: ['optional-deps'] }));
    const base = await backend.snapshot(repo, ['.locallama/checks.json'], 'explicit-link');
    const ws = await backend.create(base, 'explicit-link');
    expect(await readlink(path.join(ws.path, 'optional-deps'))).toBe(path.join(repo, 'optional-deps'));
    expect(await backend.diff(ws)).toBe('');
    await backend.reset(ws);
    expect(await readlink(path.join(ws.path, 'optional-deps'))).toBe(path.join(repo, 'optional-deps'));
    await backend.dispose(ws);
  });

  it('snapshots staged renames and broken symlinks as tracked working-tree changes', async () => {
    await git(repo, 'mv', 'tracked.txt', 'renamed.txt');
    await symlink('absent-target', path.join(repo, 'broken-link'));
    await git(repo, 'add', 'broken-link');
    const base = await backend.snapshot(repo, [], 'tracked-links');
    expect(await git(repo, 'show', `${base}:renamed.txt`)).toBe('committed\n');
    expect(await git(repo, 'show', `${base}:broken-link`)).toBe('absent-target');
    const ws = await backend.create(base, 'tracked-links');
    await backend.dispose(ws);
  });

  it('produces an applicable patch regardless of user color and diff prefix settings', async () => {
    await git(repo, 'config', 'color.ui', 'always');
    await git(repo, 'config', 'diff.noprefix', 'true');
    const base = await backend.snapshot(repo, [], 'diff-settings');
    const ws = await backend.create(base, 'diff-settings');
    await writeFile(path.join(ws.path, 'tracked.txt'), 'fixed\n');
    const patchPath = path.join(root, 'configured.patch');
    await writeFile(patchPath, await backend.diff(ws));
    await git(repo, 'apply', '--check', patchPath);
    await backend.dispose(ws);
  });

  it('does not execute repository checkout hooks while creating a worktree', async () => {
    const hook = path.join(repo, '.git', 'hooks', 'post-checkout');
    await writeFile(hook, `#!/bin/sh\nprintf 'hook mutation\\n' > '${path.join(repo, 'tracked.txt')}'\n`);
    await chmod(hook, 0o755);
    const before = await userState();
    const base = await backend.snapshot(repo, [], 'no-hooks');
    const ws = await backend.create(base, 'no-hooks');
    expect(await userState()).toEqual(before);
    await backend.dispose(ws);
  });

  it('recovers an owned worktree from B with the snapshot link config rather than later edits', async () => {
    await mkdir(path.join(repo, '.locallama'));
    await writeFile(path.join(repo, '.locallama', 'checks.json'), JSON.stringify({ links: ['vendor/cache[1]'] }));
    await git(repo, 'add', '.locallama/checks.json');
    await mkdir(path.join(repo, 'vendor', 'cache[1]'), { recursive: true });
    await writeFile(path.join(repo, 'vendor', 'cache[1]', 'data'), 'shared dependency');
    await mkdir(path.join(repo, 'node_modules'));
    const base = await backend.snapshot(repo, [], 'recover-links');
    const ws = await backend.create(base, 'recover-links');
    expect(ws.links).toEqual(['vendor/cache[1]']);
    expect(await readlink(path.join(ws.path, 'vendor', 'cache[1]'))).toBe(path.join(repo, 'vendor', 'cache[1]'));
    await expect(lstat(path.join(ws.path, 'node_modules'))).rejects.toThrow();
    expect(await backend.diff(ws)).toBe('');
    await writeFile(path.join(ws.path, 'tracked.txt'), 'in-flight edits\n');
    await writeFile(path.join(ws.path, '.locallama', 'checks.json'), 'invalid attempt config');
    await writeFile(path.join(repo, '.locallama', 'checks.json'), JSON.stringify({ links: ['node_modules'] }));
    await writeFile(path.join(repo, 'tracked.txt'), 'source changed after submit\n');
    const recovered = await new GitWorkspaceBackend(repo, { rootDir }).create(base, 'recover-links');
    expect(recovered.links).toEqual(['vendor/cache[1]']);
    expect(await readFile(path.join(recovered.path, 'tracked.txt'), 'utf8')).toBe('committed\n');
    expect(await readlink(path.join(recovered.path, 'vendor', 'cache[1]'))).toBe(path.join(repo, 'vendor', 'cache[1]'));
    expect(await backend.diff(recovered)).toBe('');
    expect(await readFile(path.join(repo, 'vendor', 'cache[1]', 'data'), 'utf8')).toBe('shared dependency');
    await backend.dispose(recovered);
  });

  it('refuses a workspace handle pointing at the user checkout before any mutation', async () => {
    const base = await backend.snapshot(repo, [], 'guarded');
    const ws = await backend.create(base, 'guarded');
    await writeFile(path.join(repo, 'tracked.txt'), 'user changed after submission\n');
    const before = await userState();
    for (const operation of ['reset', 'diff', 'dispose'] as const) {
      await expect(backend[operation]({ ...ws, path: repo })).rejects.toThrow('workspace');
      expect(await userState()).toEqual(before);
    }
    await backend.dispose(ws);
  });

  it('includes newly tracked files and their working-tree bytes without including other untracked files', async () => {
    await writeFile(path.join(repo, 'staged-new.txt'), 'index bytes\n');
    await git(repo, 'add', 'staged-new.txt');
    await writeFile(path.join(repo, 'staged-new.txt'), 'submitted bytes\n');
    await writeFile(path.join(repo, 'untracked.txt'), 'leave out\n');
    const before = await userState();
    const base = await backend.snapshot(repo, [], 'newly-tracked');
    expect(await git(repo, 'show', `${base}:staged-new.txt`)).toBe('submitted bytes\n');
    expect(await git(repo, 'ls-tree', '--name-only', base)).not.toContain('untracked.txt');
    const ws = await backend.create(base, 'newly-tracked');
    await backend.dispose(ws);
    expect(await userState()).toEqual(before);
  });

  it('cleans orphan worktrees and base refs after restart while retaining owned jobs and unrelated worktrees', async () => {
    const ownedBase = await backend.snapshot(repo, [], 'owned');
    const owned = await backend.create(ownedBase, 'owned');
    const orphanBase = await backend.snapshot(repo, [], 'orphan');
    const orphan = await backend.create(orphanBase, 'orphan');
    await backend.snapshot(repo, [], 'ref-only');
    const unreferencedBase = await backend.snapshot(repo, [], 'no-ref');
    const unreferenced = await backend.create(unreferencedBase, 'no-ref');
    await git(repo, 'update-ref', '-d', 'refs/locallama/base/no-ref');
    const external = path.join(root, 'unrelated');
    await git(repo, 'worktree', 'add', '--detach', external, 'HEAD');
    const restarted = new GitWorkspaceBackend(repo, { rootDir });
    await restarted.cleanupOrphans(new Set(['owned']));
    expect(await readFile(path.join(owned.path, 'tracked.txt'), 'utf8')).toBe('committed\n');
    expect(await readFile(path.join(external, 'tracked.txt'), 'utf8')).toBe('committed\n');
    await expect(lstat(orphan.path)).rejects.toThrow();
    await expect(lstat(unreferenced.path)).rejects.toThrow();
    expect(await git(repo, 'for-each-ref', '--format=%(refname)', 'refs/locallama/base/')).toBe('refs/locallama/base/owned\n');
    expect(await git(repo, 'worktree', 'list', '--porcelain')).not.toContain(orphan.path);
    await restarted.cleanupOrphans(new Set(['owned']));
    // Recovery uses the stored base, even when the repo changed after submission.
    await writeFile(path.join(repo, 'tracked.txt'), 'later repo bytes\n');
    const recoveredBase = await restarted.snapshot(repo, [], 'recover');
    const recovered = await new GitWorkspaceBackend(repo, { rootDir }).create(recoveredBase, 'recover');
    expect(await readFile(path.join(recovered.path, 'tracked.txt'), 'utf8')).toBe('later repo bytes\n');
    await restarted.dispose(recovered);
    await restarted.dispose(owned);
    await git(repo, 'worktree', 'remove', '--force', external);
  });

  it('restores snapshot bytes and dependency links on reset and excludes every link from diffs', async () => {
    await mkdir(path.join(repo, 'node_modules'));
    await writeFile(path.join(repo, 'node_modules', 'dependency.txt'), 'dependency bytes\n');
    await mkdir(path.join(repo, '.venv'));
    const base = await backend.snapshot(repo, [], 'reset-job');
    const ws = await backend.create(base, 'reset-job');
    expect(ws.links).toEqual(['node_modules', '.venv']);
    expect(await readlink(path.join(ws.path, 'node_modules'))).toBe(path.join(repo, 'node_modules'));
    expect((await lstat(path.join(ws.path, '.venv'))).isSymbolicLink()).toBe(true);
    await writeFile(path.join(ws.path, 'tracked.txt'), 'attempt one\n');
    await writeFile(path.join(ws.path, 'new.txt'), 'attempt file\n');
    const diff = await backend.diff(ws);
    expect(diff).toContain('attempt one');
    expect(diff).not.toContain('node_modules');
    expect(diff).not.toContain('.venv');
    // A replacement directory must be removed and the link restored, without touching its source.
    await rm(path.join(ws.path, 'node_modules'));
    await mkdir(path.join(ws.path, 'node_modules'));
    await writeFile(path.join(ws.path, 'node_modules', 'fake.txt'), 'attempt dependency');
    await backend.reset(ws);
    expect(await readFile(path.join(ws.path, 'tracked.txt'), 'utf8')).toBe('committed\n');
    await expect(lstat(path.join(ws.path, 'new.txt'))).rejects.toThrow();
    expect(await readlink(path.join(ws.path, 'node_modules'))).toBe(path.join(repo, 'node_modules'));
    expect(await readFile(path.join(repo, 'node_modules', 'dependency.txt'), 'utf8')).toBe('dependency bytes\n');
    expect(await backend.diff(ws)).toBe('');
    await backend.dispose(ws);
  });

  it('snapshots dirty bytes without changing the user state and returns an applicable binary diff', async () => {
    await writeFile(path.join(repo, 'tracked.txt'), 'stashed\n');
    await git(repo, 'stash', 'push', '-m', 'keep this stash');
    await writeFile(path.join(repo, 'tracked.txt'), 'staged\n');
    await git(repo, 'add', 'tracked.txt');
    await writeFile(path.join(repo, 'tracked.txt'), 'submitted dirty\n');
    await rm(path.join(repo, 'removed.txt'));
    await writeFile(path.join(repo, 'hint.txt'), 'submitted hint\n');
    await writeFile(path.join(repo, 'other.txt'), 'not hinted\n');
    const before = await userState();
    const seam: WorkspaceBackend = backend;
    const base = await seam.snapshot(repo, ['hint.txt'], 'dirty-job');
    expect((await git(repo, 'show', `${base}:tracked.txt`))).toBe('submitted dirty\n');
    expect((await git(repo, 'show', `${base}:hint.txt`))).toBe('submitted hint\n');
    expect(await git(repo, 'ls-tree', '--name-only', base)).not.toContain('other.txt');
    expect(await git(repo, 'ls-tree', '--name-only', base)).not.toContain('removed.txt');
    expect((await git(repo, 'rev-parse', `${base}^`)).trim()).toBe(before.head.trim());
    expect((await git(repo, 'rev-parse', 'refs/locallama/base/dirty-job')).trim()).toBe(base);
    const ws = await seam.create(base, 'dirty-job');
    expect(ws.path).toBe(path.join(rootDir, 'scratch', 'dirty-job'));
    expect(path.relative(repo, ws.path).startsWith('..')).toBe(true);
    expect(await git(ws.path, 'branch', '--show-current')).toBe('');
    await writeFile(path.join(ws.path, 'tracked.txt'), 'fixed\n');
    await writeFile(path.join(ws.path, 'hint.txt'), 'fixed hint\n');
    await writeFile(path.join(ws.path, 'new.txt'), 'new file\n');
    await writeFile(path.join(ws.path, 'image.bin'), Buffer.from([0, 255, 42, 0, 128]));
    const diff = await seam.diff(ws);
    expect(diff).toContain('GIT binary patch');
    expect(diff).toContain('-submitted dirty');
    expect(diff).toContain('-submitted hint');
    expect(diff).toContain('new file mode');
    await seam.dispose(ws);
    expect(await userState()).toEqual(before);
    await expect(readFile(path.join(ws.path, 'tracked.txt'))).rejects.toThrow();
    expect(await git(repo, 'for-each-ref', 'refs/locallama/base/')).toBe('');
    const patchPath = path.join(root, 'result.patch');
    await writeFile(patchPath, diff);
    await git(repo, 'apply', '--check', patchPath);
    await git(repo, 'apply', patchPath);
    expect(await readFile(path.join(repo, 'tracked.txt'), 'utf8')).toBe('fixed\n');
    expect(await readFile(path.join(repo, 'hint.txt'), 'utf8')).toBe('fixed hint\n');
    expect(await readFile(path.join(repo, 'new.txt'), 'utf8')).toBe('new file\n');
    expect(await readFile(path.join(repo, 'image.bin'))).toEqual(Buffer.from([0, 255, 42, 0, 128]));
  });
});
