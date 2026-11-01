import { afterEach, beforeEach, describe, expect, it } from '@jest/globals';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { runChecks } from '../../../dist/modules/patch/checks/index.js';
import { config } from '../../../dist/config/index.js';
import { getEncoding } from 'js-tiktoken';
import type { CheckSpec } from '../../../src/modules/patch/types.js';

const nodeCheck = (name: string, code: string): CheckSpec => ({ name, argv: [process.execPath, '-e', code] });

describe('ordered worktree checks', () => {
  let worktree: string;
  const originalTailTokens = config.patchErrorTailTokens;
  const originalTimeout = config.patchCheckTimeoutMs;
  const envNames = ['LOCALLAMA_FAKE_API_KEY', 'CHECK_ALLOWED', 'LANG', 'LC_MESSAGES', 'NODE_V8_COVERAGE'];
  let savedEnv: (string | undefined)[];

  beforeEach(async () => {
    worktree = await mkdtemp(path.join(tmpdir(), 'patch-runner-'));
    savedEnv = envNames.map(name => process.env[name]);
  });

  afterEach(async () => {
    await rm(worktree, { recursive: true, force: true });
    config.patchErrorTailTokens = originalTailTokens;
    config.patchCheckTimeoutMs = originalTimeout;
    envNames.forEach((name, index) => {
      if (savedEnv[index] === undefined) delete process.env[name];
      else process.env[name] = savedEnv[index];
    });
  });

  it('runs in order in the worktree, reports results, and stops at the first failure', async () => {
    const results = await runChecks([
      nodeCheck('pass', `setTimeout(() => { require('fs').writeFileSync('order', 'pass'); console.log('stdout'); console.error('stderr'); }, 50)`),
      nodeCheck('fail', `console.log(require('fs').readFileSync('order', 'utf8')); process.exitCode = 7;`),
      nodeCheck('never', `require('fs').writeFileSync('order', 'should not run')`),
    ], { worktree });

    expect(results).toHaveLength(2);
    expect(results[0]).toMatchObject({ name: 'pass', exit_code: 0, timed_out: false });
    expect(results[0].tail).toContain('stdout');
    expect(results[0].tail).toContain('stderr');
    expect(results[0].duration_ms).toBeGreaterThanOrEqual(0);
    expect(results[1]).toMatchObject({ name: 'fail', exit_code: 7, timed_out: false });
    expect(results[1].tail).toContain('pass');
    expect(await readFile(path.join(worktree, 'order'), 'utf8')).toBe('pass');
  });

  it('passes changed filenames as literal arguments only to opted-in checks', async () => {
    const changedFiles = ['src/a b.ts', '$(touch unwanted)', 'semi;colon.ts'];
    const check = nodeCheck('args', 'console.log(JSON.stringify(process.argv.slice(1)))');
    const argv = [...check.argv];
    const results = await runChecks([check, { ...check, name: 'related', append_changed_files: true }], {
      worktree, changedFiles,
    });
    expect(JSON.parse(results[0].tail)).toEqual([]);
    expect(JSON.parse(results[1].tail)).toEqual(changedFiles);
    expect(check.argv).toEqual(argv);
  });

  it('exposes only PATH, HOME, locale variables and explicitly allowed names', async () => {
    process.env.LOCALLAMA_FAKE_API_KEY = 'test-secret-never-inherited';
    process.env.CHECK_ALLOWED = 'explicit';
    process.env.LANG = 'C';
    process.env.LC_MESSAGES = 'C';
    process.env.NODE_V8_COVERAGE = path.join(worktree, 'coverage-must-not-propagate');
    const [result] = await runChecks([nodeCheck('env', `console.log(JSON.stringify({
      keys: Object.keys(process.env), allowed: process.env.CHECK_ALLOWED,
      hasSecret: 'LOCALLAMA_FAKE_API_KEY' in process.env,
      lang: process.env.LANG, messages: process.env.LC_MESSAGES
    }))`)], { worktree, envAllow: ['CHECK_ALLOWED'] });
    const env = JSON.parse(result.tail);
    expect(env).toMatchObject({ allowed: 'explicit', hasSecret: false, lang: 'C', messages: 'C' });
    expect(env.keys).toContain('PATH');
    expect(env.keys).toContain('HOME');
    expect(env.keys.filter((name: string) => ![
      'PATH', 'HOME', 'LANG', 'LANGUAGE', 'LC_ALL', 'LC_CTYPE', 'LC_NUMERIC', 'LC_TIME',
      'LC_COLLATE', 'LC_MONETARY', 'LC_MESSAGES', 'LC_PAPER', 'LC_NAME', 'LC_ADDRESS',
      'LC_TELEPHONE', 'LC_MEASUREMENT', 'LC_IDENTIFICATION', 'CHECK_ALLOWED',
    ].includes(name))).toEqual([]);
    const [withoutAllowList] = await runChecks([
      nodeCheck('no allow list', `console.log('CHECK_ALLOWED' in process.env)`),
    ], { worktree });
    expect(withoutAllowList.tail.trim()).toBe('false');
  });

  it('cuts the last stdout and stderr lines to PATCH_ERROR_TAIL_TOKENS', async () => {
    config.patchErrorTailTokens = 12;
    const [result] = await runChecks([nodeCheck('tail', `
      console.log('discard this old line\\n' + 'alpha '.repeat(500) + '\\nstdout final');
      console.error('stderr final');
    `)], { worktree });
    expect(getEncoding('cl100k_base').encode(result.tail).length).toBeLessThanOrEqual(12);
    expect(result.tail).toContain('stdout final');
    expect(result.tail).toContain('stderr final');
    expect(result.tail).not.toContain('discard this old line');
  });

  it('blocks Node automatic coverage env propagation outside the Jest process sandbox', () => {
    const moduleUrl = new URL('../../../dist/modules/patch/checks/index.js', import.meta.url).href;
    const harness = spawnSync(process.execPath, ['--input-type=module', '-e', `
      import { runChecks } from ${JSON.stringify(moduleUrl)};
      const [result] = await runChecks([{
        name: 'env', argv: [process.execPath, '-e', 'console.log(JSON.stringify(Object.keys(process.env)))']
      }], { worktree: ${JSON.stringify(worktree)} });
      process.stdout.write(result.tail);
    `], {
      env: { ...process.env, NODE_V8_COVERAGE: path.join(worktree, 'harness-coverage') },
      encoding: 'utf8', timeout: 5000,
    });
    expect(harness.status).toBe(0);
    expect(JSON.parse(harness.stdout)).not.toContain('NODE_V8_COVERAGE');
  });

  it('caps captured output while retaining the end of a noisy command', async () => {
    const [result] = await runChecks([nodeCheck('large', `
      process.stdout.write('x'.repeat(2 * 1024 * 1024));
      process.stdout.write('\\nstdout final\\n');
      process.stderr.write('stderr final\\n');
    `)], { worktree });
    expect(result.exit_code).toBe(0);
    expect(Buffer.byteLength(result.tail)).toBeLessThan(64 * 1024);
    expect(result.tail).toContain('stdout final');
    expect(result.tail).toContain('stderr final');
  });

  it('handles tokenizer special strings and multibyte output without exceeding the token limit', async () => {
    const [result] = await runChecks([
      nodeCheck('unicode', `console.log('<|endoftext|>' + '😀漢字'.repeat(200))`),
    ], { worktree, errorTailTokens: 7 });
    expect(getEncoding('cl100k_base').encode(result.tail, [], []).length).toBeLessThanOrEqual(7);
    expect(result.exit_code).toBe(0);
  });

  it('reports a spawn error as a failed check and does not run later checks', async () => {
    const results = await runChecks([
      { name: 'missing', argv: [path.join(worktree, 'does-not-exist')] },
      nodeCheck('never', 'process.exit(0)'),
    ], { worktree });
    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({ name: 'missing', exit_code: null, timed_out: false });
    expect(results[0].tail).toContain('ENOENT');
  });

  it('uses PATCH_CHECK_TIMEOUT_MS and stops after timeout even if SIGTERM exits zero', async () => {
    config.patchCheckTimeoutMs = 300;
    const results = await runChecks([
      nodeCheck('timeout', `process.on('SIGTERM', () => process.exit(0)); setTimeout(() => process.exit(99), 1500)`),
      nodeCheck('never', 'process.exit(0)'),
    ], { worktree });
    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({ name: 'timeout', exit_code: 0, timed_out: true });
    expect(results[0].duration_ms).toBeGreaterThanOrEqual(290);
    expect(results[0].duration_ms).toBeLessThan(1400);
  });

  it('honors the per-check timeout in preference to the configured default', async () => {
    config.patchCheckTimeoutMs = 2000;
    const [result] = await runChecks([{
      ...nodeCheck('override', 'setTimeout(() => process.exit(0), 1500)'), timeout_ms: 100,
    }], { worktree });
    expect(result).toMatchObject({ exit_code: null, timed_out: true });
    expect(result.duration_ms).toBeLessThan(1400);
  });

  it('does not start a check when already cancelled', async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(runChecks([nodeCheck('never', 'process.exit(0)')], {
      worktree, signal: controller.signal,
    })).resolves.toEqual([]);
  });

  async function waitForFile(filename: string): Promise<string> {
    const deadline = Date.now() + 3000;
    while (Date.now() < deadline) {
      try { return await readFile(path.join(worktree, filename), 'utf8'); }
      catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      }
      await new Promise(resolve => setTimeout(resolve, 20));
    }
    throw new Error(`check did not create ${filename}`);
  }

  function killGroup(pid: number) {
    try { process.kill(-pid, 'SIGKILL'); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error;
    }
  }

  it('SIGKILLs a SIGTERM-ignoring check after five seconds and waits for its group to exit', async () => {
    const running = runChecks([{
      ...nodeCheck('stubborn', `
        const fs = require('fs');
        process.on('SIGTERM', () => fs.writeFileSync('term', String(Date.now())));
        fs.writeFileSync('pid', String(process.pid));
        setTimeout(() => process.exit(99), 10000);
      `), timeout_ms: 500,
    }], { worktree });
    const pid = Number(await waitForFile('pid'));
    try {
      const [result] = await running;
      expect(result).toMatchObject({ exit_code: null, timed_out: true });
      expect(Date.now() - Number(await readFile(path.join(worktree, 'term'), 'utf8'))).toBeGreaterThanOrEqual(4950);
      expect(result.duration_ms).toBeGreaterThanOrEqual(5450);
      expect(result.duration_ms).toBeLessThan(9500);
      expect(() => process.kill(-pid, 0)).toThrow(expect.objectContaining({ code: 'ESRCH' }));
    } finally { killGroup(pid); await running; }
  }, 15000);

  it('cancel waits for a stubborn descendant even after the leader and its pipes exit', async () => {
    const controller = new AbortController();
    const descendant = `
      const fs = require('fs');
      process.on('SIGTERM', () => fs.writeFileSync('desc-term', String(Date.now())));
      fs.writeFileSync('desc-pid', String(process.pid));
      setTimeout(() => process.exit(99), 10000);
    `;
    const running = runChecks([
      nodeCheck('leader', `
        const fs = require('fs');
        process.on('SIGTERM', () => process.exit(0));
        require('child_process').spawn(process.execPath, ['-e', ${JSON.stringify(descendant)}], { stdio: 'ignore' });
        fs.writeFileSync('leader-pid', String(process.pid));
        setTimeout(() => process.exit(99), 10000);
      `),
      nodeCheck('never', 'process.exit(0)'),
    ], { worktree, signal: controller.signal });
    const pid = Number(await waitForFile('leader-pid'));
    try {
      const descendantPid = Number(await waitForFile('desc-pid'));
      controller.abort();
      const results = await running;
      expect(results).toHaveLength(1);
      expect(results[0]).toMatchObject({ exit_code: 0, timed_out: false });
      expect(Date.now() - Number(await readFile(path.join(worktree, 'desc-term'), 'utf8'))).toBeGreaterThanOrEqual(4950);
      expect(() => process.kill(-pid, 0)).toThrow(expect.objectContaining({ code: 'ESRCH' }));
      expect(() => process.kill(descendantPid, 0)).toThrow(expect.objectContaining({ code: 'ESRCH' }));
    } finally { controller.abort(); killGroup(pid); await running; }
  }, 15000);
});
