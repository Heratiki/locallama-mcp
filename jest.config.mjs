// @ts-check
/** @type {import('jest').Config} */
export default {
  testEnvironment: 'node',
  moduleFileExtensions: ['ts', 'tsx', 'js', 'json', 'node'],
  collectCoverageFrom: [
    'dist/**/*.js',
    '!dist/index.js',
    '!dist/utils/lock-file.js'
  ],
  injectGlobals: true,
  setupFilesAfterEnv: ['<rootDir>/test/setup-jest.ts'],
  moduleDirectories: ['node_modules', 'dist']
}