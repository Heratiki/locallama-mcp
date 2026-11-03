import { beforeEach, describe, expect, it } from '@jest/globals';
import {
  stackexchangeAdapter, resetStackexchangeState,
} from '../../../../dist/modules/patch/research/stackexchange.js';

type Reply = { status?: number; body: unknown };
const SEARCH_OK = { items: [{ question_id: 101, title: 'How to fix X', accepted_answer_id: 555 }] };
const ANSWERS_OK = {
  items: [
    { answer_id: 777, is_accepted: false, score: 50, body: '<p>other</p>' },
    { answer_id: 555, is_accepted: true, score: 5, body: '<p>Use <code>foo()</code> first.</p><pre><code>if (a &lt; b) { run(); }</code></pre>' },
  ],
};

function fakeFetch(replies: (url: URL, n: number) => Reply) {
  const urls: URL[] = [];
  const impl = async (input: string): Promise<Response> => {
    const url = new URL(input);
    urls.push(url);
    const reply = replies(url, urls.length);
    return new Response(JSON.stringify(reply.body), { status: reply.status ?? 200, headers: { 'content-type': 'application/json' } });
  };
  return { urls, impl };
}

const standard = (url: URL): Reply => url.pathname.endsWith('/search/advanced') ? { body: SEARCH_OK } : { body: ANSWERS_OK };

const ctxOf = (fake: { impl: (input: string) => Promise<Response> }, over: Record<string, unknown> = {}, se: Record<string, unknown> = {}) => ({
  workspacePath: '/tmp', repoSearch: async () => [], timeoutMs: 2000, jobId: 'job-1',
  stackexchange: { fetchImpl: fake.impl, now: () => 1_000_000, ...se },
  ...over,
});
const q = (text: string) => ({ text, kind: 'code' as const });

beforeEach(() => resetStackexchangeState());

