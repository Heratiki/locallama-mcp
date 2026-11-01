import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { mkdtemp, mkdir, writeFile, rm, chmod, readFile } from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import http from 'node:http';
import type { AddressInfo } from 'node:net';

// #155 criterion 13: block every network builtin except what the stub server
// needs. The research path must never import or call these.
jest.unstable_mockModule('node:http', () => { throw new Error('node:http must not be imported by patch research'); });
jest.unstable_mockModule('node:https', () => { throw new Error('node:https must not be imported by patch research'); });
jest.unstable_mockModule('node:net', () => { throw new Error('node:net must not be imported by patch research'); });
jest.unstable_mockModule('node:dns', () => { throw new Error('node:dns must not be imported by patch research'); });

const { runResearch, resetSearxngProbeCache } = await import('../../../../dist/modules/patch/research/index.js');
const { detectStuck } = await import('../../../../dist/modules/patch/research/detect.js');
const { countTokens } = await import('../../../../dist/modules/utils/tokenCount.js');

let tmp: string;
let workspace: string;
let binDir: string;
let realPath: string;
let realFetch: typeof fetch;
const hosts: string[] = [];

const PYTHON_ERROR = [
  'Traceback (most recent call last):',
  '  File "app/main.py", line 10, in <module>',
  "ModuleNotFoundError: No module named 'requests'",
].join('\n');

function stuckOf(errorText: string) {
  const stuck = detectStuck([
    { outcome: 'check_failed', applyError: null, checks: [{ name: 'unit', exit_code: 1, timed_out: false, duration_ms: 1, tail: errorText }] },
    { outcome: 'check_failed', applyError: null, checks: [{ name: 'unit', exit_code: 1, timed_out: false, duration_ms: 1, tail: errorText }] },
  ]);
  expect(stuck).not.toBeNull();
  return stuck!;
}

function guardedFetch(allow: (url: URL) => boolean): typeof fetch {
  return (async (input, init) => {
    const url = new URL(typeof input === 'string' ? input : String(input));
    hosts.push(url.host);
    if (!allow(url)) throw new Error(`blocked host: ${url.host}`);
    return realFetch(input as RequestInfo, init as RequestInit);
  }) as typeof fetch;
}

beforeEach(async () => {
  tmp = await mkdtemp(path.join(os.tmpdir(), 'research-run-'));
  workspace = path.join(tmp, 'ws');
  binDir = path.join(tmp, 'bin');
  await mkdir(path.join(workspace, 'src'), { recursive: true });
  await mkdir(binDir, { recursive: true });
  await writeFile(path.join(workspace, 'src', 'helper.ts'), 'export function makeWidget(): number { return 42; }\n');
  realPath = process.env.PATH ?? '';
  process.env.PATH = `${binDir}${path.delimiter}${realPath}`;
  realFetch = globalThis.fetch;
  resetSearxngProbeCache();
  hosts.length = 0;
});
afterEach(async () => {
  process.env.PATH = realPath;
  globalThis.fetch = realFetch;
  await rm(tmp, { recursive: true, force: true });
});

const limits = (over: Record<string, unknown> = {}) => ({
  searxngUrl: '', sourceTimeoutMs: 4000, tokens: 800, notesMax: 500, ...over,
});

