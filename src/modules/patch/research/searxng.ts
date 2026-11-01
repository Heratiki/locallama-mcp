import { logger } from '../../../utils/logger.js';

export type SearxngProbeState = 'ok' | 'disabled' | 'unreachable';

export interface SearxngResult {
  title: string;
  url: string;
  content: string;
}

/** Raised when the request was aborted because of the source timeout. */
export class SourceTimeoutError extends Error {
  constructor() { super('SearXNG request timed out'); }
}

export type FetchLike = (input: string, init?: { signal?: AbortSignal; headers?: Record<string, string> }) => Promise<Response>;

/** Memoized per URL: 'ok' and 'disabled' hold for the whole run (#155 criterion 6). */
const probeCache = new Map<string, 'ok' | 'disabled'>();

/** Test seam: forget the memoized probe results. */
export function resetSearxngProbeCache(): void {
  probeCache.clear();
}

function searchUrl(base: string, query: string): string {
  if (!/^https?:\/\//i.test(base)) throw new Error(`SearXNG URL must be http(s): ${base}`);
  const url = new URL('search', base.endsWith('/') ? base : `${base}/`);
  url.searchParams.set('q', query);
  url.searchParams.set('format', 'json');
  return url.toString();
}

async function get(base: string, query: string, timeoutMs: number, fetchImpl: FetchLike): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new SourceTimeoutError()), timeoutMs);
  try {
    return await fetchImpl(searchUrl(base, query), { signal: controller.signal, headers: { accept: 'application/json' } });
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Probe the instance at first use (#155 criterion 6). A 403 on format=json
 * means JSON output is disabled in the instance's settings.yml
 * (search.formats must include json): log one clear warning naming that fix
 * and treat research as off for the run. A down or timed-out instance is
 * 'unreachable': the web source is skipped, local sources keep running.
 */
export async function probeSearxng(base: string, timeoutMs: number, fetchImpl: FetchLike = fetch): Promise<SearxngProbeState> {
  const cached = probeCache.get(base);
  if (cached) return cached;
  let response: Response;
  try {
    response = await get(base, 'locallama probe', timeoutMs, fetchImpl);
  } catch {
    return 'unreachable';
  }
  if (response.status === 403) {
    probeCache.set(base, 'disabled');
    logger.warn(
      `Patch research: SearXNG at ${base} returned 403 for format=json. JSON output is disabled on that instance — ` +
      'add "json" to search.formats in its settings.yml and restart it. Web research stays off for this run.',
    );
    return 'disabled';
  }
  if (response.ok) {
    probeCache.set(base, 'ok');
    return 'ok';
  }
  return 'unreachable';
}

/**
 * One snippet-only web search (#155 ruling 4, criterion 5):
 * GET <url>/search?q=...&format=json, keeping title, url and content of the
 * top N results. No result page is ever fetched.
 */
export async function searchSearxng(
  base: string, query: string, timeoutMs: number, topN: number, fetchImpl: FetchLike = fetch,
): Promise<SearxngResult[]> {
  const response = await get(base, query, timeoutMs, fetchImpl);
  if (!response.ok) throw new Error(`SearXNG HTTP ${response.status}`);
  const body = JSON.parse(await response.text()) as { results?: Partial<SearxngResult>[] };
  return (body.results ?? []).slice(0, Math.max(1, topN)).map(result => ({
    title: String(result.title ?? ''),
    url: String(result.url ?? ''),
    content: String(result.content ?? ''),
  }));
}
