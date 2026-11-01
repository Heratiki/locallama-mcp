import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import path from 'node:path';
import os from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { PatchState, LadderEntry, CheckSpec } from '../../../src/modules/patch/types.js';
import type { LLMProvider, TaskExecutionOptions } from '../../../src/modules/core/provider/types.js';

jest.unstable_mockModule('../../../dist/modules/telemetry/index.js', () => ({
  withSpan: async <T,>(_name: string, _attributes: Record<string, unknown>, run: (span: unknown) => Promise<T>) =>
    run({ setAttribute: () => {}, setAttributes: () => {} }),
}));
jest.unstable_mockModule('../../../dist/utils/logger.js', () => ({ logger: {
  error: jest.fn(), warn: jest.fn(), info: jest.fn(), debug: jest.fn(),
} }));

const { PatchWorker, snapshotPatchWorkspace } = await import('../../../dist/modules/patch/worker/index.js');
const { GitWorkspaceBackend } = await import('../../../dist/modules/patch/workspace/index.js');
const { ProviderRegistry } = await import('../../../dist/modules/core/provider/registry.js');
const store = await import('../../../dist/modules/job-store/index.js');
const { config } = await import('../../../dist/config/index.js');

const exec = promisify(execFile);
let root: string;
let repo: string;
let backend: InstanceType<typeof GitWorkspaceBackend>;
let registry: InstanceType<typeof ProviderRegistry>;
let calls: { model: string; prompt: string; options: TaskExecutionOptions }[];
let state: PatchState;
let savedConfig: { searxngUrl: string; tokens: number; timeoutMs: number; notesMax: number };
let stub: { url: string; close: () => Promise<void>; requests: number } | undefined;

const local = (model_id = 'qwen-1'): LadderEntry => ({ model_id, provider_id: 'fake', cost_class: 'local' });
const block = (value = 2) => `a.ts\n<<<<<<< SEARCH\nexport const value = 1;\n=======\nexport const value = ${value};\n>>>>>>> REPLACE\n`;
const check: CheckSpec = { name: 'unit', argv: [process.execPath, '-e', "const f=require('fs'); if(!f.readFileSync('a.ts','utf8').includes('value = 2')) {console.error('expected value TWO');process.exit(1)}"] };

function provider(reply: (model: string, prompt: string) => Promise<{ content: string }>): LLMProvider {
  return {
    id: 'fake', displayName: 'fake', costClass: 'local', isLocal: true, init: async () => {}, isAvailable: async () => true,
    listModels: async () => [{ id: 'qwen-1', contextWindow: 8192 }],
    supportsModel: () => true, getCost: () => ({ prompt: 0.00001, completion: 0.00002 }),
    executeTask: async (model, prompt, options = {}) => {
      calls.push({ model, prompt, options });
      return { ...await reply(model, prompt), model };
    },
  };
}

async function startStub(): Promise<{ url: string; close: () => Promise<void>; requests: number }> {
  let requests = 0;
  const server = http.createServer((_req, res) => {
    requests++;
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ results: [{ title: 'Fix expected value', url: 'https://example.com/fix', content: 'Assign the expected constant.' }] }));
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const handle = { url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, close: () => new Promise<void>(resolve => server.close(() => resolve())), get requests() { return requests; } };
  return handle;
}

async function git(...args: string[]) { return (await exec('git', args, { cwd: repo })).stdout.trim(); }

async function submit(options: { settings?: object; checks?: CheckSpec[] } = {}) {
  const base = await snapshotPatchWorkspace(backend, repo, ['a.ts'], 'job');
  const now = Date.now();
  state = {
    job_id: 'job', request_json: JSON.stringify({ goal: 'set value to 2', repo_path: repo, file_hints: ['a.ts'] }),
    base_commit: base, checks_json: JSON.stringify(options.checks ?? [check]),
    // Two models: a repeated error signature advances the cursor after the
    // second identical failure, so attempt 3 runs on the second model.
    ladder_json: JSON.stringify([local(), local('llama-1')]),
    settings_json: JSON.stringify({ patchMaxAttempts: 5, patchAttemptsPerModel: 5, openRouterFreeOnly: false, ...options.settings }),
    deadline_at: now + 60000, cursor_model: 0, attempts_used: 0, paid_spent_usd: 0, paid_reserved_usd: 0, updated_at: now,
  };
  await store.submitPatchJob({ id: 'task', status: 'queued', job_count: 1, completed_count: 0, failed_count: 0, created_at: now }, {
    id: 'job', task_id: 'task', status: 'queued', provider_id: null, model_id: null, task_text: 'patch', result: null, error: null,
    queue_position: null, is_local: null, progress_pct: 0, poll_again_after_ms: null, retry_count: 0, created_at: now, started_at: null, completed_at: null, kind: 'patch',
  }, state);
  expect(await store.claimPatchJob('job')).toBe(true);
}

