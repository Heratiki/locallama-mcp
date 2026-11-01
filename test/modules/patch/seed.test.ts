import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const root = process.cwd();
const seed = resolve(root, 'test/fixtures/patch-seed');

test('the fixed seed has ten well-formed requests with external hidden acceptance tests', () => {
  const requests = JSON.parse(readFileSync(resolve(seed, 'requests.json'), 'utf8'));
  expect(requests).toHaveLength(10);
  expect(new Set(requests.map((r: { id: string }) => r.id)).size).toBe(10);
  expect(new Set(requests.map((r: { repo: string }) => r.repo))).toEqual(new Set(['ts', 'py']));
  for (const request of requests) {
    expect(request.id).toMatch(/^[a-z0-9-]+$/);
    expect(request.goal.trim().length).toBeGreaterThan(20);
    expect(['ts', 'py']).toContain(request.repo);
    expect(request.file_hints.length).toBeGreaterThan(0);
    for (const hint of request.file_hints) {
      expect(hint).not.toMatch(/(^\/|\.\.)/);
      expect(existsSync(resolve(seed, `${request.repo}-repo`, hint))).toBe(true);
    }
    expect(request.hidden_test).toMatch(/^hidden\/[a-z0-9-]+\.(mjs|py)$/);
    expect(existsSync(resolve(seed, request.hidden_test))).toBe(true);
    expect(request.checks.length).toBeGreaterThan(0);
    for (const check of request.checks) {
      expect(check.name).toBeTruthy();
      expect(check.argv.length).toBeGreaterThan(0);
      expect(check.argv.every((arg: unknown) => typeof arg === 'string')).toBe(true);
    }
  }
});

test('dry-run checks both baseline fixtures and proves all hidden tests reject the baseline without a server', () => {
  const result = spawnSync(process.execPath, [resolve(root, 'scripts/patch-seed/run.mjs'), '--dry-run'], {
    cwd: root, encoding: 'utf8', timeout: 60_000,
  });
  expect({ status: result.status, stderr: result.stderr }).toEqual({ status: 0, stderr: expect.any(String) });
  const summary = JSON.parse(result.stdout);
  expect(summary).toMatchObject({ mode: 'dry-run', requests: 10, baseline_repos_passed: 2, hidden_tests_failed: 10, server_started: false });
}, 65_000);
