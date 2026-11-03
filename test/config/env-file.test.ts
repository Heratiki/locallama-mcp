import fs from 'fs';
import os from 'os';
import path from 'path';
import { execFileSync } from 'child_process';
import { pathToFileURL } from 'url';
import { describe, expect, it } from '@jest/globals';

const saved = process.env.LOCALLAMA_ENV_FILE;
const distConfigHref = pathToFileURL(path.resolve(process.cwd(), 'dist/config/index.js')).href;

/**
 * Load dist config in a fresh node process (jest does not re-evaluate a
 * module imported twice), rewrite the file, call reloadConfig(), and report
 * TOKEN_THRESHOLD as seen at startup and after the reload.
 */
function runChild(
  root: string,
  envFile: string | undefined,
  rewrite: { file: string; content: string },
): { startup: number; reloaded: number; envPath: string } {
  const childEnv: NodeJS.ProcessEnv = { ...process.env, LOCALLAMA_ROOT_DIR: root };
  delete childEnv.TOKEN_THRESHOLD;
  if (envFile === undefined) delete childEnv.LOCALLAMA_ENV_FILE;
  else childEnv.LOCALLAMA_ENV_FILE = envFile;
  const script = [
    `import('${distConfigHref}').then(async (m) => {`,
    'const fs = await import("fs");',
    'const startup = m.config.tokenThreshold;',
    `fs.writeFileSync(${JSON.stringify(rewrite.file)}, ${JSON.stringify(rewrite.content)});`,
    'const r = m.reloadConfig();',
    'console.log("RESULT" + JSON.stringify({ startup, reloaded: m.config.tokenThreshold, envPath: r.envPath }));',
    '});',
  ].join('');
  const out = execFileSync(process.execPath, ['--input-type=module', '-e', script], {
    cwd: root,
    env: childEnv,
    encoding: 'utf8',
  });
  const line = out.split(/\r?\n/).find((l) => l.startsWith('RESULT'));
  return JSON.parse((line as string).slice('RESULT'.length));
}

function makeRoot(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'locallama-envfile-'));
  fs.writeFileSync(path.join(root, '.env'), 'TOKEN_THRESHOLD=7001\n', 'utf8');
  return root;
}

describe('LOCALLAMA_ENV_FILE', () => {
  it('jest setup sets it to none', () => {
    expect(saved).toBe('none');
  });

  it('none: config and reloadConfig() read no file', () => {
    const root = makeRoot();
    try {
      const r = runChild(root, 'none', {
        file: path.join(root, '.env'),
        content: 'TOKEN_THRESHOLD=7002\n',
      });
      expect(r.startup).toBe(1000);
      expect(r.reloaded).toBe(1000);
      expect(r.envPath).toBe('none');
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('temp file path: config and reloadConfig() read that file, not rootDir/.env', () => {
    const root = makeRoot();
    const other = fs.mkdtempSync(path.join(os.tmpdir(), 'locallama-envfile-other-'));
    const file = path.join(other, 'custom.env');
    fs.writeFileSync(file, 'TOKEN_THRESHOLD=7002\n', 'utf8');
    try {
      const r = runChild(root, file, { file, content: 'TOKEN_THRESHOLD=7003\n' });
      expect(r.startup).toBe(7002);
      expect(r.reloaded).toBe(7003);
      expect(r.envPath).toBe(file);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
      fs.rmSync(other, { recursive: true, force: true });
    }
  });

  it('unset: default path is <rootDir>/.env', () => {
    const root = makeRoot();
    const envFile = path.join(root, '.env');
    try {
      const r = runChild(root, undefined, { file: envFile, content: 'TOKEN_THRESHOLD=7004\n' });
      expect(r.startup).toBe(7001);
      expect(r.reloaded).toBe(7004);
      expect(r.envPath).toBe(envFile);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});