const worker = () => new PatchWorker({ backend, registry });

beforeEach(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), 'patch-worker-research-'));
  repo = path.join(root, 'repo');
  await mkdir(repo);
  await git('init', '-q');
  await git('config', 'user.name', 'Test');
  await git('config', 'user.email', 'test@example.com');
  await writeFile(path.join(repo, 'a.ts'), 'export const value = 1;\n');
  await git('add', 'a.ts');
  await git('commit', '-qm', 'base');
  process.env.JOB_DB_PATH = path.join(root, 'jobs.db');
  await store.initJobStore();
  backend = new GitWorkspaceBackend(repo, { rootDir: root });
  registry = new ProviderRegistry();
  calls = [];
  registry.register(provider(async () => ({ content: block() })));
  savedConfig = {
    searxngUrl: config.patchResearchSearxngUrl, tokens: config.patchResearchTokens,
    timeoutMs: config.patchResearchSourceTimeoutMs, notesMax: config.patchResearchNotesMax,
  };
});

afterEach(async () => {
  Object.assign(config, {
    patchResearchSearxngUrl: savedConfig.searxngUrl, patchResearchTokens: savedConfig.tokens,
    patchResearchSourceTimeoutMs: savedConfig.timeoutMs, patchResearchNotesMax: savedConfig.notesMax,
  });
  await stub?.close();
  stub = undefined;
  await store.closeJobStore();
  delete process.env.JOB_DB_PATH;
  await rm(root, { recursive: true, force: true });
});

async function enableResearch(over: Record<string, unknown> = {}): Promise<string> {
  stub ??= await startStub();
  Object.assign(config, {
    patchResearchSearxngUrl: stub.url, patchResearchTokens: 800,
    patchResearchSourceTimeoutMs: 5000, patchResearchNotesMax: 500, ...over,
  });
  return stub.url;
}