async function stubServer(handlers: Record<string, (req: http.IncomingMessage, res: http.ServerResponse) => void>): Promise<{ url: string; close: () => Promise<void>; requests: number }> {
  let requests = 0;
  const server = http.createServer((req, res) => {
    requests++;
    const url = new URL(req.url ?? '/', 'http://127.0.0.1');
    const key = url.searchParams.get('q')?.includes('probe') ? 'probe' : (url.searchParams.get('q') ?? '');
    (handlers[key] ?? handlers.default ?? ((_r: http.IncomingMessage, rs: http.ServerResponse) => { rs.writeHead(200, { 'content-type': 'application/json' }); rs.end('{}'); }))(req, res);
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  return {
    url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
    close: () => new Promise<void>(resolve => server.close(() => resolve())),
    get requests() { return requests; },
  };
}

describe('runResearch (#155 criteria 1, 10, 11, 13)', () => {
  it('is off with no SearXNG URL: no sources, no rows, no prompt block', async () => {
    const outcome = await runResearch({
      jobId: 'job', attemptN: 3, repoPath: '/repos/app', workspacePath: workspace,
      stuck: stuckOf(PYTHON_ERROR), files: ['app/main.py'],
      repoSearch: async () => { throw new Error('must not run'); },
      helpedNotes: [], limits: limits(),
    });
    expect(outcome.enabled).toBe(false);
    expect(outcome.block).toBe('');
    expect(outcome.inserts).toHaveLength(0);
    expect(outcome.record.sources).toHaveLength(0);
  });

  it('zero token budget turns research off', async () => {
    const outcome = await runResearch({
      jobId: 'job', attemptN: 3, repoPath: '/repos/app', workspacePath: workspace,
      stuck: stuckOf(PYTHON_ERROR), files: [], repoSearch: async () => [],
      helpedNotes: [], limits: limits({ searxngUrl: 'http://127.0.0.1:1', tokens: 0 }),
    });
    expect(outcome.enabled).toBe(false);
  });

  it('runs local sources and SearXNG, stores per-source rows, and bounds the block to the token budget', async () => {
    const stub = await stubServer({
      default: (_req, res) => { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ results: [{ title: 'Fix TS2339', url: 'https://example.com/fix', content: 'Import the module first.' }] })); },
    });
    try {
      const outcome = await runResearch({
        jobId: 'job', attemptN: 3, repoPath: '/repos/app', workspacePath: workspace,
        stuck: stuckOf("src/app.ts(3,5): error TS2339: Property 'makeWidget' does not exist on type 'App'."),
        files: ['src/app.ts'],
        repoSearch: async () => [{ path: 'src/helper.ts', content: 'export function makeWidget(): number { return 42; }' }],
        helpedNotes: [], limits: limits({ searxngUrl: stub.url }), fetchImpl: guardedFetch(url => url.host === new URL(stub.url).host),
      });
      expect(outcome.enabled).toBe(true);
      expect(outcome.block).toContain('makeWidget');
      expect(outcome.block).toContain('Fix TS2339');
      expect(countTokens(outcome.block)).toBeLessThanOrEqual(800);
      const kinds = outcome.record.sources.map(s => `${s.source}:${s.status}`).sort();
      expect(kinds).toEqual(expect.arrayContaining(['repo:ran', 'searxng:ran']));
      for (const row of outcome.inserts) {
        expect(row.job_id).toBe('job');
        expect(row.attempt_n).toBe(3);
        expect(row.helped).toBeNull();
        expect(row.info!.length).toBeGreaterThan(0);
      }
      expect(outcome.inserts.map(r => r.source).sort()).toEqual(['repo', 'searxng']);
      // #155 criterion 13: the stub SearXNG host is the only host ever contacted.
      expect(hosts.length).toBeGreaterThanOrEqual(1);
      expect(hosts.every(host => host === new URL(stub.url).host)).toBe(true);
    } finally { await stub.close(); }
  });

  it('a slow source is killed and recorded timed_out while the rest still run (#155 criterion 10)', async () => {
    const pidFile = path.join(tmp, 'slow.pid');
    await writeFile(path.join(binDir, 'pydoc'), `#!/bin/sh\necho $$ > ${JSON.stringify(pidFile)}\nsleep 30\n`, 'utf8');
    await chmod(path.join(binDir, 'pydoc'), 0o755);
    const stub = await stubServer({
      probe: (_req, res) => { res.writeHead(200, { 'content-type': 'application/json' }); res.end('{}'); },
      default: (_req, res) => { setTimeout(() => { res.writeHead(200); res.end(JSON.stringify({ results: [] })); }, 5000); },
    });
    try {
      const outcome = await runResearch({
        jobId: 'job', attemptN: 3, repoPath: '/repos/app', workspacePath: workspace,
        stuck: stuckOf(PYTHON_ERROR), files: ['app/main.py'],
        repoSearch: async () => [{ path: 'app/main.py', content: 'import requests' }],
        helpedNotes: [],
        limits: limits({ searxngUrl: stub.url, sourceTimeoutMs: 250 }),
        fetchImpl: guardedFetch(url => url.host === new URL(stub.url).host),
      });
      const bySource = new Map(outcome.record.sources.map(s => [s.source, s]));
      expect(bySource.get('repo')!.status).toBe('ran');
      expect(bySource.get('pydoc')!.status).toBe('timed_out');
      expect(bySource.get('searxng')!.status).toBe('timed_out');
      expect(outcome.block).toContain('app/main.py');
      const pid = Number(await readFile(pidFile, 'utf8'));
      await new Promise(resolve => setTimeout(resolve, 150));
      expect(() => process.kill(pid, 0)).toThrow();
    } finally { await stub.close(); }
  });

  it('redacts secrets, absolute paths and repo names from everything stored (#155 criteria 4, 12e)', async () => {
    const stub = await stubServer({});
    try {
      const secretError = `/home/spy/secret-repo/src/a.ts(1,1): error TS2339 boom token sk-abcdef1234567890abcdef1234567890 API_KEY=hunter2value`;
      const outcome = await runResearch({
        jobId: 'job', attemptN: 2, repoPath: '/home/spy/secret-repo', workspacePath: workspace,
        privateTerms: ['secret-repo'],
        stuck: stuckOf(secretError), files: ['src/a.ts'],
        repoSearch: async () => [{ path: 'src/a.ts', content: 'const fine = 1;' }],
        helpedNotes: [], limits: limits({ searxngUrl: stub.url }),
      });
      const stored = JSON.stringify({ record: outcome.record, inserts: outcome.inserts });
      expect(stored).not.toContain('sk-abcdef1234567890');
      expect(stored).not.toContain('hunter2value');
      expect(stored).toContain('TS2339');
      // repo_path is the scoping column by design (12h); the redacted fields —
      // reason, query, info, block — must carry no paths or repo names (12g).
      const meta = JSON.stringify(outcome.record);
      expect(meta).not.toContain('/home/spy');
      expect(meta).not.toContain('secret-repo');
      for (const row of outcome.inserts) {
        expect(row.reason).not.toContain('/home/spy');
        expect(row.reason).not.toContain('secret-repo');
        expect(row.query).not.toContain('secret-repo');
        expect(row.info).not.toContain('/home/spy');
      }
    } finally { await stub.close(); }
  });

  it('a helped note is reused: sources are skipped and no rows are written (#155 criterion 12c)', async () => {
    const outcome = await runResearch({
      jobId: 'job', attemptN: 3, repoPath: '/repos/app', workspacePath: workspace,
      stuck: stuckOf('unit\nexpected value TWO'),
      files: ['a.ts'],
      repoSearch: async () => { throw new Error('local sources must not run on reuse'); },
      helpedNotes: [{
        id: 7, repo_path: '/repos/other', source: 'deps', query: 'expected value TWO',
        info: 'REUSED_HINT import the constant', reason: 'same_check:unit\nunit\nexpected value TWO',
      }],
      limits: limits({ searxngUrl: 'http://127.0.0.1:1' }),
      fetchImpl: async () => { throw new Error('searxng must not be called on reuse'); },
    });
    expect(outcome.enabled).toBe(true);
    expect(outcome.record.reusedNoteId).toBe(7);
    expect(outcome.block).toContain('REUSED_HINT');
    expect(outcome.inserts).toHaveLength(0);
    expect(outcome.record.sources).toHaveLength(1);
    expect(outcome.record.sources[0]).toMatchObject({ source: 'deps', status: 'ran' });
  });

  it('a 403 probe disables research for the run (#155 criterion 6)', async () => {
    const stub = await stubServer({ default: (_req, res) => { res.writeHead(403); res.end('no'); } });
    try {
      const outcome = await runResearch({
        jobId: 'job', attemptN: 3, repoPath: '/repos/app', workspacePath: workspace,
        stuck: stuckOf(PYTHON_ERROR), files: [], repoSearch: async () => [],
        helpedNotes: [], limits: limits({ searxngUrl: stub.url }),
      });
      expect(outcome.enabled).toBe(false);
      expect(outcome.inserts).toHaveLength(0);
    } finally { await stub.close(); }
  });
});
