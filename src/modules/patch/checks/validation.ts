import type { CheckSpec } from '../types.js';

const strings = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every(item => typeof item === 'string' && !item.includes('\0'));

export function validateChecks(value: unknown): asserts value is CheckSpec[] {
  if (!Array.isArray(value)) throw new Error('checks must be an array');
  for (const check of value) {
    if (!check || typeof check !== 'object' ||
        typeof check.name !== 'string' || !check.name.trim() ||
        !strings(check.argv) || check.argv.length === 0 || !check.argv[0]) {
      throw new Error('each check needs a name and a nonempty argv array');
    }
    if (check.timeout_ms !== undefined) validateTimeout(check.timeout_ms);
    if (check.append_changed_files !== undefined && typeof check.append_changed_files !== 'boolean') {
      throw new Error('append_changed_files must be a boolean');
    }
  }
}

/** Node timers overflow above the signed 32-bit millisecond range. */
export function validateTimeout(value: number): void {
  if (!Number.isInteger(value) || value <= 0 || value > 2 ** 31 - 1) {
    throw new Error('timeout_ms must be a positive integer no greater than 2147483647');
  }
}

export function validateStrings(value: unknown, name: string): asserts value is string[] {
  if (!strings(value)) throw new Error(`${name} must be an array of strings`);
}
