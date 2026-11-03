import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { glob } from 'glob';
import { BM25Searcher } from '../../cost-monitor/bm25.js';
import type { ResearchSourceKind } from '../types.js';
import type { ResearchQuery } from './queries.js';
import { searchSearxng, SourceTimeoutError, type FetchLike } from './searxng.js';
import { PYTHON_DOCS_SCRIPT } from './python-docs.js';

export type ResearchLanguage = 'python' | 'go' | 'typescript' | 'rust' | 'c' | 'shell' | 'unknown';

/** Language guess from the error text; drives which doc tool runs (#155 criterion 8). */
export function detectLanguage(errorText: string): ResearchLanguage {
  if (/Traceback \(most recent call last\)|ModuleNotFoundError|ImportError|SyntaxError|IndentationError|\.py, line /i.test(errorText)) {
    return 'python';
  }
  if (/cannot find package|\.go:\d+|^go: |\bundefined: \w/m.test(errorText)) {
    return 'go';
  }
  if (/error TS\d+|\w+\.(?:ts|tsx)\(\d+,\s*\d+\)/.test(errorText)) {
    return 'typescript';
  }
  // #163: rust, C and shell. A bare linker error stays 'unknown'.
  if (/error\[E\d{4}\]|\.rs:\d+:\d+|error: could not compile/.test(errorText)) {
    return 'rust';
  }
  if (/\.(?:c|h|cc|cpp|hpp):\d+:\d+: (?:fatal )?(?:error|warning)\b/.test(errorText)) {
    return 'c';
  }
  if (/\bSC\d{4}\b|\.sh: line \d+|\.sh:\d+|\bIn \S+\.sh line \d+/.test(errorText)) {
    return 'shell';
  }
  return 'unknown';
}

/** Raised when a doc tool is not on PATH (#155 criterion 9). */
export class ToolMissingError extends Error {
  constructor(tool: string) { super(`tool not found: ${tool}`); }
}

const TOOL_ENV_KEEPS = ['PATH', 'HOME', 'LANG', 'LC_ALL'];
// #155 criterion 13: spawned tools run with proxy variables unset.
const TOOL_ENV_UNSET = ['HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY', 'NO_PROXY', 'http_proxy', 'https_proxy', 'all_proxy', 'no_proxy'];

function toolEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = Object.create(null);
  for (const name of TOOL_ENV_KEEPS) {
    if (process.env[name] !== undefined) env[name] = process.env[name];
  }
  // An own undefined property suppresses Node's forwarding of the variable.
  for (const name of TOOL_ENV_UNSET) env[name] = undefined;
  // Ignore user Go configuration and forbid all automatic downloads.
  Object.assign(env, { GOENV: 'off', GOTOOLCHAIN: 'local', GOPROXY: 'off',
    GOFLAGS: '-mod=readonly', GONOSUMDB: '*', GOSUMDB: 'off' });
  return env;
}

export interface ToolRunOptions {
  cwd?: string;
  timeoutMs: number;
  maxChars?: number;
}

export interface ToolRunResult {
  ok: boolean;
  timedOut: boolean;
  output: string;
}

/** Spawn a doc tool in its own process group and kill the group on timeout. */
export async function runTool(argv: string[], options: ToolRunOptions): Promise<ToolRunResult> {
  const maxChars = options.maxChars ?? 6000;
  const child = spawn(argv[0], argv.slice(1), {
    cwd: options.cwd, shell: false, detached: true, stdio: ['ignore', 'pipe', 'pipe'], env: toolEnv(),
  });
  let text = '';
  let failure: Error | undefined;
  let timedOut = false;
  const append = (chunk: Buffer): void => { if (text.length < maxChars) text += chunk.toString('utf8'); };
  child.stdout.on('data', append);
  child.stderr.on('data', append);
  child.on('error', error => {
    failure = (error as NodeJS.ErrnoException).code === 'ENOENT'
      ? new ToolMissingError(argv[0])
      : error instanceof Error ? error : new Error(String(error));
  });
  const closed = new Promise<number | null>(resolve => child.once('close', resolve));
  const timer = setTimeout(() => {
    timedOut = true;
    const pid = child.pid;
    if (pid !== undefined) {
      try { process.kill(-pid, 'SIGTERM'); } catch { /* group already gone */ }
      setTimeout(() => {
        try { process.kill(-pid, 'SIGKILL'); } catch { /* group already gone */ }
      }, 1000).unref();
    }
  }, options.timeoutMs);
  let code: number | null = null;
  try {
    code = await closed;
  } finally {
    clearTimeout(timer);
  }
  if (failure) throw failure;
  return { ok: code === 0, timedOut, output: text.trim() };
}