describe('patch worker research integration (#155)', () => {
  it('off by default: a stuck loop behaves exactly as today (#155 criterion 1)', async () => {
    registry.register(provider(async () => ({ content: calls.length < 3 ? block(3) : block() })));
    await submit();
    const result = await worker().run('job');
    expect(result.status).toBe('passed');
    expect(result.attempts).toBe(3);
    for (const call of calls) {
      expect(call.prompt).not.toContain('## Research notes');
      expect(call.options.systemPrompt).toContain('<<<<<<< SEARCH');
    }
    expect(calls[1].prompt).toContain('expected value TWO');
    expect(result.research).toBeUndefined();
    const notes = await store.getResearchNotesForJob('job');
    expect(notes).toHaveLength(0);
    expect((await store.getPatchAttempts('job'))).toHaveLength(3);
  });

  it('research runs when stuck, feeds the next prompt and stores rows and meta (#155 criteria 12, 12a)', async () => {
    await enableResearch();
    registry.register(provider(async () => ({ content: calls.length < 3 ? block(3) : block() })));
    await submit();
    const result = await worker().run('job');
    expect(result.status).toBe('passed');
    expect(calls[0].prompt).not.toContain('## Research notes');
    expect(calls[1].prompt).not.toContain('## Research notes');
    expect(calls[2].prompt).toContain('## Research notes');
    expect(calls[2].prompt).toContain('expected value TWO');
    // meta JSON of the attempt that used the research
    const attempts = await store.getPatchAttempts('job');
    const meta = JSON.parse(attempts.find(a => a.n === 3)!.edit_blocks!);
    expect(meta.research.schema).toBe('patch_research_v1');
    expect(meta.research.queries.length).toBeGreaterThan(0);
    expect(meta.research.sources.map((s: { source: string; status: string }) => `${s.source}:${s.status}`))
      .toEqual(expect.arrayContaining(['searxng:ran']));
    expect(meta.research.block).toBe(meta.research.block.trim());
    // one row per query/source that returned info
    const notes = await store.getResearchNotesForJob('job');
    expect(notes.length).toBeGreaterThanOrEqual(1);
    expect(notes.every(n => n.attempt_n === 3 && n.repo_path === repo && n.helped === 1)).toBe(true);
    expect(stub!.requests).toBeGreaterThanOrEqual(1);
    // visible in the task result
    expect(result.research).toHaveLength(1);
    expect(result.research![0].block).toBe(meta.research.block);
  });

  it('helped stays NULL while pending and resolves to 0 on budget failure (#155 criterion 12b)', async () => {
    await enableResearch();
    registry.register(provider(async () => ({ content: block(3) })));
    await submit({ settings: { patchMaxAttempts: 3 } });
    const result = await worker().run('job');
    expect(result.status).toBe('failed');
    const notes = await store.getResearchNotesForJob('job');
    expect(notes.length).toBeGreaterThanOrEqual(1);
    expect(notes.every(n => n.helped === 0)).toBe(true);
  });

  it('a cancelled task resolves pending notes to 0 (#155 criterion 12b)', async () => {
    await enableResearch();
    let attempt = 0;
    let release!: () => void;
    const held = new Promise<void>(resolve => { release = resolve; });
    registry.register(provider(async () => {
      attempt++;
      if (attempt <= 2) return { content: block(3) };
      await held;
      return { content: block() };
    }));
    await submit({ settings: { patchMaxAttempts: 4 } });
    const w = worker();
    const running = w.run('job');
    // Research rows for attempt 3 are written after attempt 2 fails.
    for (let i = 0; i < 300; i++) {
      if ((await store.getResearchNotesForJob('job')).length > 0) break;
      await new Promise(resolve => setTimeout(resolve, 20));
    }
    const pending = await store.getResearchNotesForJob('job');
    expect(pending.length).toBeGreaterThanOrEqual(1);
    expect(pending.every(n => n.helped === null)).toBe(true);
    await store.cancelJobsForTask('task');
    w.cancel('job');
    release();
    const result = await running;
    expect(result.status).toBe('cancelled');
    const resolved = await store.getResearchNotesForJob('job');
    expect(resolved.length).toBeGreaterThanOrEqual(1);
    expect(resolved.every(n => n.helped === 0)).toBe(true);
  });

  it('not stuck means no research and no section (#155 criterion 14)', async () => {
    await enableResearch();
    registry.register(provider(async () => ({
      // attempt 1: check failure; attempt 2: apply error (different failure mode); attempt 3: pass
      content: calls.length === 1 ? block(3) : calls.length === 2 ? block().replace('value = 1', 'value = 99') : block(),
    })));
    await submit();
    const result = await worker().run('job');
    expect(result.status).toBe('passed');
    expect(calls[2].prompt).not.toContain('## Research notes');
    expect(result.research).toBeUndefined();
    expect(await store.getResearchNotesForJob('job')).toHaveLength(0);
    expect(stub!.requests).toBe(0);
  });

  it('secrets from the error never reach the research rows or meta JSON (#155 criterion 12e)', async () => {
    await enableResearch();
    const leakCheck: CheckSpec = { name: 'leak', argv: [process.execPath, '-e', "console.error('boom sk-abcdef1234567890abcdef1234567890'); process.exit(1)"] };
    registry.register(provider(async () => ({ content: calls.length < 3 ? block(3) : block() })));
    await submit({ checks: [leakCheck] });
    await worker().run('job');
    const notes = await store.getResearchNotesForJob('job');
    expect(notes.length).toBeGreaterThanOrEqual(1);
    const stored = JSON.stringify({ notes, attempts: await store.getPatchAttempts('job') });
    // The attempt row itself carries the error tail (unchanged behavior)…
    expect(JSON.stringify(await store.getPatchAttempts('job'))).toContain('sk-abcdef1234567890');
    // …but the research meta and notes do not.
    const meta = JSON.parse((await store.getPatchAttempts('job')).find(a => a.n === 3)!.edit_blocks!);
    expect(JSON.stringify(meta.research)).not.toContain('sk-abcdef1234567890');
    expect(JSON.stringify(notes)).not.toContain('sk-abcdef1234567890');
  });

  it('a helped note is reused with zero SearXNG requests and no new rows (#155 criterion 12c)', async () => {
    await enableResearch();
    await store.insertResearchNote({
      job_id: 'old', attempt_n: 1, created_at: 1, repo_path: repo,
      reason: 'same_check:unit\nunit\nexpected value TWO', query: 'expected value TWO',
      source: 'searxng', info: 'REUSED_NOTE_HINT assign the constant directly',
    });
    await store.markResearchNotesHelped('old', 1, 1);
    registry.register(provider(async () => ({ content: calls.length < 3 ? block(3) : block() })));
    await submit();
    const result = await worker().run('job');
    expect(result.status).toBe('passed');
    expect(stub!.requests).toBe(0);
    expect(calls[2].prompt).toContain('## Research notes');
    expect(calls[2].prompt).toContain('REUSED_NOTE_HINT');
    const notes = await store.getResearchNotesForJob('job');
    expect(notes).toHaveLength(0); // reuse writes no new rows
    const meta = JSON.parse((await store.getPatchAttempts('job')).find(a => a.n === 3)!.edit_blocks!);
    expect(meta.research.reusedNoteId).toBe(1);
  });
});

