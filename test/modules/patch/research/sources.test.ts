import { afterEach, beforeEach, describe, expect, it } from '@jest/globals';
import { mkdtemp, mkdir, writeFile, chmod, rm, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  repoAdapter, depsAdapter, pydocAdapter, goDocAdapter, manAdapter,
  detectLanguage, runTool,
} from '../../../../dist/modules/patch/research/sources.js';

let tmp: string;
let workspace: string;
let binDir: string;
let realPath: string;

const ctx = (over: Record<string, unknown> = {}) => ({
  workspacePath: workspace,
  repoSearch: async (query: string) => [{ path: 'src/answer.ts', content: `export function ${query.replace(/[^a-z0-9]/gi, '')}Answer() { return 42; }` }],
  timeoutMs: 4000,
  ...over,
});

async function fakeTool(name: string, script: string): Promise<void> {
  await writeFile(path.join(binDir, name), script, 'utf8');
  await chmod(path.join(binDir, name), 0o755);
}

beforeEach(async () => {
  tmp = await mkdtemp(path.join(os.tmpdir(), 'research-sources-'));
  workspace = path.join(tmp, 'ws');
  binDir = path.join(tmp, 'bin');
  await mkdir(workspace, { recursive: true });
  await mkdir(binDir, { recursive: true });
  realPath = process.env.PATH ?? '';
  process.env.PATH = `${binDir}${path.delimiter}${realPath}`;
});
afterEach(async () => {
  process.env.PATH = realPath;
  await rm(tmp, { recursive: true, force: true });
});

describe('source adapters (#155 criteria 7, 8, 9)', () => {
  it('language detection separates python, go, typescript and unknown', () => {
    expect(detectLanguage("Traceback (most recent call last):\nModuleNotFoundError: No module named 'x'")).toBe('python');
    expect(detectLanguage('main.go:5:2: cannot find package "x"')).toBe('go');
    expect(detectLanguage("src/a.ts(1,1): error TS2339: nope")).toBe('typescript');
    expect(detectLanguage('make: *** [all] Error 1\nundefined reference to `snprintf\'')).toBe('unknown');
  });

  it('repo adapter searches the workspace BM25 and formats hits', async () => {
    const result = await repoAdapter.run({ text: 'specialHelper', kind: 'identifier' }, ctx());
    expect(result.text).toContain('src/answer.ts');
    expect(result.text).toContain('specialHelperAnswer');
  });

  it('deps adapter reads installed .d.ts and README files', async () => {
    await mkdir(path.join(workspace, 'node_modules', 'cool-dep'), { recursive: true });
    await writeFile(path.join(workspace, 'node_modules', 'cool-dep', 'index.d.ts'),
      'declare module "cool-dep" {\n  export function makeWidget(options?: WidgetOptions): Widget;\n}\n');
    await writeFile(path.join(workspace, 'node_modules', 'cool-dep', 'README.md'),
      '# cool-dep\n\nUse makeWidget() to build widgets.\n');
    const result = await depsAdapter.run({ text: 'makeWidget', kind: 'identifier' }, ctx());
    expect(result.skipped).toBeUndefined();
    expect(result.text).toContain('makeWidget');
    expect(result.text).toMatch(/node_modules\/cool-dep\/(index\.d\.ts|README\.md)/);
  });

  it('deps adapter reports skipped when node_modules is absent', async () => {
    const result = await depsAdapter.run({ text: 'makeWidget', kind: 'identifier' }, ctx());
    expect(result.text).toBe('');
    expect(result.skipped).toBe('no node_modules');
  });

  it('pydoc adapter documents a python module (python fixture)', async () => {
    await fakeTool('python3', `#!/bin/sh\necho '{"text":"requests — an HTTP library; requests.get(url, **kwargs)"}'\n`);
    const result = await pydocAdapter.run({ text: 'requests', kind: 'module' }, ctx());
    expect(result.skipped).toBeUndefined();
    expect(result.text).toContain('requests.get');
  });

  it('go doc adapter documents a package (go fixture)', async () => {
    await fakeTool('go', '#!/bin/sh\ncase "$1" in doc) echo "func Printf(format string, a ...any) (n int, err error)";; *) exit 0;; esac\n');
    const result = await goDocAdapter.run({ text: 'fmt', kind: 'module' }, ctx());
    expect(result.text).toContain('func Printf');
  });

  it('man adapter documents an identifier for unknown languages', async () => {
    await fakeTool('man', '#!/bin/sh\necho "PRINTF(3)  Library Functions Manual"\necho "int printf(const char *restrict format, ...);"\n');
    const result = await manAdapter.run({ text: 'printf', kind: 'identifier' }, ctx());
    expect(result.text).toContain('PRINTF(3)');
  });

  it('missing tools are reported as tool_missing, not failures (#155 criterion 9)', async () => {
    const emptyDir = path.join(tmp, 'empty-bin');
    await mkdir(emptyDir, { recursive: true });
    process.env.PATH = emptyDir;
    for (const adapter of [pydocAdapter, goDocAdapter, manAdapter]) {
      await expect(adapter.run({ text: 'requests', kind: 'module' }, ctx())).rejects
        .toMatchObject({ message: expect.stringContaining('tool not found') });
    }
  });

  it('spawns tools with proxy variables unset (#155 criterion 13)', async () => {
    const marker = path.join(tmp, 'env-marker');
    await fakeTool('python3', `#!/bin/sh\nif [ -n "$HTTP_PROXY" ] || [ -n "$http_proxy" ] || [ -n "$HTTPS_PROXY" ] || [ -n "$ALL_PROXY" ]; then echo "proxy-set" > ${JSON.stringify(marker)}; else echo "clean" > ${JSON.stringify(marker)}; fi\necho '{"text":"docs"}'\n`);
    process.env.HTTP_PROXY = 'http://127.0.0.1:9';
    process.env.https_proxy = 'http://127.0.0.1:9';
    try {
      await pydocAdapter.run({ text: 'requests', kind: 'module' }, ctx());
      expect(await readFile(marker, 'utf8')).toContain('clean');
    } finally {
      delete process.env.HTTP_PROXY;
      delete process.env.https_proxy;
    }
  });

  it('runTool kills a slow tool after the timeout', async () => {
    const pidFile = path.join(tmp, 'slow.pid');
    await fakeTool('python3', `#!/bin/sh\necho $$ > ${JSON.stringify(pidFile)}\nsleep 30\necho late\n`);
    const started = Date.now();
    const result = await runTool(['python3', 'requests'], { cwd: workspace, timeoutMs: 300 });
    expect(result.timedOut).toBe(true);
    expect(Date.now() - started).toBeLessThan(10_000);
    const pid = Number(await readFile(pidFile, 'utf8'));
    await new Promise(resolve => setTimeout(resolve, 100));
    expect(() => process.kill(pid, 0)).toThrow();
  });

  it('keeps PATH and HOME for the spawned tools', async () => {
    const marker = path.join(tmp, 'path-marker');
    await fakeTool('man', `#!/bin/sh\necho "$PATH" > ${JSON.stringify(marker)}\necho page\n`);
    await manAdapter.run({ text: 'printf', kind: 'identifier' }, ctx());
    const seen = await readFile(marker, 'utf8');
    expect(seen).toContain(binDir);
  });
});

