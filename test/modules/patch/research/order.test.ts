import { afterEach, beforeEach, describe, expect, it } from '@jest/globals';
import { mkdtemp, mkdir, writeFile, chmod, rm } from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { runResearch, resetSearxngProbeCache, detectStuck } from '../../../../dist/modules/patch/research/index.js';
import { resetStackexchangeState } from '../../../../dist/modules/patch/research/stackexchange.js';

let tmp: string;
let workspace: string;
let binDir: string;
let realPath: string;

beforeEach(async () => {
  tmp = await mkdtemp(path.join(os.tmpdir(), 'research-order-'));
  workspace = path.join(tmp, 'ws');
  binDir = path.join(tmp, 'bin');
  await mkdir(workspace, { recursive: true });
  await mkdir(binDir, { recursive: true });
  realPath = process.env.PATH ?? '';
  process.env.PATH = `${binDir}${path.delimiter}${realPath}`;
  resetSearxngProbeCache();
  resetStackexchangeState();
});
afterEach(async () => {
  process.env.PATH = realPath;
  await rm(tmp, { recursive: true, force: true });
});

function stuckOf(errorText: string) {
  const attempt = { outcome: 'check_failed', applyError: null, checks: [{ name: 'unit', exit_code: 1, timed_out: false, duration_ms: 1, tail: errorText }] };
  const stuck = detectStuck([attempt, attempt]);
  expect(stuck).not.toBeNull();
  return stuck!;
}

// A fake fetch only: no test here touches the network.
function orderFetch(calls: string[]) {
  return async (input: string): Promise<Response> => {
    const url = new URL(input);
    calls.push(url.host + url.pathname);
    if (url.host === 'api.stackexchange.com') {
      const body = url.pathname.endsWith('/search/advanced')
        ? { items: [{ question_id: 9, title: 'T', accepted_answer_id: 90 }] }
        : { items: [{ answer_id: 90, is_accepted: true, score: 1, body: '<p>fix it</p>' }] };
      return new Response(JSON.stringify(body), { status: 200 });
    }
    return new Response(JSON.stringify({ results: [{ title: 'S', url: 'https://example.com/s', content: 'snippet' }] }), { status: 200 });
  };
}

async function orderRun(stackexchange: { key?: string } | undefined, calls: string[]) {
  const rustc = path.join(binDir, 'rustc');
  await writeFile(rustc, '#!/bin/sh\necho "explained $*"\n', 'utf8');
  await chmod(rustc, 0o755);
  return runResearch({
    jobId: 'order-job', attemptN: 3, repoPath: '/repos/app', workspacePath: workspace,
    stuck: stuckOf('error[E0308]: mismatched types\n --> src/main.rs:4:5'), files: [],
    repoSearch: async () => [{ path: 'src/main.rs', content: 'fn main() {}' }], helpedNotes: [],
    limits: {
      searxngUrl: 'http://searx.test', sourceTimeoutMs: 4000, tokens: 800, notesMax: 500,
      ...(stackexchange ? { stackexchange } : {}),
    },
    fetchImpl: orderFetch(calls),
  });
}

describe('runResearch source order and Stack Exchange setting (#163)', () => {
  it('runs local and explain sources before stackexchange, and stackexchange before searxng', async () => {
    const calls: string[] = [];
    const outcome = await orderRun({}, calls);
    const order: string[] = outcome.record.sources.map(run => run.source);
    expect(order.indexOf('repo')).toBeGreaterThanOrEqual(0);
    expect(order.indexOf('deps')).toBeLessThan(order.indexOf('stackexchange'));
    expect(order.indexOf('explain')).toBeGreaterThan(order.indexOf('repo'));
    expect(order.indexOf('explain')).toBeLessThan(order.indexOf('stackexchange'));
    expect(order.indexOf('stackexchange')).toBeGreaterThanOrEqual(0);
    expect(order.indexOf('stackexchange')).toBeLessThan(order.indexOf('searxng'));
    expect(outcome.record.sources.find(run => run.source === 'stackexchange')).toMatchObject({ status: 'ran' });
    expect(outcome.block).toContain('https://stackoverflow.com/a/90');
  });

  it('does not call the stackexchange adapter when the setting is off', async () => {
    const calls: string[] = [];
    const outcome = await orderRun(undefined, calls);
    expect(outcome.record.sources.some(run => run.source === 'stackexchange')).toBe(false);
    expect(calls.some(call => call.startsWith('api.stackexchange.com'))).toBe(false);
  });
});
