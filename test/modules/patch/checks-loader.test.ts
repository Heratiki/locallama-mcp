import { afterEach, beforeEach, describe, expect, it } from '@jest/globals';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { loadChecksConfig, resolveChecks } from '../../../dist/modules/patch/checks/index.js';

describe('snapshot check resolution', () => {
  let snapshot: string;

  beforeEach(async () => {
    snapshot = await mkdtemp(path.join(tmpdir(), 'patch-checks-'));
  });

  afterEach(async () => {
    await rm(snapshot, { recursive: true, force: true });
  });

  async function defaults(value: unknown) {
    await mkdir(path.join(snapshot, '.locallama'), { recursive: true });
    await writeFile(path.join(snapshot, '.locallama', 'checks.json'), JSON.stringify(value));
  }

  it('refuses submit with no_checks when neither source declares a check', async () => {
    await expect(resolveChecks(snapshot)).resolves.toEqual({ ok: false, reason: 'no_checks' });
  });

  it('loads snapshot checks, dependency links, and the environment allow list', async () => {
    const config = {
      checks: [{ name: 'unit', argv: ['node', '-e', 'process.exit(0)'], append_changed_files: true }],
      links: ['node_modules'], env_allow: ['NODE_OPTIONS'],
    };
    await defaults(config);
    await expect(loadChecksConfig(snapshot)).resolves.toEqual(config);
    await expect(resolveChecks(snapshot)).resolves.toEqual({ ok: true, config });
  });

  it('request checks win while snapshot links and env_allow remain available', async () => {
    await defaults({ checks: [{ name: 'file', argv: ['false'] }], links: [], env_allow: ['NODE_OPTIONS'] });
    const checks = [{ name: 'request', argv: ['true'] }];
    await expect(resolveChecks(snapshot, checks)).resolves.toEqual({
      ok: true, config: { checks, links: [], env_allow: ['NODE_OPTIONS'] },
    });
  });

  it('accepts request checks without a config file', async () => {
    const checks = [{ name: 'request', argv: ['true'] }];
    await expect(resolveChecks(snapshot, checks)).resolves.toEqual({ ok: true, config: { checks } });
  });

  it('an explicit empty request list overrides nonempty file checks', async () => {
    await defaults({ checks: [{ name: 'file', argv: ['true'] }] });
    await expect(resolveChecks(snapshot, [])).resolves.toEqual({ ok: false, reason: 'no_checks' });
  });

  it('empty file checks refuse submit with no_checks', async () => {
    await defaults({ checks: [] });
    await expect(resolveChecks(snapshot)).resolves.toEqual({ ok: false, reason: 'no_checks' });
  });

  it.each([
    null,
    { checks: 'node test.js' },
    { checks: [{ name: 'shell', argv: 'node test.js' }] },
    { checks: [{ name: 'empty', argv: [] }] },
    { checks: [{ name: '', argv: ['node'] }] },
    { checks: [{ name: 'timeout', argv: ['node'], timeout_ms: -1 }] },
    { checks: [{ name: 'append', argv: ['node'], append_changed_files: 'yes' }] },
    { checks: [], links: [7] },
    { checks: [], env_allow: 'ALL' },
  ])('rejects invalid config rather than silently treating it as absent: %j', async value => {
    await defaults(value);
    await expect(loadChecksConfig(snapshot)).rejects.toThrow(/checks\.json/);
  });

  it('reports malformed JSON', async () => {
    await mkdir(path.join(snapshot, '.locallama'));
    await writeFile(path.join(snapshot, '.locallama', 'checks.json'), '{');
    await expect(loadChecksConfig(snapshot)).rejects.toThrow(/checks\.json/);
  });
});
