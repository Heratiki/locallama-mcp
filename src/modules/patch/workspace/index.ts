import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { lstat, mkdir, mkdtemp, realpath, rm, stat, symlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { Workspace, WorkspaceBackend } from '../types.js';

const exec = promisify(execFile);
const BASE_REFS = 'refs/locallama/base/';

/** Pass the corresponding fields of config; relative SCRATCH_DIR is root-relative. */
export interface GitWorkspaceOptions {
  rootDir: string;
  scratchDir?: string;
}

function jobName(jobId: string): void {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/.test(jobId)) {
    throw new Error('Invalid workspace job id');
  }
}

function linkPath(value: string): string {
  if (typeof value !== 'string' || !value || value.includes('\0') || value.includes('\\') ||
      path.posix.isAbsolute(value) || /^[a-zA-Z]:/.test(value) ||
      value.split('/').some(part => part === '..' || part === '.' || part === '.git' || part === '')) {
    throw new Error('Dependency link must be a safe repository-relative path');
  }
  return value;
}

async function exists(file: string): Promise<boolean> {
  try { await lstat(file); return true; }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw error;
  }
}

function within(parent: string, child: string): boolean {
  const relative = path.relative(parent, child);
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}

/** Resolve symlinks even when the last components have not been created yet. */
async function canonicalPath(file: string): Promise<string> {
  try {
    return await realpath(file);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    const parent = path.dirname(file);
    if (parent === file) throw error;
    return path.join(await canonicalPath(parent), path.basename(file));
  }
}

/** A backend is bound to one repo, including after restart; workers use WorkspaceBackend. */
export class GitWorkspaceBackend implements WorkspaceBackend {
  private readonly repoPath: string;
  private readonly scratchDir: string;

  constructor(repoPath: string, options: GitWorkspaceOptions) {
    this.repoPath = path.resolve(repoPath);
    this.scratchDir = path.resolve(options.rootDir, options.scratchDir ?? 'scratch');
  }

  private async git(cwd: string, args: string[], extraEnv: NodeJS.ProcessEnv = {}): Promise<string> {
    // A host's GIT_INDEX_FILE/GIT_DIR must never redirect operations into its checkout.
    const env = Object.fromEntries(Object.entries(process.env).filter(([name]) => !name.startsWith('GIT_')));
    const result = await exec('git', ['-c', 'core.fsmonitor=false', '-c', `core.hooksPath=${path.join(this.scratchDir, '.no-hooks')}`, ...args], {
      cwd, env: { ...env, GIT_TERMINAL_PROMPT: '0', ...extraEnv },
      encoding: 'utf8', maxBuffer: 64 * 1024 * 1024,
    });
    return result.stdout;
  }

  private async prepare(): Promise<{ repo: string; scratch: string }> {
    const repo = await realpath(this.repoPath);
    const top = await realpath((await this.git(repo, ['rev-parse', '--show-toplevel'])).trim());
    if (top !== repo) throw new Error('Workspace repository must be its git root');
    const scratch = await canonicalPath(this.scratchDir);
    if (within(repo, scratch)) throw new Error('Scratch workspace must be outside the target repository');
    await mkdir(scratch, { recursive: true });
    // A regular file cannot contain executable hooks. Keep this marker in scratch,
    // so worktree add/reset cannot run hooks that mutate the source checkout.
    const hooksMarker = path.join(scratch, '.no-hooks');
    try { await writeFile(hooksMarker, '', { flag: 'wx' }); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; }
    if (!(await lstat(hooksMarker)).isFile()) throw new Error('Invalid disabled-hooks marker');
    return { repo, scratch };
  }