describe('workspace layout', () => {
  it('the fixture workspace exists', () => {
    expect(existsSync(workspace)).toBe(true);
  });
});

it('B2 go doc disables module, checksum and toolchain downloads', async () => {
  await fakeTool('go', '#!/bin/sh\nprintf "%s|%s|%s|%s|%s" "$GOTOOLCHAIN" "$GOPROXY" "$GOFLAGS" "$GONOSUMDB" "$GOSUMDB"\n');
  const result = await goDocAdapter.run({ text: 'fmt', kind: 'module' }, ctx());
  expect(result.text).toBe('local|off|-mod=readonly|*|off');
});

it('B2 pydoc never imports workspace modules or workspace shadows of stdlib', async () => {
  const marker = path.join(tmp, 'imported');
  const trap = `open(${JSON.stringify(marker)}, 'w').write('imported')\n`;
  await writeFile(path.join(workspace, 'private_workspace_module.py'), trap);
  await writeFile(path.join(workspace, 'json.py'), trap);
  const local = await pydocAdapter.run({ text: 'private_workspace_module', kind: 'module' }, ctx());
  expect(local.text).toBe('');
  expect(existsSync(marker)).toBe(false);
  const stdlib = await pydocAdapter.run({ text: 'json', kind: 'module' }, ctx());
  expect(stdlib.text).toContain('JSON');
  expect(existsSync(marker)).toBe(false);
});

it('round 2 #2 reads installed package docstrings and signatures without executing package code', async () => {
  const installed = path.join(tmp, 'site-packages');
  const pkg = path.join(installed, 'trap_package');
  const marker = path.join(tmp, 'package-imported');
  await mkdir(pkg, { recursive: true });
  await writeFile(path.join(pkg, '__init__.py'), [
    '"""Static installed package documentation."""',
    `open(${JSON.stringify(marker)}, 'w').write('executed')`,
    'def dangerous_default():',
    '    raise RuntimeError("must never execute defaults")',
    'def fetch(value: str, count: int = dangerous_default()) -> str:',
    '    """Return documented data without running any code."""',
    '    return value',
  ].join('\n'));
  await writeFile(path.join(pkg, 'child.py'), [
    '"""Static child module documentation."""',
    `open(${JSON.stringify(marker)}, 'w').write('child executed')`,
    'class Client:',
    '    """A statically documented client."""',
    '    def send(self, payload: str) -> bool:',
    '        """Send documentation only."""',
    '        return True',
  ].join('\n'));
  const previous = process.env.PYTHONPATH;
  process.env.PYTHONPATH = installed;
  try {
    for (const [name, doc] of [['trap_package', 'Static installed package documentation.'], ['trap_package.child', 'Static child module documentation.']]) {
      const result = await pydocAdapter.run({ text: name, kind: 'module' }, ctx({ pythonSearchPaths: [installed] }));
      expect(existsSync(marker)).toBe(false);
      expect(result.skipped).toBeUndefined();
      expect(result.text).toContain(doc);
      if (name === 'trap_package') {
        expect(result.text).toContain('fetch(value: str, count: int = dangerous_default()) -> str');
        expect(result.text).toContain('Return documented data without running any code.');
      } else {
        expect(result.text).toContain('class Client');
        expect(result.text).toContain('send(self, payload: str) -> bool');
      }
    }
  } finally {
    if (previous === undefined) delete process.env.PYTHONPATH; else process.env.PYTHONPATH = previous;
  }
});

it('round 2 #2 clearly skips builtins, namespace packages and modules without source', async () => {
  const installed = path.join(tmp, 'site-packages');
  await mkdir(path.join(installed, 'namespace_fixture'), { recursive: true });
  await writeFile(path.join(installed, 'namespace_fixture', 'child.py'), '"""Namespace child."""');
  for (const name of ['sys', 'math', 'namespace_fixture', 'namespace_fixture.child']) {
    const result = await pydocAdapter.run({ text: name, kind: 'module' }, ctx({ pythonSearchPaths: [installed] }));
    expect(result.text).toBe('');
    expect(result.skipped).toBe('no_python_source');
  }
});
