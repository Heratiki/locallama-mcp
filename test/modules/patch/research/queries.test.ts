import { afterEach, beforeEach, describe, expect, it } from '@jest/globals';
import { buildQueries } from '../../../../dist/modules/patch/research/queries.js';
import { redactText } from '../../../../dist/modules/patch/research/redact.js';

// These unit tests define their own environment literals. Desktop SESSION values
// can otherwise collide with ordinary fixture identifiers such as "user".
let savedEnv: NodeJS.ProcessEnv;
beforeEach(() => { savedEnv = process.env; process.env = {}; });
afterEach(() => { process.env = savedEnv; });

const TSC_ERROR = `src/modules/app.ts(10,5): error TS2339: Property 'loadConfig' does not exist on type 'App'.`;
const PYTHON_TRACEBACK = [
  'Traceback (most recent call last):',
  '  File "main.py", line 10, in <module>',
  "    import requests",
  "ModuleNotFoundError: No module named 'requests'",
].join('\n');
const GO_ERROR = `main.go:5:2: cannot find package "github.com/gin-gonic/gin" in any of:\n\t/usr/lib/go/src/github.com (from $GOROOT)`;

describe('buildQueries (#155 criterion 3)', () => {
  it('extracts the error code and quoted identifiers from a tsc error', () => {
    const queries = buildQueries(TSC_ERROR, ['src/modules/app.ts'], { privateTerms: ['myrepo'] });
    const texts = queries.map(q => q.text);
    expect(texts).toContain('TS2339');
    expect(texts).toContain('loadConfig');
    expect(texts).toContain('App');
    const code = queries.find(q => q.text === 'TS2339')!;
    expect(code.kind).toBe('code');
  });

  it('extracts the missing module from a Python traceback', () => {
    const queries = buildQueries(PYTHON_TRACEBACK, ['main.py']);
    const module = queries.find(q => q.kind === 'module');
    expect(module?.text).toBe('requests');
  });

  it('extracts the package path from a Go build error', () => {
    const queries = buildQueries(GO_ERROR, ['main.go']);
    const module = queries.find(q => q.kind === 'module');
    expect(module?.text).toBe('github.com/gin-gonic/gin');
  });

  it('derives a dotted module query from touched python files', () => {
    const queries = buildQueries(PYTHON_TRACEBACK, ['myapp/models/user.py']);
    expect(queries.map(q => q.text)).toContain('myapp.models.user');
  });

  it('is deterministic and capped', () => {
    const once = buildQueries(TSC_ERROR, ['a.ts', 'b.ts'], { max: 3 });
    const twice = buildQueries(TSC_ERROR, ['a.ts', 'b.ts'], { max: 3 });
    expect(once).toEqual(twice);
    expect(once).toHaveLength(3);
  });
});

describe('redactText (#155 criterion 4)', () => {
  it('strips absolute POSIX and Windows paths', () => {
    const out = redactText('failed at /home/heratiki/work/app.ts and C:\\Users\\bob\\app.ts end', {});
    expect(out).not.toContain('/home/heratiki');
    expect(out).not.toContain('C:\\Users');
    expect(out).not.toContain('app.ts');
    expect(out).toContain('<path>');
  });

  it('keeps relative paths and URL-like package paths', () => {
    const out = redactText('src/a.ts: cannot find package "github.com/x/y"', {});
    expect(out).toContain('src/a.ts');
    expect(out).toContain('github.com/x/y');
  });

  it('strips repo-private names passed as private terms', () => {
    const out = redactText('error in myrepo module myrepo', { privateTerms: ['myrepo'] });
    expect(out).not.toContain('myrepo');
    expect(out).toContain('<private>');
  });

  it('strips secret-looking values', () => {
    const secrets = [
      'sk-abcdef1234567890abcdef1234567890',
      'ghp_abcdefghijklmnopqrstuvwxyz123456',
      'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9',
      'API_KEY=supersecretvalue123',
      'deadbeefdeadbeefdeadbeefdeadbeefdeadbeef',
      'YWJjZGVmZ2hpamtsbW5vcHFyc3R1dnd4eXoxMjM0NTY3OA==',
    ];
    for (const secret of secrets) {
      const out = redactText(`boom ${secret} end`, {});
      expect(out).not.toContain(secret);
    }
  });

  it('keeps ordinary error codes and identifiers', () => {
    const out = redactText("error TS2339: Property 'foo' does not exist on type 'Bar'.", {});
    expect(out).toContain('TS2339');
    expect(out).toContain("'foo'");
  });
});

it('B3 redacts literal environment values and quoted credential assignments', () => {
  const previous = { ...process.env };
  Object.assign(process.env, {
    FIX_API_TOKEN: 'shortSecret', FIX_SESSION: 'session words',
    FIX_ORDINARY: 'long value with punctuation!', FIX_SHORT: 'public',
  });
  try {
    const secrets = ['shortSecret', 'session words', 'long value with punctuation!', 'two secret words', 'quoted cookie value'];
    const out = redactText(`boom ${secrets.slice(0, 3).join('; ')} password="two secret words" COOKIE='quoted cookie value' public TS2339`);
    for (const secret of secrets) expect(out).not.toContain(secret);
    expect(out).toContain('public');
    expect(out).toContain('TS2339');
  } finally {
    for (const name of ['FIX_API_TOKEN', 'FIX_SESSION', 'FIX_ORDINARY', 'FIX_SHORT']) {
      if (previous[name] === undefined) delete process.env[name]; else process.env[name] = previous[name];
    }
  }
});

it('B4 redacts filenames before deriving module and identifier queries', () => {
  const files = ['internalrepo/client.py', '/home/alice/private.py', 'sk-abcdefgh12345678.ts', 'internalrepo.ts'];
  const sent = JSON.stringify(buildQueries('', files, { privateTerms: ['internalrepo'], max: 20 }));
  for (const secret of ['internalrepo', 'alice', 'private.py', 'sk-abcdefgh12345678']) expect(sent).not.toContain(secret);
  expect(sent).not.toContain('/home');
});

it('round 2 #3 redacts credential values from three characters while preserving ordinary short values', () => {
  const names = ['MY_TOKEN', 'FIX_COOKIE', 'FIX_AUTH', 'FIX_PUBLIC'];
  const previous = names.map(name => process.env[name]);
  Object.assign(process.env, { MY_TOKEN: 'abcde', FIX_COOKIE: 'xyz', FIX_AUTH: 'ab', FIX_PUBLIC: 'public' });
  try {
    const sent = JSON.stringify(buildQueries("No module named 'abcde' xyz ab public", []));
    expect(sent).not.toContain('abcde');
    expect(sent).not.toContain('xyz');
    expect(redactText('abcde xyz ab public')).toBe('<redacted> <redacted> ab public');
  } finally {
    names.forEach((name, i) => { if (previous[i] === undefined) delete process.env[name]; else process.env[name] = previous[i]; });
  }
});