it.each(['empty URL', 'zero tokens'])('S12 research OFF (%s) makes zero research-store calls', async mode => {
  config.patchResearchSearxngUrl = mode === 'empty URL' ? '' : 'http://127.0.0.1:1';
  config.patchResearchTokens = mode === 'zero tokens' ? 0 : 800;
  const spies = {
    insertResearchNote: jest.fn(store.insertResearchNote),
    getHelpedResearchNotes: jest.fn(store.getHelpedResearchNotes),
    markResearchNotesHelped: jest.fn(store.markResearchNotesHelped),
    failPendingResearchNotes: jest.fn(store.failPendingResearchNotes),
    enforceResearchNotesCap: jest.fn(store.enforceResearchNotesCap),
  };
  registry.register(provider(async () => ({ content: calls.length < 3 ? block(3) : block() })));
  await submit();
  const result = await new PatchWorker({ backend, registry, store: { ...store, ...spies } }).run('job');
  expect(result.status).toBe('passed');
  for (const spy of Object.values(spies)) expect(spy).not.toHaveBeenCalled();
});

it('S6 notes dropped by prompt fitting are never credited for a passing attempt', async () => {
  await enableResearch();
  registry.register(provider(async () => ({ content: calls.length < 3 ? block(3) : block() })));
  await submit({ settings: { patchContextTokens: 2200, patchMaxOutputTokens: 2000 } });
  const result = await worker().run('job');
  expect(result.status).toBe('passed');
  expect(calls[2].prompt).not.toContain('## Research notes');
  const notes = await store.getResearchNotesForJob('job');
  expect(notes.length).toBeGreaterThan(0);
  expect(notes.every(note => note.helped === 0)).toBe(true);
});

it('S6 assembly-truncated notes are not credited as fully used notes', async () => {
  await enableResearch({ patchResearchTokens: 20 });
  registry.register(provider(async () => ({ content: calls.length < 3 ? block(3) : block() })));
  await submit();
  expect((await worker().run('job')).status).toBe('passed');
  const notes = await store.getResearchNotesForJob('job');
  expect(notes.length).toBeGreaterThan(0);
  expect(notes.some(note => !calls[2].prompt.includes(note.info!))).toBe(true);
  for (const note of notes) {
    if (!calls[2].prompt.includes(note.info!)) expect(note.helped).toBe(0);
  }
});

it('S6 restart pending notes without restored researchForNext resolve to zero', async () => {
  await enableResearch();
  await submit();
  await store.recordAttemptStart('job', { cursor_model: 1, attempts_used: 2 });
  for (const n of [1, 2]) await store.insertPatchAttempt({
    job_id: 'job', n, model_id: 'qwen-1', provider_id: 'fake', cost_class: 'local',
    prompt_tokens: 0, completion_tokens: 0, cost_usd: 0, edit_blocks: '[]', outcome: 'check_failed',
    apply_error: 'expected value TWO', checks_json: JSON.stringify([{ name: 'unit', exit_code: 1, timed_out: false, duration_ms: 1, tail: 'expected value TWO' }]),
    duration_ms: 1, started_at: 1, ended_at: 2,
  });
  await store.insertResearchNote({ job_id: 'job', attempt_n: 3, created_at: 3, repo_path: repo,
    reason: 'same_check:unit', query: 'unit', source: 'searxng', info: 'ORPHAN_NOTE_NEVER_RESTORED' });
  await store.closeJobStore();
  await store.initJobStore();
  expect((await worker().run('job')).status).toBe('passed');
  expect(calls).toHaveLength(1);
  expect(calls[0].prompt).not.toContain('ORPHAN_NOTE_NEVER_RESTORED');
  expect((await store.getResearchNotesForJob('job')).map(note => note.helped)).toEqual([0]);
});

