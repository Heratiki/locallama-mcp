/**
 * Section 9 — Lightweight-hardware profile tests.
 *
 * IMPORTANT: This file sets LOCALLAMA_PROFILE=lightweight at the top so that
 * the module-level constants in dist/modules/decision-engine/types/index.js
 * pick up the lightweight values when they are first imported.  All imports
 * of the modules under test are deferred to beforeAll() so this env assignment
 * happens first.
 */

import { describe, expect, it, beforeAll } from '@jest/globals';

// Set env before any module is loaded in this Jest worker.
process.env.LOCALLAMA_PROFILE = 'lightweight';

describe('LOCALLAMA_PROFILE=lightweight', () => {
  let COMPLEXITY_THRESHOLDS: { SIMPLE: number; MEDIUM: number; COMPLEX: number };
  let TOKEN_THRESHOLDS: { SMALL: number; MEDIUM: number; LARGE: number };
  let configProfile: string;

  beforeAll(async () => {
    // Dynamic imports so the modules are loaded AFTER the env var is set above.
    const types = await import('../../../dist/modules/decision-engine/types/index.js');
    COMPLEXITY_THRESHOLDS = types.COMPLEXITY_THRESHOLDS;
    TOKEN_THRESHOLDS = types.TOKEN_THRESHOLDS;

    const cfg = await import('../../../dist/config/index.js');
    configProfile = cfg.config.profile;
  });

  describe('config.profile', () => {
    it('equals "lightweight"', () => {
      expect(configProfile).toBe('lightweight');
    });
  });

  describe('COMPLEXITY_THRESHOLDS', () => {
    it('SIMPLE is 0.4 (raised from default 0.3)', () => {
      expect(COMPLEXITY_THRESHOLDS.SIMPLE).toBe(0.4);
    });

    it('MEDIUM is 0.7 (raised from default 0.6)', () => {
      expect(COMPLEXITY_THRESHOLDS.MEDIUM).toBe(0.7);
    });

    it('COMPLEX is 0.9 (raised from default 0.8)', () => {
      expect(COMPLEXITY_THRESHOLDS.COMPLEX).toBe(0.9);
    });

    it('SIMPLE < MEDIUM < COMPLEX (monotonically increasing)', () => {
      expect(COMPLEXITY_THRESHOLDS.SIMPLE).toBeLessThan(COMPLEXITY_THRESHOLDS.MEDIUM);
      expect(COMPLEXITY_THRESHOLDS.MEDIUM).toBeLessThan(COMPLEXITY_THRESHOLDS.COMPLEX);
    });

    it('COMPLEX is below 1.0 (valid normalised score range)', () => {
      expect(COMPLEXITY_THRESHOLDS.COMPLEX).toBeLessThan(1.0);
    });
  });

  describe('TOKEN_THRESHOLDS', () => {
    it('SMALL is unchanged at 500', () => {
      expect(TOKEN_THRESHOLDS.SMALL).toBe(500);
    });

    it('MEDIUM is unchanged at 2000', () => {
      expect(TOKEN_THRESHOLDS.MEDIUM).toBe(2000);
    });

    it('LARGE is lowered to 4096 to match small-model context windows', () => {
      expect(TOKEN_THRESHOLDS.LARGE).toBe(4096);
    });

    it('SMALL < MEDIUM < LARGE (monotonically increasing)', () => {
      expect(TOKEN_THRESHOLDS.SMALL).toBeLessThan(TOKEN_THRESHOLDS.MEDIUM);
      expect(TOKEN_THRESHOLDS.MEDIUM).toBeLessThan(TOKEN_THRESHOLDS.LARGE);
    });
  });

  describe('routing intent', () => {
    // These tests verify the structural intent of the lightweight profile:
    // tasks that would be "medium" complexity in default mode remain in the
    // local tier, and only genuinely very complex tasks cross the paid threshold.

    it('a complexity score of 0.65 is below MEDIUM (stays local in lightweight mode)', () => {
      // In default mode 0.65 >= MEDIUM(0.6) so it would get a paid boost.
      // In lightweight mode 0.65 < MEDIUM(0.7) so it stays in the local tier.
      expect(0.65).toBeLessThan(COMPLEXITY_THRESHOLDS.MEDIUM);
    });

    it('a complexity score of 0.85 is below COMPLEX (avoids paid escalation in lightweight mode)', () => {
      // In default mode 0.85 >= COMPLEX(0.8) so it would always route to paid.
      // In lightweight mode 0.85 < COMPLEX(0.9) so it only gets a moderate penalty.
      expect(0.85).toBeLessThan(COMPLEXITY_THRESHOLDS.COMPLEX);
    });

    it('a task with 5000 tokens exceeds LARGE in lightweight mode', () => {
      // In lightweight mode LARGE=4096, so 5000 tokens triggers the paid-token boost.
      // This is correct: a 1.5B q4_K_M model cannot fit 5000 tokens in context.
      expect(5000).toBeGreaterThanOrEqual(TOKEN_THRESHOLDS.LARGE);
    });

    it('a task with 3000 tokens is below LARGE in lightweight mode', () => {
      // 3000 tokens comfortably fits in a 4096-token context window.
      expect(3000).toBeLessThan(TOKEN_THRESHOLDS.LARGE);
    });
  });
});