const clip = (text: string, chars: number): string => text.slice(0, chars);

const DEPS_MAX_FILES = 150;
const DEPS_MAX_FILE_CHARS = 1500;

function snippetAround(content: string, query: string, chars = 300): string {
  const terms = query.toLowerCase().match(/[a-z0-9_]{3,}/g) ?? [];
  let at = -1;
  for (const term of terms) {
    const found = content.toLowerCase().indexOf(term);
    if (found >= 0 && (at < 0 || found < at)) at = found;
  }
  if (at < 0) return clip(content, chars);
  return clip(content.slice(Math.max(0, at - 60)), chars);
}

/**
 * Installed dependency docs and types (#155 ruling 1): node_modules .d.ts
 * files and READMEs, searched with the local BM25 engine.
 */
export async function searchDependencyDocs(workspacePath: string, query: string, topK = 2): Promise<{ path: string; snippet: string }[]> {
  const root = path.join(workspacePath, 'node_modules');
  if (!existsSync(root)) return [];
  const files = (await glob(['node_modules/**/*.d.ts', 'node_modules/*/README.md', 'node_modules/@*/*/README.md'], {
    cwd: workspacePath, nodir: true,
    ignore: ['**/node_modules/**/node_modules/**', '**/.bin/**'],
  })).slice(0, DEPS_MAX_FILES);
  if (files.length === 0) return [];
  const contents: string[] = [];
  for (const file of files) {
    try {
      contents.push(clip(await readFile(path.join(workspacePath, file), 'utf8'), DEPS_MAX_FILE_CHARS));
    } catch {
      contents.push('');
    }
  }
  const searcher = new BM25Searcher();
  await searcher.indexDocuments(contents);
  const hits = await searcher.search(query, topK);
  return hits.map(hit => ({ path: files[hit.index], snippet: snippetAround(contents[hit.index] ?? '', query) }));
}

/** What one source adapter returns: bounded text, a skip note, or a timeout. */
export interface SourceText {
  text: string;
  timedOut?: boolean;
  /** Machine-readable skip reason, e.g. 'no node_modules'. */
  skipped?: string;
  /** URL already built after redaction; runResearch keeps it unredacted (#163). */
  attribution?: string;
}

export interface ResearchSourceContext {
  workspacePath: string;
  repoSearch: (query: string, topK: number) => Promise<{ path: string; content: string }[]>;
  timeoutMs: number;
  /** Explicit external Python installation directories; never executed or added via site. */
  pythonSearchPaths?: string[];
  searxng?: { url: string; results: number; fetchImpl?: FetchLike };
  /** Failing check output; the explain adapter reads error codes from it (#163). */
  errorText?: string;
  /** Job id; Stack Exchange throttle state lasts for one job (#163). */
  jobId?: string;
  /** Present only when PATCH_RESEARCH_STACKEXCHANGE is on (#163). */
  stackexchange?: { key?: string; fetchImpl?: FetchLike; now?: () => number };
}

/** One adapter interface per source (#155 criterion 7). */
export interface ResearchSourceAdapter {
  readonly source: ResearchSourceKind;
  run(query: ResearchQuery, ctx: ResearchSourceContext): Promise<SourceText>;
}

/** (a) BM25 over the repo itself, through the worker's snapshot search seam. */
export const repoAdapter: ResearchSourceAdapter = {
  source: 'repo',
  async run(query, ctx) {
    const hits = await ctx.repoSearch(query.text, 3);
    const text = hits.slice(0, 2)
      .map(hit => `${hit.path}: ${clip(hit.content.split('\n').slice(0, 6).join('\n'), 500)}`)
      .join('\n');
    return { text };
  },
};