  async snapshot(repoPath: string, hints: string[], jobId: string): Promise<string> {
    jobName(jobId);
    const { repo, scratch } = await this.prepare();
    if (await realpath(repoPath) !== repo) throw new Error('Snapshot repository does not match the backend');
    const temporary = await mkdtemp(path.join(scratch, '.index-'));
    const env = { GIT_INDEX_FILE: path.join(temporary, 'index') };
    try {
      const head = (await this.git(repo, ['rev-parse', '--verify', 'HEAD'])).trim();
      await this.git(repo, ['read-tree', head], env);
      await this.git(repo, ['add', '-u', '--', '.'], env);
      // HEAD does not include newly staged paths. Include their current bytes too,
      // without copying or refreshing the user's index (or sweeping in untracked files).
      const additions = await this.git(repo, ['diff', '--cached', '--no-renames', '--name-only', '--diff-filter=A', '-z', head, '--']);
      for (const name of additions.split('\0').filter(Boolean)) {
        if (await exists(path.join(repo, name))) {
          await this.git(repo, ['--literal-pathspecs', 'add', '-f', '--', name], env);
        }
      }
      for (const hint of hints) {
        if (!hint || path.isAbsolute(hint) || !within(repo, path.resolve(repo, hint)) || hint.split(/[\\/]/).includes('.git')) {
          throw new Error('Snapshot hint must be a repository-relative file path');
        }
        await this.git(repo, ['--literal-pathspecs', 'add', '--', hint], env);
      }
      const tree = (await this.git(repo, ['write-tree'], env)).trim();
      // Snapshot commits work even if the user's identity has not been configured.
      const base = (await this.git(repo, ['commit-tree', tree, '-p', head, '-m', `LocalLama snapshot ${jobId}`], {
        ...env,
        GIT_AUTHOR_NAME: 'LocalLama', GIT_AUTHOR_EMAIL: 'locallama@localhost',
        GIT_COMMITTER_NAME: 'LocalLama', GIT_COMMITTER_EMAIL: 'locallama@localhost',
      })).trim();
      // Do not overwrite a live job's snapshot.
      await this.git(repo, ['update-ref', `${BASE_REFS}${jobId}`, base, '']);
      return base;
    } finally {
      await rm(temporary, { recursive: true, force: true });
    }
  }

  async create(base: string, jobId: string): Promise<Workspace> {
    jobName(jobId);
    const { repo, scratch } = await this.prepare();
    const savedBase = (await this.git(repo, ['rev-parse', '--verify', `${BASE_REFS}${jobId}^{commit}`])).trim();
    if (savedBase !== base) throw new Error('Base does not match the job snapshot');
    const worktree = path.join(scratch, jobId);
    const listing = await this.git(repo, ['worktree', 'list', '--porcelain', '-z']);
    let registered = listing.split('\0').includes(`worktree ${worktree}`);
    if (registered && !await exists(worktree)) {
      await this.git(repo, ['worktree', 'remove', '--force', worktree]);
      registered = false;
    }
    if (!registered) await this.git(repo, ['worktree', 'add', '--detach', worktree, base]);
    const ws: Workspace = { path: worktree, repoPath: repo, base, jobId, links: [] };
    try {
      ws.links = await this.readLinks(ws);
      if (registered) await this.reset(ws);
      else await this.makeLinks(ws);
      return ws;
    } catch (error) {
      // Retain B for retry/recovery, but never leave a half-created worktree.
      if (!registered) {
        await this.git(repo, ['worktree', 'remove', '--force', worktree]);
        await this.git(repo, ['worktree', 'prune']);
      }
      throw error;
    }
  }

  private async readLinks(ws: Workspace): Promise<string[]> {
    let links: unknown;
    const configPath = '.locallama/checks.json';
    const entry = await this.git(ws.repoPath, ['ls-tree', ws.base, '--', configPath]);
    if (entry) {
      const config = JSON.parse(await this.git(ws.repoPath, ['show', `${ws.base}:${configPath}`]));
      links = config.links;
    }
    if (links === undefined) {
      const defaults = [];
      for (const name of ['node_modules', '.venv']) {
        if (await exists(path.join(ws.repoPath, name))) defaults.push(name);
      }
      return defaults;
    }
    if (!Array.isArray(links)) throw new Error('checks.json links must be an array');
    const result = [...new Set(links.map(linkPath))];
    for (const name of result) {
      if (result.some(other => other !== name && name.startsWith(`${other}/`))) {
        throw new Error('Dependency links must not overlap');
      }
    }
    return result;
  }

