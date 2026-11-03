import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import * as os from 'node:os';
import * as path from 'node:path';
import * as fs from 'node:fs';

const warn = jest.fn();
jest.unstable_mockModule('../../../../dist/utils/logger.js', () => ({
  logger: { error: jest.fn(), warn, info: jest.fn(), debug: jest.fn() },
}));

const { config } = await import('../../../../dist/config/index.js');
const { probeSearxng, searchSearxng, resetSearxngProbeCache } = await import('../../../../dist/modules/patch/research/searxng.js');

let server: http.Server | undefined;
let baseUrl = '';
let handler: (req: http.IncomingMessage, res: http.ServerResponse) => void = () => {};
let requests: http.IncomingMessage[] = [];

async function start(handlerImpl: (req: http.IncomingMessage, res: http.ServerResponse) => void): Promise<void> {
  handler = handlerImpl;
  server = http.createServer((req, res) => { requests.push(req); handler(req, res); });
  await new Promise<void>(resolve => server!.listen(0, '127.0.0.1', resolve));
  baseUrl = `http://127.0.0.1:${(server!.address() as AddressInfo).port}`;
}

beforeEach(() => {
  resetSearxngProbeCache();
  requests = [];
});
afterEach(async () => {
  await new Promise<void>(resolve => server ? server.close(() => resolve()) : resolve());
  server = undefined;
});

describe('SearXNG source (#155 criteria 5 and 6)', () => {
  it('searches /search?q=...&format=json and keeps title, url and content of the top N results', async () => {
    await start((req, res) => {
      expect(req.url).toMatch(/^\/search\?/);
      const url = new URL(req.url ?? '/', 'http://127.0.0.1');
      expect(url.searchParams.get('format')).toBe('json');
      expect(url.searchParams.get('q')).toBe('TS2339 fix');
      const body = JSON.stringify({ results: [
        { title: 'First', url: 'https://example.com/1', content: 'Answer one' },
        { title: 'Second', url: 'https://example.com/2', content: 'Answer two' },
        { title: 'Third', url: 'https://example.com/3', content: 'Answer three' },
        { title: 'Fourth', url: 'https://example.com/4', content: 'Answer four' },
      ] });
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(body);
    });
    const results = await searchSearxng(baseUrl, 'TS2339 fix', 1000, 3);
    expect(results).toHaveLength(3);
    expect(results[0]).toEqual({ title: 'First', url: 'https://example.com/1', content: 'Answer one' });
    expect(results.map(r => r.title)).toEqual(['First', 'Second', 'Third']);
  });

  it('probes ok on a working instance', async () => {
    await start((_req, res) => { res.writeHead(200, { 'content-type': 'application/json' }); res.end('{}'); });
    expect(await probeSearxng(baseUrl, 1000)).toBe('ok');
  });

  it('a 403 probe means json format is disabled: one warning naming the settings.yml fix and research off for the run', async () => {
    await start((_req, res) => { res.writeHead(403, { 'content-type': 'text/html' }); res.end('forbidden'); });
    warn.mockClear();
    expect(await probeSearxng(baseUrl, 1000)).toBe('disabled');
    expect(warn).toHaveBeenCalledTimes(1);
    const message = String(warn.mock.calls[0].join(' '));
    expect(message).toContain('settings.yml');
    expect(message).toContain('search.formats');
    expect(message).toContain('json');
    expect(message).toContain(baseUrl);
    // Off for the run: the second probe does not hit the instance again.
    const before = requests.length;
    expect(await probeSearxng(baseUrl, 1000)).toBe('disabled');
    expect(requests).toHaveLength(before);
  });

  it('a down instance is unreachable (probe skips the web source, no failure)', async () => {
    const freePort = await new Promise<number>(resolve => {
      const probe = http.createServer();
      probe.listen(0, '127.0.0.1', () => { const port = (probe.address() as AddressInfo).port; probe.close(() => resolve(port)); });
    });
    expect(await probeSearxng(`http://127.0.0.1:${freePort}`, 1000)).toBe('unreachable');
  });

  it('a slow instance times out within the source timeout and is recorded as unreachable', async () => {
    await start((_req, res) => { setTimeout(() => { res.writeHead(200); res.end('{}'); }, 2000); });
    const started = Date.now();
    expect(await probeSearxng(baseUrl, 150)).toBe('unreachable');
    expect(Date.now() - started).toBeLessThan(1500);
  });

  it('a slow search times out and rejects', async () => {
    await start((req, res) => {
      const url = new URL(req.url ?? '/', 'http://127.0.0.1');
      if (url.searchParams.get('q')?.includes('probe')) { res.writeHead(200, { 'content-type': 'application/json' }); res.end('{}'); return; }
      setTimeout(() => { res.writeHead(200); res.end('{}'); }, 2000);
    });
    await expect(searchSearxng(baseUrl, 'slow query', 150, 3)).rejects.toThrow();
  });

  it('refuses non-http(s) bases without any request', async () => {
    expect(await probeSearxng('file:///etc/passwd', 1000)).toBe('unreachable');
    expect(requests).toHaveLength(0);
    // sanity: tmpdir has no listeners on that URL
    expect(fs.existsSync(path.join(os.tmpdir(), 'locallama-searxng-nonexistent'))).toBe(false);
  });
});