it.each(['passed', 'check_failed'])('S13 restart restores %s attempt research into the task record', async outcome => {
  await enableResearch();
  await submit();
  const ws = await backend.create(state.base_commit, 'job');
  await writeFile(path.join(ws.path, 'a.ts'), 'export const value = 2;\n');
  const diff = await backend.diff(ws);
  const research = { schema: 'patch_research_v1', reason: 'same_check:unit',
    queries: ['expected value TWO'], sources: [{ source: 'searxng', query: 'expected value TWO', status: 'ran', info: 'RECOVERED_RESEARCH' }],
    block: 'RECOVERED_RESEARCH' };
  await store.recordAttemptStart('job', { cursor_model: 0, attempts_used: 1 });
  await store.insertPatchAttempt({ job_id: 'job', n: 1, model_id: 'qwen-1', provider_id: 'fake', cost_class: 'local',
    prompt_tokens: 10, completion_tokens: 20, cost_usd: 0,
    edit_blocks: JSON.stringify({ blocks: [], calls: [], files: ['a.ts'], diff, research }), outcome, apply_error: null,
    checks_json: JSON.stringify([{ name: 'unit', exit_code: outcome === 'passed' ? 0 : 1, timed_out: false, duration_ms: 1, tail: '' }]),
    duration_ms: 1, started_at: 1, ended_at: 2 });
  await store.closeJobStore();
  await store.initJobStore();
  const result = await worker().run('job');
  expect(result.status).toBe('passed');
  expect(result.research).toEqual([research]);
  expect(JSON.parse((await store.getJob('job'))!.result!).research).toEqual([research]);
  expect(calls).toHaveLength(outcome === 'passed' ? 0 : 1);
});

it('S6 a recovered passing attempt credits only durable used note ids', async () => {
  await enableResearch();
  await submit();
  const inserted = [];
  for (const info of ['USED_NOTE', 'DROPPED_NOTE']) inserted.push(await store.insertResearchNote({
    job_id: 'job', attempt_n: 1, created_at: 1, repo_path: repo, reason: 'same_check:unit',
    query: 'unit', source: 'searxng', info,
  }));
  const research = { schema: 'patch_research_v1', reason: 'same_check:unit', queries: ['unit'],
    sources: [], block: 'USED_NOTE', usedNoteIds: [inserted[0]] };
  const ws = await backend.create(state.base_commit, 'job');
  await writeFile(path.join(ws.path, 'a.ts'), 'export const value = 2;\n');
  const diff = await backend.diff(ws);
  await store.recordAttemptStart('job', { cursor_model: 0, attempts_used: 1 });
  await store.insertPatchAttempt({ job_id: 'job', n: 1, model_id: 'qwen-1', provider_id: 'fake', cost_class: 'local',
    prompt_tokens: 0, completion_tokens: 0, cost_usd: 0,
    edit_blocks: JSON.stringify({ blocks: [], calls: [], diff, files: ['a.ts'], research }), outcome: 'passed', apply_error: null,
    checks_json: JSON.stringify([{ name: 'unit', exit_code: 0, timed_out: false, duration_ms: 1, tail: '' }]),
    duration_ms: 1, started_at: 1, ended_at: 2 });
  await store.closeJobStore();
  await store.initJobStore();
  const result = await worker().run('job');
  expect(result.status).toBe('passed');
  expect(calls).toHaveLength(0);
  expect((await store.getResearchNotesForJob('job')).map(note => note.helped)).toEqual([1, 0]);
  expect(result.research).toEqual([research]);
});

it('round 2 #3 short env credentials never reach queries, research rows or attempt meta JSON', async () => {
  const previous = process.env.MY_TOKEN;
  process.env.MY_TOKEN = 'abcde';
  try {
    await enableResearch();
    registry.register(provider(async () => ({ content: calls.length < 3 ? block(3) : block() })));
    const missingModule: CheckSpec = { name: 'unit', argv: [process.execPath, '-e',
      `if (!require('fs').readFileSync('a.ts', 'utf8').includes('value = 2')) { console.error("No module named 'abcde'"); process.exit(1); }`] };
    await submit({ checks: [missingModule] });
    const result = await worker().run('job');
    expect(result.status).toBe('passed');
    const notes = await store.getResearchNotesForJob('job');
    expect(notes.length).toBeGreaterThan(0);
    expect(JSON.stringify(notes)).not.toContain('abcde');
    const attempts = await store.getPatchAttempts('job');
    const meta = JSON.parse(attempts.find(attempt => attempt.n === 3)!.edit_blocks!);
    expect(meta.research.queries.length).toBeGreaterThan(0);
    expect(JSON.stringify(meta)).not.toContain('abcde');
    expect(JSON.stringify(result.research)).not.toContain('abcde');
  } finally {
    if (previous === undefined) delete process.env.MY_TOKEN; else process.env.MY_TOKEN = previous;
  }
});
