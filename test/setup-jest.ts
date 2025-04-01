// This file sets up Jest globals for ESM-based tests
import { jest, expect, describe, it, beforeEach, afterEach, beforeAll, afterAll } from '@jest/globals';

// Declare types for the global object
declare global {
  // Explicitly add properties to the globalThis interface
  interface globalThis {
    jest: typeof jest;
    expect: typeof expect;
    describe: typeof describe;
    it: typeof it;
    beforeEach: typeof beforeEach;
    afterEach: typeof afterEach;
    beforeAll: typeof beforeAll;
    afterAll: typeof afterAll;
  }
}

// Make Jest available globally
(globalThis as any).jest = jest;
(globalThis as any).expect = expect;
(globalThis as any).describe = describe;
(globalThis as any).it = it;
(globalThis as any).beforeEach = beforeEach;
(globalThis as any).afterEach = afterEach;
(globalThis as any).beforeAll = beforeAll;
(globalThis as any).afterAll = afterAll;

export {};