  private async makeLinks(ws: Workspace): Promise<void> {
    for (const name of ws.links) {
      linkPath(name);
      // Parents must be directories in the worktree, never symlink escapes.
      let parent = ws.path;
      for (const part of name.split('/').slice(0, -1)) {
        parent = path.join(parent, part);
        try { await mkdir(parent); }
        catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; }
        const info = await lstat(parent);
        if (!info.isDirectory() || info.isSymbolicLink()) throw new Error('Dependency link parent is not a workspace directory');
      }
      const source = path.join(ws.repoPath, name);
      const destination = path.join(ws.path, name);
      await rm(destination, { recursive: true, force: true });
      let directory = true;
      try { directory = (await stat(source)).isDirectory(); }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
      await symlink(source, destination, directory ? (process.platform === 'win32' ? 'junction' : 'dir') : 'file');
    }
  }

  private async validateWorkspace(ws: Workspace, allowMissing = false): Promise<void> {
    jobName(ws.jobId);
    const { repo, scratch } = await this.prepare();
    const expected = path.join(scratch, ws.jobId);
    if (path.resolve(ws.path) !== expected || await realpath(ws.repoPath) !== repo) {
      throw new Error('Invalid workspace handle');
    }
    if (!allowMissing || await exists(ws.path)) {
      if (await realpath(ws.path) !== expected) throw new Error('Invalid workspace path');
      const commonDir = (await this.git(ws.path, ['rev-parse', '--git-common-dir'])).trim();
      const repoCommon = (await this.git(repo, ['rev-parse', '--git-common-dir'])).trim();
      if (await realpath(path.resolve(ws.path, commonDir)) !== await realpath(path.resolve(repo, repoCommon))) {
        throw new Error('Invalid workspace repository');
      }
    }
    const base = (await this.git(repo, ['rev-parse', '--verify', `${BASE_REFS}${ws.jobId}^{commit}`])).trim();
    if (base !== ws.base) throw new Error('Invalid workspace base');
    ws.links.forEach(linkPath);
  }

  async reset(ws: Workspace): Promise<void> {
    await this.validateWorkspace(ws);
    await this.git(ws.path, ['reset', '--hard', ws.base]);
    await this.git(ws.path, ['clean', '-fd', ...ws.links.flatMap(name => ['-e', `/${name.replace(/[\\*?[\] ]/g, '\\$&')}`])]);
    await this.makeLinks(ws);
  }

  async diff(ws: Workspace): Promise<string> {
    await this.validateWorkspace(ws);
    await this.git(ws.path, ['add', '-A', '--', '.', ...ws.links.map(name => `:(top,exclude,literal)${name}`)]);
    return this.git(ws.path, [
      'diff', '--cached', '--binary', '--no-ext-diff', '--no-textconv', '--no-color',
      '--no-relative', '--src-prefix=a/', '--dst-prefix=b/', ws.base, '--', '.',
      ...ws.links.map(name => `:(top,exclude,literal)${name}`),
    ]);
  }

  /** Call before dispatch, with the non-terminal patch Jobs for this repository. */
  async cleanupOrphans(ownedJobIds: ReadonlySet<string>): Promise<void> {
    const { repo, scratch } = await this.prepare();
    const listing = await this.git(repo, ['worktree', 'list', '--porcelain', '-z']);
    for (const field of listing.split('\0')) {
      if (!field.startsWith('worktree ')) continue;
      const worktree = field.slice('worktree '.length);
      const jobId = path.basename(worktree);
      // Only direct children in our scratch namespace belong to this backend.
      if (path.dirname(worktree) !== scratch || ownedJobIds.has(jobId)) continue;
      try { jobName(jobId); } catch { continue; }
      await this.git(repo, ['worktree', 'remove', '--force', worktree]);
    }
    await this.git(repo, ['worktree', 'prune']);
    const refs = await this.git(repo, ['for-each-ref', '--format=%(refname)', BASE_REFS]);
    for (const ref of refs.trim().split('\n').filter(Boolean)) {
      const jobId = ref.slice(BASE_REFS.length);
      if (!ownedJobIds.has(jobId)) await this.git(repo, ['update-ref', '-d', ref]);
    }
  }

  async dispose(ws: Workspace): Promise<void> {
    await this.validateWorkspace(ws, true);
    await this.git(ws.repoPath, ['worktree', 'remove', '--force', ws.path]);
    await this.git(ws.repoPath, ['worktree', 'prune']);
    await this.git(ws.repoPath, ['update-ref', '-d', `${BASE_REFS}${ws.jobId}`]);
  }
}
