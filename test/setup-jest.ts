// This file sets up Jest globals for ESM-based tests
import { jest } from '@jest/globals';

// Make Jest available globally
globalThis.jest = jest;
globalThis.expect = expect;
globalThis.describe = describe;
globalThis.it = it;
globalThis.beforeEach = beforeEach;
globalThis.afterEach = afterEach;
globalThis.beforeAll = beforeAll;
globalThis.afterAll = afterAll;