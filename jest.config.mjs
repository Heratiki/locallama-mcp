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
  // Restrict discovery to test/ only. This replaces the previous
  // testPathIgnorePatterns: ['/node_modules/', '/.claude/'] which inadvertently
  // excluded test runs inside git worktrees under .claude/worktrees/.
  // To revert: remove `roots` and restore testPathIgnorePatterns to
  //   ['/node_modules/', '/.claude/']
  roots: ['<rootDir>/test'],
  testPathIgnorePatterns: ['/node_modules/'],
  injectGlobals: true,
  moduleDirectories: ['node_modules', 'dist']
}