/** (b) Installed dependency docs and types (.d.ts, README). */
export const depsAdapter: ResearchSourceAdapter = {
  source: 'deps',
  async run(query, ctx) {
    if (!existsSync(path.join(ctx.workspacePath, 'node_modules'))) return { text: '', skipped: 'no node_modules' };
    const hits = await searchDependencyDocs(ctx.workspacePath, query.text, 2);
    return { text: hits.map(hit => `${hit.path}: ${hit.snippet}`).join('\n') };
  },
};

const docAdapter = (source: ResearchSourceKind, argv: (target: string) => string[]): ResearchSourceAdapter => ({
  source,
  async run(query, ctx) {
    const result = await runTool(argv(query.text), { cwd: ctx.workspacePath, timeoutMs: ctx.timeoutMs });
    if (result.timedOut) return { text: '', timedOut: true };
    return { text: result.ok && result.output ? clip(result.output, 1500) : '' };
  },
});

/** (c) Python source docstrings/signatures, without importing researched modules. */
export const pydocAdapter: ResearchSourceAdapter = {
  source: 'pydoc',
  async run(query, ctx) {
    if (!/^[A-Za-z_]\w*(?:\.[A-Za-z_]\w*)*$/.test(query.text)) {
      return { text: '', skipped: 'invalid_module' };
    }
    const neutral = await mkdtemp(path.join(tmpdir(), 'patch-pydoc-'));
    try {
      const result = await runTool(['python3', '-I', '-S', '-c', PYTHON_DOCS_SCRIPT, query.text,
        ...(ctx.pythonSearchPaths ?? []).map(directory => path.resolve(directory))], {
        cwd: neutral, timeoutMs: ctx.timeoutMs,
      });
      if (result.timedOut) return { text: '', timedOut: true };
      if (!result.ok) return { text: '', skipped: 'python_reader_failed' };
      return JSON.parse(result.output) as SourceText;
    } finally {
      await rm(neutral, { recursive: true, force: true });
    }
  },
};

/** (c) Go package docs via `go doc`. */
export const goDocAdapter: ResearchSourceAdapter = docAdapter('go doc', target => ['go', 'doc', target]);

/** (c) Manual pages via man. */
export const manAdapter: ResearchSourceAdapter = docAdapter('man', target => ['man', target]);

const SAFE_NAME = /^[A-Za-z_][A-Za-z0-9_]{0,63}$/;

/** (c) C library functions via `man 3 <name>` (#163). */
export const cManAdapter: ResearchSourceAdapter = {
  source: 'man',
  async run(query, ctx) {
    if (!SAFE_NAME.test(query.text)) return { text: '', skipped: 'invalid_name' };
    const result = await runTool(['man', '3', query.text], { cwd: ctx.workspacePath, timeoutMs: ctx.timeoutMs });
    if (result.timedOut) return { text: '', timedOut: true };
    return { text: result.ok && result.output ? clip(result.output, 1500) : '' };
  },
};

/** (c) Shell builtins via bash `help <name>`; the name is validated and passed as an argument (#163). */
export const shellHelpAdapter: ResearchSourceAdapter = {
  source: 'man',
  async run(query, ctx) {
    if (!SAFE_NAME.test(query.text)) return { text: '', skipped: 'invalid_name' };
    const result = await runTool(['bash', '-c', 'help -- "$1"', 'bash', query.text], { cwd: ctx.workspacePath, timeoutMs: ctx.timeoutMs });
    if (result.timedOut) return { text: '', timedOut: true };
    return { text: result.ok && result.output ? clip(result.output, 1500) : '' };
  },
};

/** The user-configured SearXNG instance; snippets only (#155 criteria 5, 6). */
export const searxngAdapter: ResearchSourceAdapter = {
  source: 'searxng',
  async run(query, ctx) {
    const searxng = ctx.searxng;
    if (!searxng) return { text: '', skipped: 'searxng_unreachable' };
    try {
      const results = await searchSearxng(searxng.url, query.text, ctx.timeoutMs, searxng.results, searxng.fetchImpl);
      return { text: results.map(result => `- ${result.title}: ${result.content} (${result.url})`).join('\n') };
    } catch (error) {
      if (error instanceof SourceTimeoutError) return { text: '', timedOut: true };
      throw error;
    }
  },
};