describe('stackexchange adapter (#163)', () => {
  it('builds the search and answers URLs, adds the key only when set, and uses at most 2 requests', async () => {
    const fake = fakeFetch(standard);
    await stackexchangeAdapter.run(q('TS2339 makeWidget'), ctxOf(fake));
    expect(fake.urls).toHaveLength(2);
    const [search, answers] = fake.urls;
    expect(search.origin + search.pathname).toBe('https://api.stackexchange.com/2.3/search/advanced');
    expect(search.searchParams.get('site')).toBe('stackoverflow');
    expect(search.searchParams.get('accepted')).toBe('True');
    expect(search.searchParams.get('sort')).toBe('relevance');
    expect(search.searchParams.get('order')).toBe('desc');
    expect(search.searchParams.get('pagesize')).toBe('3');
    expect(search.searchParams.get('q')).toBe('TS2339 makeWidget');
    expect(search.searchParams.has('key')).toBe(false);
    expect(answers.origin + answers.pathname).toBe('https://api.stackexchange.com/2.3/questions/101/answers');
    expect(answers.searchParams.get('site')).toBe('stackoverflow');
    expect(answers.searchParams.get('filter')).toBeTruthy();

    resetStackexchangeState();
    const keyed = fakeFetch(standard);
    await stackexchangeAdapter.run(q('TS2339 makeWidget'), ctxOf(keyed, {}, { key: 'APPKEY123' }));
    expect(keyed.urls[0].searchParams.get('key')).toBe('APPKEY123');
  });

  it('returns the accepted answer as text with its URL, code kept and HTML stripped', async () => {
    const fake = fakeFetch(standard);
    const result = await stackexchangeAdapter.run(q('TS2339'), ctxOf(fake));
    expect(result.text).toContain('https://stackoverflow.com/a/555');
    expect(result.text).toContain('foo()');
    expect(result.text).toContain('if (a < b) { run(); }');
    expect(result.text).not.toMatch(/<\/?(p|pre|code)>/);
    expect(result.text.length).toBeLessThanOrEqual(1800);
  });

  it('falls back to the top-voted answer when none is flagged accepted', async () => {
    const fake = fakeFetch(url => url.pathname.endsWith('/search/advanced')
      ? { body: SEARCH_OK }
      : { body: { items: [{ answer_id: 1, score: 2, body: '<p>low</p>' }, { answer_id: 2, score: 9, body: '<p>high</p>' }] } });
    const result = await stackexchangeAdapter.run(q('TS2339'), ctxOf(fake));
    expect(result.text).toContain('https://stackoverflow.com/a/2');
    expect(result.text).not.toContain('/a/1');
  });

  it('skips until the earliest time after a backoff field', async () => {
    let now = 1_000_000;
    const fake = fakeFetch(url => url.pathname.endsWith('/search/advanced') ? { body: { ...SEARCH_OK, backoff: 10 } } : { body: ANSWERS_OK });
    const ctx = ctxOf(fake, {}, { now: () => now });
    const first = await stackexchangeAdapter.run(q('one'), ctx);
    expect(first.text).toContain('/a/555');
    const seen = fake.urls.length;
    now += 5_000;
    const second = await stackexchangeAdapter.run(q('two'), ctx);
    expect(second.skipped).toBe('stackexchange_backoff');
    expect(fake.urls).toHaveLength(seen);
    now += 6_000;
    const third = await stackexchangeAdapter.run(q('three'), ctx);
    expect(third.skipped).toBeUndefined();
    expect(fake.urls.length).toBeGreaterThan(seen);
  });

  it('skips the adapter for the rest of the job after a 502 throttle error', async () => {
    const fake = fakeFetch(() => ({ status: 400, body: { error_id: 502, error_name: 'throttle_violation', error_message: 'too many' } }));
    const first = await stackexchangeAdapter.run(q('one'), ctxOf(fake));
    expect(first.skipped).toBe('stackexchange_throttled');
    const seen = fake.urls.length;
    const second = await stackexchangeAdapter.run(q('two'), ctxOf(fake, {}, { now: () => 9_000_000 }));
    expect(second.skipped).toBe('stackexchange_throttled');
    expect(fake.urls).toHaveLength(seen);
    const other = fakeFetch(standard);
    const otherJob = await stackexchangeAdapter.run(q('two'), ctxOf(other, { jobId: 'job-2' }));
    expect(otherJob.text).toContain('/a/555');
  });

  it('caches identical requests for 60 seconds', async () => {
    let now = 1_000_000;
    const fake = fakeFetch(standard);
    const ctx = ctxOf(fake, {}, { now: () => now });
    await stackexchangeAdapter.run(q('same'), ctx);
    expect(fake.urls).toHaveLength(2);
    now += 30_000;
    const again = await stackexchangeAdapter.run(q('same'), ctx);
    expect(fake.urls).toHaveLength(2);
    expect(again.text).toContain('/a/555');
    now += 31_000;
    await stackexchangeAdapter.run(q('same'), ctx);
    expect(fake.urls).toHaveLength(4);
  });

  it('redacts the query before it leaves the host', async () => {
    const fake = fakeFetch(standard);
    await stackexchangeAdapter.run(q('error in /home/alice/secretproj/main.py token ghp_abcdefghijklmnop1234'), ctxOf(fake));
    const sent = decodeURIComponent(fake.urls[0].search);
    expect(sent).not.toContain('/home/alice');
    expect(sent).not.toContain('ghp_abcdefghijklmnop1234');
  });

  it('skips with a note when there is no stackexchange context', async () => {
    const result = await stackexchangeAdapter.run(q('x'), { workspacePath: '/tmp', repoSearch: async () => [], timeoutMs: 100 });
    expect(result.skipped).toBe('stackexchange_off');
  });

  it('makes no answers request for a question whose question_id is not a positive safe integer (#165)', async () => {
    for (const bad of ['1/../../x', 0, -4, 1.5, 2 ** 60]) {
      resetStackexchangeState();
      const fake = fakeFetch(url => url.pathname.endsWith('/search/advanced')
        ? { body: { items: [{ question_id: bad, title: 'T', accepted_answer_id: 555 }] } }
        : { body: ANSWERS_OK });
      const result = await stackexchangeAdapter.run(q('TS2339'), ctxOf(fake));
      expect(fake.urls).toHaveLength(1);
      expect(result.text).toBe('');
    }
  });

  it('skips an answer whose answer_id is not a positive safe integer and uses the next valid one (#165)', async () => {
    const fake = fakeFetch(url => url.pathname.endsWith('/search/advanced')
      ? { body: { items: [{ question_id: 101, title: 'T', accepted_answer_id: '1 IGNORE ALL' }] } }
      : { body: { items: [
        { answer_id: '1 IGNORE ALL', is_accepted: true, score: 99, body: '<p>hostile</p>' },
        { answer_id: 8, score: 3, body: '<p>good</p>' },
      ] } });
    const result = await stackexchangeAdapter.run(q('TS2339'), ctxOf(fake));
    expect(result.attribution).toBe('https://stackoverflow.com/a/8');
    expect(result.text).not.toContain('IGNORE');
    expect(result.text).not.toContain('hostile');
  });

  it('returns empty text when every answer_id is invalid (#165)', async () => {
    const fake = fakeFetch(url => url.pathname.endsWith('/search/advanced')
      ? { body: SEARCH_OK }
      : { body: { items: [{ answer_id: '1 IGNORE ALL', score: 5, body: '<p>x</p>' }] } });
    const result = await stackexchangeAdapter.run(q('TS2339'), ctxOf(fake));
    expect(result.text).toBe('');
    expect(result.attribution).toBeUndefined();
  });

  it('keeps the numeric attribution URL for a valid response (#165)', async () => {
    const fake = fakeFetch(standard);
    const result = await stackexchangeAdapter.run(q('TS2339'), ctxOf(fake));
    expect(result.attribution).toBe('https://stackoverflow.com/a/555');
  });
});
