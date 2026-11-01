import { afterAll, beforeEach, describe, expect, it, jest } from '@jest/globals';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Config } from '../../src/config/index.js';

const budgets = {
  PATCH_LOCAL_MODELS: ['patchLocalModels', 2],
  PATCH_FREE_MODELS: ['patchFreeModels', 2],
  PATCH_PAID_MODELS: ['patchPaidModels', 1],
  PATCH_ATTEMPTS_PER_MODEL: ['patchAttemptsPerModel', 3],
  PATCH_MAX_ATTEMPTS: ['patchMaxAttempts', 12],
  PATCH_TASK_TIMEOUT_MS: ['patchTaskTimeoutMs', 7200000],
  PATCH_MAX_OUTPUT_TOKENS: ['patchMaxOutputTokens', 2000],
  PATCH_CONTEXT_TOKENS: ['patchContextTokens', 6000],
  PATCH_MAX_CONCURRENT: ['patchMaxConcurrent', 1],
  PATCH_INFERENCE_TIMEOUT_MS: ['patchInferenceTimeoutMs', 900000],
  PATCH_CHECK_TIMEOUT_MS: ['patchCheckTimeoutMs', 600000],
  PATCH_ERROR_TAIL_TOKENS: ['patchErrorTailTokens', 800],
  PATCH_WHOLE_FILE_MAX_LINES: ['patchWholeFileMaxLines', 150],
  PATCH_PAID_CAP_USD: ['patchPaidCapUsd', 0.25],
} as const;
const keys = [...Object.keys(budgets), 'PATCH_TASKS_ENABLED', 'PATCH_REPO_ROOTS',
  'PATCH_KEEP_WORKSPACE_ON_FAIL', 'SCRATCH_DIR', 'LOCALLAMA_ROOT_DIR', 'OPENROUTER_FREE_ONLY'];
const saved = Object.fromEntries(keys.map(key => [key, process.env[key]]));
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'patch-config-'));

beforeEach(() => {
  jest.resetModules();
  keys.forEach(key => delete process.env[key]);
  process.env.LOCALLAMA_ROOT_DIR = root;
});
afterAll(() => {
  for (const [key, value] of Object.entries(saved)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  fs.rmSync(root, { recursive: true, force: true });
});
async function loadConfig(): Promise<Config> {
  const modulePath = path.resolve('src/config/index.ts');
  return (await import(modulePath)).config;
}

describe('patch configuration contract', () => {
  it('defaults to disabled, no allowed roots, and the hardware-floor budgets', async () => {
    const cfg = await loadConfig();
    expect(cfg.patchTasksEnabled).toBe(false);
    expect(cfg.patchRepoRoots).toEqual([]);
    expect(cfg.patchKeepWorkspaceOnFail).toBe(false);
    expect(cfg.scratchDir).toBe(path.join(cfg.rootDir, 'scratch'));
    expect(cfg.openRouterFreeOnly).toBe(true);
    for (const [field, value] of Object.values(budgets)) expect(cfg[field]).toBe(value);
  });

  it('reads explicit safety flags, path lists, scratch path and every budget', async () => {
    process.env.PATCH_TASKS_ENABLED = 'true';
    process.env.PATCH_KEEP_WORKSPACE_ON_FAIL = 'true';
    process.env.PATCH_REPO_ROOTS = ` ${root} ${path.delimiter}${path.delimiter} /tmp/second `;
    process.env.SCRATCH_DIR = 'custom-scratch';
    process.env.OPENROUTER_FREE_ONLY = 'false';
    for (const key of Object.keys(budgets)) process.env[key] = '7';
    const cfg = await loadConfig();
    expect(cfg.patchTasksEnabled).toBe(true);
    expect(cfg.patchKeepWorkspaceOnFail).toBe(true);
    expect(cfg.patchRepoRoots).toEqual([root, '/tmp/second']);
    expect(cfg.scratchDir).toBe(path.join(root, 'custom-scratch'));
    expect(cfg.openRouterFreeOnly).toBe(false);
    for (const [field] of Object.values(budgets)) expect(cfg[field]).toBe(7);
  });

  it('preserves absolute scratch paths and an explicit zero paid cap', async () => {
    process.env.SCRATCH_DIR = path.join(root, 'absolute');
    process.env.PATCH_PAID_CAP_USD = '0';
    const cfg = await loadConfig();
    expect(cfg.scratchDir).toBe(process.env.SCRATCH_DIR);
    expect(cfg.patchPaidCapUsd).toBe(0);
  });

  it('documents every new key with a one-line comment', () => {
    const example = fs.readFileSync('.env.example', 'utf8');
    for (const key of keys.filter(key => key.startsWith('PATCH_') || key === 'SCRATCH_DIR')) {
      expect(example).toMatch(new RegExp(`# [^\\n]+\\n${key}=`, 'm'));
    }
  });
});
