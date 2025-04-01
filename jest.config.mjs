// @ts-check
/** @type {import('ts-jest').JestConfigWithTsJest} */
export default {
  preset: 'ts-jest/presets/default-esm',
  testEnvironment: 'node',
  extensionsToTreatAsEsm: ['.ts'],
  moduleFileExtensions: ['ts', 'tsx', 'js', 'json', 'node'],
  moduleNameMapper: {
    '^(\\.{1,2}/.*)\\.js$': '$1.ts',
    '^(\\.{1,2}/.*)\\.ts$': '$1.ts'
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
    '/node_modules/(?!(@modelcontextprotocol/sdk|ipaddr.js)/.*)'
  ],
  injectGlobals: true,
  setupFilesAfterEnv: ['<rootDir>/test/setup-jest.ts'],
  moduleDirectories: ['node_modules', 'src']
}