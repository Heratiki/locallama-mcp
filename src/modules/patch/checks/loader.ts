import { readFile } from 'node:fs/promises';
import path from 'node:path';
import type { ChecksConfig, CheckSpec } from '../types.js';
import { validateChecks, validateStrings } from './validation.js';

export type ChecksResolution =
  | { ok: true; config: ChecksConfig }
  | { ok: false; reason: 'no_checks' };

/** Read defaults from the immutable snapshot, never the live source repository. */
export async function loadChecksConfig(snapshotPath: string): Promise<ChecksConfig | undefined> {
  const filename = path.join(snapshotPath, '.locallama', 'checks.json');
  let contents: string;
  try {
    contents = await readFile(filename, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw error;
  }
  try {
    const value = JSON.parse(contents);
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      throw new Error('expected a config object');
    }
    validateChecks(value.checks);
    if (value.links !== undefined) validateStrings(value.links, 'links');
    if (value.env_allow !== undefined) validateStrings(value.env_allow, 'env_allow');
    return {
      checks: value.checks,
      ...(value.links === undefined ? {} : { links: value.links }),
      ...(value.env_allow === undefined ? {} : { env_allow: value.env_allow }),
    };
  } catch (error) {
    throw new Error(`Invalid ${filename}: ${(error as Error).message}`);
  }
}

/** An explicitly supplied empty request list also overrides the file. */
export async function resolveChecks(
  snapshotPath: string,
  requestChecks?: CheckSpec[],
): Promise<ChecksResolution> {
  const defaults = await loadChecksConfig(snapshotPath);
  const checks = requestChecks ?? defaults?.checks ?? [];
  validateChecks(checks);
  if (checks.length === 0) return { ok: false, reason: 'no_checks' };
  return { ok: true, config: { ...defaults, checks } };
}
