// @ts-check
/** @type {import('jest').Config} */
export default {
  testEnvironment: 'node',
  extensionsToTreatAsEsm: ['.ts'], // Add back: Treat .ts files as ESM after transform
  moduleFileExtensions: ['ts', 'tsx', 'js', 'json', 'node'],
  collectCoverageFrom: [
    'dist/**/*.js',
    '!dist/index.js',
    '!dist/utils/lock-file.js'
  ],
  // Add back transform rule for .ts/.tsx files using ts-jest
  transform: {
    '^.+\\.tsx?$': [
      'ts-jest',
      {
        tsconfig: 'tsconfig.test.json', // Use test-specific tsconfig
        useESM: true // Ensure ESM is handled correctly
      },
    ],
  },
  injectGlobals: true,
  moduleDirectories: ['node_modules', 'dist']
}