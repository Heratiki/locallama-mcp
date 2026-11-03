import { afterAll, beforeEach, describe, expect, it, jest } from '@jest/globals';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Config } from '../../src/config/index.js';

const keys = ['PATCH_RESEARCH_SEARXNG_CATEGORIES', 'LOCALLAMA_ROOT_DIR'];
const saved = Object.fromEntries(keys.map(key => [key, process.env[key]]));
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'patch-research-cats-'));

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
  return (await import(path.resolve('src/config/index.ts'))).config;
}

describe('PATCH_RESEARCH_SEARXNG_CATEGORIES (#161)', () => {
  it('defaults to it,general', async () => {
    expect((await loadConfig()).patchResearchSearxngCategories).toEqual(['it', 'general']);
  });

  it('an empty value means no categories', async () => {
    process.env.PATCH_RESEARCH_SEARXNG_CATEGORIES = '';
    expect((await loadConfig()).patchResearchSearxngCategories).toEqual([]);
  });

  it('trims, drops empty and invalid items, and warns once', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    process.env.PATCH_RESEARCH_SEARXNG_CATEGORIES = ' it , ,general,Bad!,sci_ence,a&b,files-x ';
    expect((await loadConfig()).patchResearchSearxngCategories).toEqual(['it', 'general', 'sci_ence', 'files-x']);
    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });
});
