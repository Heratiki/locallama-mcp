// @ts-check
/** @type {import('ts-jest').JestConfigWithTsJest} */
export default {
  preset: 'ts-jest/presets/default-esm', // Using ESM preset
  testEnvironment: 'node',
  extensionsToTreatAsEsm: ['.ts'],
  moduleFileExtensions: ['ts', 'tsx', 'js', 'jsx', 'json', 'node'],
  // Fix moduleNameMapper with explicit regexes that don't use forward slashes in the pattern
  moduleNameMapper: {
    '(.*).js$': '$1'
  },
  transform: {
    '^.+\\.tsx?$': [
      'ts-jest',
      {
        useESM: true,
        tsconfig: 'tsconfig.test.json',
      },
    ],
  },
  transformIgnorePatterns: [
    'node_modules/(?!(.*\\.mjs$|@modelcontextprotocol/sdk))'
  ],
  injectGlobals: true,
  setupFilesAfterEnv: ['<rootDir>/test/setup-jest.ts']
};