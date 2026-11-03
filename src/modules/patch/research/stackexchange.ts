import { redactText } from './redact.js';
import { SourceTimeoutError, type FetchLike } from './searxng.js';
import type { ResearchSourceAdapter, SourceText } from './sources.js';

/**
 * Stack Exchange API adapter (#163). REST API v2.3 only (never the Stack
 * Overflow MCP server: its terms forbid long-term storage). At most two
 * requests per research step: search/advanced, then the answers of the
 * best question. Notes keep a bounded excerpt plus the answer URL, which
 * is the attribution the API terms ask for. Content is CC BY-SA and is
 * never used for training.
 * https://api.stackexchange.com/docs/throttle
 */
const API = 'https://api.stackexchange.com/2.3';
const SEARCH_METHOD = 'search/advanced';
const ANSWERS_METHOD = 'questions/answers';
const CACHE_MS = 60_000;
const EXCERPT_CHARS = 1200;

interface CacheEntry { at: number; json: Record<string, unknown> }

/** Earliest time per method after a `backoff` field (shared by all jobs: the quota is per IP). */
const backoffUntil = new Map<string, number>();
/** Jobs for which the API answered with a throttle error (error_id 502). */
const throttledJobs = new Set<string>();
/** Identical requests within 60 s answer from memory. */
const cache = new Map<string, CacheEntry>();

/** Test seam: forget backoff, throttle and cache state. */
export function resetStackexchangeState(): void {
  backoffUntil.clear();
  throttledJobs.clear();
  cache.clear();
}

const ENTITIES: Record<string, string> = { lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

function decodeEntities(text: string): string {
  return text
    .replace(/&#x([0-9a-f]+);/gi, (_m, hex: string) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_m, dec: string) => String.fromCodePoint(parseInt(dec, 10)))
    .replace(/&(lt|gt|quot|apos|nbsp);/g, (_m, name: string) => ENTITIES[name])
    .replace(/&amp;/g, '&');
}

/** HTML to text; code blocks are kept (fenced), tags dropped, entities decoded last. */
export function htmlToText(html: string): string {
  const text = html
    .replace(/<pre[^>]*>\s*<code[^>]*>([\s\S]*?)<\/code>\s*<\/pre>/gi, (_m, code: string) => `\n\`\`\`\n${code}\n\`\`\`\n`)
    .replace(/<code[^>]*>([\s\S]*?)<\/code>/gi, '`$1`')
    .replace(/<br\s*\/?>|<\/p>|<\/li>|<\/h\d>|<\/pre>/gi, '\n')
    .replace(/<[^>]+>/g, '');
  return decodeEntities(text).replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}

type Call =
  | { kind: 'ok'; json: Record<string, unknown> }
  | { kind: 'skip'; reason: string };

async function call(
  method: string, url: URL, job: string, timeoutMs: number, fetchImpl: FetchLike, now: () => number,
): Promise<Call> {
  if ((backoffUntil.get(method) ?? 0) > now()) return { kind: 'skip', reason: 'stackexchange_backoff' };
  const cacheKey = url.toString();
  const hit = cache.get(cacheKey);
  if (hit && now() - hit.at < CACHE_MS) return { kind: 'ok', json: hit.json };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new SourceTimeoutError()), timeoutMs);
  let status: number;
  let json: Record<string, unknown> = {};
  try {
    const response = await fetchImpl(cacheKey, { signal: controller.signal, redirect: 'manual', headers: { accept: 'application/json' } });
    status = response.status;
    try { json = JSON.parse(await response.text()) as Record<string, unknown>; } catch { json = {}; }
  } catch (error) {
    if (controller.signal.aborted) throw new SourceTimeoutError();
    throw error;
  } finally {
    clearTimeout(timer);
  }
  if (typeof json.backoff === 'number' && json.backoff > 0) backoffUntil.set(method, now() + json.backoff * 1000);
  if ((status === 400 || status === 502) && json.error_id === 502) {
    throttledJobs.add(job);
    return { kind: 'skip', reason: 'stackexchange_throttled' };
  }
  if (status < 200 || status >= 300) return { kind: 'skip', reason: `stackexchange_http_${status}` };
  cache.set(cacheKey, { at: now(), json });
  return { kind: 'ok', json };
}

interface SearchItem { question_id?: number; title?: string; accepted_answer_id?: number }
interface AnswerItem { answer_id?: number; is_accepted?: boolean; score?: number; body?: string }

export const stackexchangeAdapter: ResearchSourceAdapter = {
  source: 'stackexchange',
  async run(query, ctx): Promise<SourceText> {
    const se = ctx.stackexchange;
    if (!se) return { text: '', skipped: 'stackexchange_off' };
    const job = ctx.jobId ?? '';
    const now = se.now ?? Date.now;
    // Guard: a test that did not inject a fetch must never reach the real API.
    if (!se.fetchImpl && process.env.NODE_ENV === 'test') return { text: '', skipped: 'stackexchange_no_fetch_in_tests' };
    const fetchImpl = se.fetchImpl ?? fetch;
    if (throttledJobs.has(job)) return { text: '', skipped: 'stackexchange_throttled' };
    // Queries leave the host: redact first, like the other web source.
    const q = redactText(query.text).trim();
    if (!q) return { text: '', skipped: 'empty_query' };

    const withKey = (url: URL): URL => { if (se.key) url.searchParams.set('key', se.key); return url; };
    const search = withKey(new URL(`${API}/${SEARCH_METHOD}`));
    search.searchParams.set('order', 'desc');
    search.searchParams.set('sort', 'relevance');
    search.searchParams.set('accepted', 'True');
    search.searchParams.set('q', q);
    search.searchParams.set('site', 'stackoverflow');
    search.searchParams.set('pagesize', '3');
    try {
      const found = await call(SEARCH_METHOD, search, job, ctx.timeoutMs, fetchImpl, now);
      if (found.kind === 'skip') return { text: '', skipped: found.reason };
      const item = ((found.json.items as SearchItem[] | undefined) ?? []).find(candidate => candidate.question_id !== undefined);
      if (!item) return { text: '' };

      const answersUrl = withKey(new URL(`${API}/questions/${item.question_id}/answers`));
      answersUrl.searchParams.set('order', 'desc');
      answersUrl.searchParams.set('sort', 'votes');
      answersUrl.searchParams.set('site', 'stackoverflow');
      answersUrl.searchParams.set('filter', 'withbody');
      answersUrl.searchParams.set('pagesize', '5');
      const got = await call(ANSWERS_METHOD, answersUrl, job, ctx.timeoutMs, fetchImpl, now);
      if (got.kind === 'skip') return { text: '', skipped: got.reason };
      const answers = ((got.json.items as AnswerItem[] | undefined) ?? []).filter(answer => answer.answer_id !== undefined);
      const best = answers.find(answer => answer.answer_id === item.accepted_answer_id || answer.is_accepted)
        ?? [...answers].sort((a, b) => (b.score ?? 0) - (a.score ?? 0))[0];
      if (!best) return { text: '' };
      const title = decodeEntities(String(item.title ?? '')).slice(0, 160);
      const excerpt = htmlToText(String(best.body ?? '')).slice(0, EXCERPT_CHARS);
      // Attribution first, so line-based block assembly never drops it.
      return { text: `Stack Overflow, CC BY-SA, ${title}: https://stackoverflow.com/a/${best.answer_id}\n${excerpt}` };
    } catch (error) {
      if (error instanceof SourceTimeoutError) return { text: '', timedOut: true };
      throw error;
    }
  },
};