it('B1 rejects redirects without connecting to the redirect target', async () => {
  let connections = 0;
  const target = http.createServer((_req, res) => res.end('{"results":[]}'));
  target.on('connection', () => connections++);
  await new Promise<void>(resolve => target.listen(0, '127.0.0.1', resolve));
  try {
    await start((_req, res) => {
      res.writeHead(302, { location: `http://127.0.0.1:${(target.address() as AddressInfo).port}/search` });
      res.end();
    });
    const result = await searchSearxng(baseUrl, 'redirect', 1000, 3).then(() => 'ok', () => 'failed');
    expect(connections).toBe(0);
    expect(result).toBe('failed');
    expect(await probeSearxng(baseUrl, 1000)).toBe('unreachable');
    expect(connections).toBe(0);
  } finally {
    target.closeAllConnections();
    await new Promise<void>(resolve => target.close(() => resolve()));
  }
});

it('S7 times out while reading a stalled response body after headers', async () => {
  await start((_req, res) => {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.write('{"results":[');
    // Finite fallback makes the broken implementation fail without hanging Jest.
    const fallback = setTimeout(() => res.end(']}'), 700);
    res.on('close', () => clearTimeout(fallback));
  });
  const began = Date.now();
  await expect(searchSearxng(baseUrl, 'stalled body', 100, 3)).rejects.toThrow('timed out');
  expect(Date.now() - began).toBeLessThan(500);
  expect(await probeSearxng(baseUrl, 100)).toBe('unreachable');
});

describe('SearXNG categories parameter (#161)', () => {
  const saved = config.patchResearchSearxngCategories;
  afterEach(() => { config.patchResearchSearxngCategories = saved; });
  const ok = (_req: http.IncomingMessage, res: http.ServerResponse) => { res.writeHead(200, { 'content-type': 'application/json' }); res.end('{"results":[]}'); };

  it('sends categories=it,general (URL-encoded) with format=json by default', async () => {
    config.patchResearchSearxngCategories = ['it', 'general'];
    await start(ok);
    await searchSearxng(baseUrl, 'TS2339 fix', 1000, 3);
    expect(requests[0].url).toContain('categories=it%2Cgeneral');
    expect(requests[0].url).toContain('format=json');
  });

  it('sends no categories parameter when the list is empty', async () => {
    config.patchResearchSearxngCategories = [];
    await start(ok);
    await searchSearxng(baseUrl, 'TS2339 fix', 1000, 3);
    expect(requests[0].url).not.toContain('categories');
  });

  it('the probe uses the same URL shape', async () => {
    config.patchResearchSearxngCategories = ['it', 'general'];
    await start(ok);
    await probeSearxng(baseUrl, 1000);
    expect(requests[0].url).toContain('categories=it%2Cgeneral');
    expect(requests[0].url).toContain('format=json');
  });
});
