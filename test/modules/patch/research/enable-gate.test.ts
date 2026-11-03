import { afterEach, beforeEach, describe, expect, it } from '@jest/globals';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  runResearch, detectStuck, researchGate, redactText, resetSearxngProbeCache,
} from '../../../../dist/modules/patch/research/index.js';
import { resetStackexchangeState } from '../../../../dist/modules/patch/research/stackexchange.js';

let tmp: string;

beforeEach(async () => {
  tmp = await mkdtemp(path.join(os.tmpdir(), 'research-gate-'));
  await mkdir(path.join(tmp, 'ws'), { recursive: true });
  resetSearxngProbeCache();
  resetStackexchangeState();
});
afterEach(async () => { await rm(tmp, { recursive: true, force: true }); });

const attempt = (text: string) => ({ outcome: 'check_failed', applyError: null, checks: [{ name: 'unit', exit_code: 1, timed_out: false, duration_ms: 1, tail: text }] });
const stuckOf = (text: string) => detectStuck([attempt(text), attempt(text)])!;

function recordingFetch(calls: string[]) {
  return async (input: string): Promise<Response> => {
    const url = new URL(input);
    calls.push(url.host);
    if (url.host === 'api.stackexchange.com') {
      const body = url.pathname.endsWith('/search/advanced')
        ? { items: [{ question_id: 9, title: 'T', accepted_answer_id: 90 }] }
        : { items: [{ answer_id: 90, is_accepted: true, score: 1, body: '<p>fix it</p>' }] };
      return new Response(JSON.stringify(body), { status: 200 });
    }
    return new Response(JSON.stringify({ results: [{ title: 'S', url: 'https://example.com/s', content: 'snippet' }] }), { status: 200 });
  };
}

const research = (mode: 'on' | 'off' | 'auto' | undefined, searxngUrl: string, calls: string[]) => runResearch({
  jobId: 'gate-job', attemptN: 3, repoPath: '/repos/app', workspacePath: path.join(tmp, 'ws'),
  stuck: stuckOf('error TS2339: Property makeWidget does not exist'), files: [],
  repoSearch: async () => [{ path: 'a.ts', content: 'export const makeWidget = 1;' }], helpedNotes: [],
  limits: { searxngUrl, sourceTimeoutMs: 4000, tokens: 800, notesMax: 500, enabled: mode, stackexchange: {} },
  fetchImpl: recordingFetch(calls),
});

describe('PATCH_RESEARCH_ENABLED gate (#163 criterion 8)', () => {
  it('researchGate: unset and no URL is off; unset with URL is on; on is on; off is off; tokens 0 is off', () => {
    expect(researchGate('auto', '', 800)).toBe(false);
    expect(researchGate('auto', 'http://s', 800)).toBe(true);
    expect(researchGate('on', '', 800)).toBe(true);
    expect(researchGate('off', 'http://s', 800)).toBe(false);
    expect(researchGate('on', 'http://s', 0)).toBe(false);
  });

  it('unset and no URL: research is off', async () => {
    const calls: string[] = [];
    expect((await research('auto', '', calls)).enabled).toBe(false);
    expect(calls).toHaveLength(0);
  });

  it('on and no URL: local and stackexchange sources run, SearXNG is never called', async () => {
    const calls: string[] = [];
    const outcome = await research('on', '', calls);
    expect(outcome.enabled).toBe(true);
    const sources = outcome.record.sources.map(run => run.source);
    expect(sources).toEqual(expect.arrayContaining(['repo', 'stackexchange']));
    expect(sources).not.toContain('searxng');
    expect(calls.every(host => host === 'api.stackexchange.com')).toBe(true);
    expect(calls.length).toBeGreaterThan(0);
  });

  it('unset and URL set: research is on (old #155 behaviour) and SearXNG runs', async () => {
    const calls: string[] = [];
    const outcome = await research('auto', 'http://searx.test', calls);
    expect(outcome.enabled).toBe(true);
    expect(outcome.record.sources.map(run => run.source)).toContain('searxng');
  });

  it('off and URL set: research is off', async () => {
    const calls: string[] = [];
    expect((await research('off', 'http://searx.test', calls)).enabled).toBe(false);
    expect(calls).toHaveLength(0);
  });
});

describe('redaction and attribution (#163 criterion 9)', () => {
  it('redaction still removes a URL from error text', () => {
    const out = redactText('fetch failed for https://internal.corp.example/secret/path?x=1 in main');
    expect(out).not.toContain('internal.corp.example');
    expect(out).not.toContain('/secret/path');
  });

  it('a stored Stack Exchange note keeps its https://stackoverflow.com/a/<id> URL', async () => {
    const calls: string[] = [];
    const outcome = await research('on', '', calls);
    const note = outcome.inserts.find(row => row.source === 'stackexchange');
    expect(note).toBeDefined();
    expect(note!.info).toContain('https://stackoverflow.com/a/90');
    expect(outcome.block).toContain('https://stackoverflow.com/a/90');
  });
});
