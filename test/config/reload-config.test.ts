import fs from 'fs';
import os from 'os';
import path from 'path';
import { randomUUID } from 'crypto';
import { pathToFileURL } from 'url';
import { afterEach, describe, expect, it } from '@jest/globals';

const originalRootDir = process.env.LOCALLAMA_ROOT_DIR;
const originalOpenRouterFreeOnly = process.env.OPENROUTER_FREE_ONLY;
const originalTokenThreshold = process.env.TOKEN_THRESHOLD;
const originalQualityThreshold = process.env.QUALITY_THRESHOLD;
const originalLmStudioEndpoint = process.env.LM_STUDIO_ENDPOINT;

function importFreshConfigModule(cacheKey: string) {
  const modulePath = path.resolve(process.cwd(), 'dist/config/index.js');
  const moduleUrl = new URL(`${pathToFileURL(modulePath).href}?${cacheKey}`);
  return import(moduleUrl.href);
}

afterEach(() => {
  if (originalRootDir === undefined) {
    delete process.env.LOCALLAMA_ROOT_DIR;
  } else {
    process.env.LOCALLAMA_ROOT_DIR = originalRootDir;
  }

  if (originalOpenRouterFreeOnly === undefined) {
    delete process.env.OPENROUTER_FREE_ONLY;
  } else {
    process.env.OPENROUTER_FREE_ONLY = originalOpenRouterFreeOnly;
  }

  if (originalTokenThreshold === undefined) {
    delete process.env.TOKEN_THRESHOLD;
  } else {
    process.env.TOKEN_THRESHOLD = originalTokenThreshold;
  }

  if (originalQualityThreshold === undefined) {
    delete process.env.QUALITY_THRESHOLD;
  } else {
    process.env.QUALITY_THRESHOLD = originalQualityThreshold;
  }

  if (originalLmStudioEndpoint === undefined) {
    delete process.env.LM_STUDIO_ENDPOINT;
  } else {
    process.env.LM_STUDIO_ENDPOINT = originalLmStudioEndpoint;
  }
});

describe('reloadConfig', () => {
  it('applies valid hot-reloadable values from .env at runtime', async () => {
    const tempRootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'locallama-reload-valid-'));

    process.env.LOCALLAMA_ROOT_DIR = tempRootDir;
    process.env.OPENROUTER_FREE_ONLY = 'true';
    process.env.TOKEN_THRESHOLD = '1000';

    fs.writeFileSync(
      path.join(tempRootDir, '.env'),
      ['OPENROUTER_FREE_ONLY=false', 'TOKEN_THRESHOLD=2222'].join('\n'),
      'utf8'
    );

    try {
      const configModule = await importFreshConfigModule(`reload-valid=${randomUUID()}`);

      expect(configModule.config.openRouterFreeOnly).toBe(true);
      expect(configModule.config.tokenThreshold).toBe(1000);

      const result = configModule.reloadConfig();

      expect(result.success).toBe(true);
      expect(result.activeConfig.openRouterFreeOnly).toBe(false);
      expect(result.activeConfig.tokenThreshold).toBe(2222);
      expect(configModule.config.openRouterFreeOnly).toBe(false);
      expect(configModule.config.tokenThreshold).toBe(2222);
    } finally {
      fs.rmSync(tempRootDir, { recursive: true, force: true });
    }
  });

  it('rejects invalid config reload and keeps previous runtime values', async () => {
    const tempRootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'locallama-reload-invalid-'));

    process.env.LOCALLAMA_ROOT_DIR = tempRootDir;
    process.env.LM_STUDIO_ENDPOINT = 'http://localhost:1234/v1';

    fs.writeFileSync(path.join(tempRootDir, '.env'), 'LM_STUDIO_ENDPOINT=http://localhost:1234/v1\n', 'utf8');

    try {
      const configModule = await importFreshConfigModule(`reload-invalid=${randomUUID()}`);
      const previousEndpoint = configModule.config.lmStudioEndpoint;

      process.env.LM_STUDIO_ENDPOINT = 'not-a-url';

      expect(() => configModule.reloadConfig()).toThrow(/Configuration validation failed/);
      expect(configModule.config.lmStudioEndpoint).toBe(previousEndpoint);
    } finally {
      fs.rmSync(tempRootDir, { recursive: true, force: true });
    }
  });
});
