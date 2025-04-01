import tseslint from 'typescript-eslint';
import js from '@eslint/js';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export default [
  // Include the ESLint recommended rules
  js.configs.recommended,

  // Include the TypeScript ESLint recommended configs
  ...tseslint.configs.recommendedTypeChecked,

  // Custom configurations for ALL .ts files (including src and test initially)
  {
    files: ['**/*.ts'],
    languageOptions: {
      ecmaVersion: 2020,
      sourceType: 'module',
      parser: tseslint.parser,
      parserOptions: {
        // Point to the main tsconfig for general type checking
        project: './tsconfig.json', 
        // Use __dirname for consistent resolution
        tsconfigRootDir: __dirname, 
      },
      globals: {
        node: true,
        jest: true,
      },
    },
    plugins: {
      '@typescript-eslint': tseslint.plugin,
    },
    rules: {
      // General rules for all TS files
      '@typescript-eslint/explicit-function-return-type': 'off',
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
      'no-console': 'warn',
      'prefer-const': 'warn',
      'eqeqeq': ['warn', 'always'],
      '@typescript-eslint/no-floating-promises': 'warn',
      '@typescript-eslint/await-thenable': 'warn',
      '@typescript-eslint/no-misused-promises': 'warn'
      // Keep stricter rules like no-unsafe-* enabled by default from recommendedTypeChecked
    },
  },

  // Override configurations specifically for TEST files
  {
    files: ['test/**/*.ts'],
    languageOptions: {
      parserOptions: {
        project: './tsconfig.test.json',
        tsconfigRootDir: __dirname
      },
      // Add Jest globals explicitly
      globals: {
        jest: true,
        describe: true,
        it: true,
        expect: true,
        beforeEach: true,
        afterEach: true,
        beforeAll: true,
        afterAll: true,
      },
    },
    rules: {
      // Relax or disable rules specifically for tests
      '@typescript-eslint/no-explicit-any': 'off', // Allow 'any' in tests for mocking
      '@typescript-eslint/no-unsafe-assignment': 'off', // Allow unsafe assignments
      '@typescript-eslint/no-unsafe-call': 'off', // Allow unsafe function calls
      '@typescript-eslint/no-unsafe-member-access': 'off', // Allow unsafe member access
      '@typescript-eslint/no-unsafe-argument': 'off', // Allow unsafe arguments
      '@typescript-eslint/no-unsafe-return': 'off', // Allow unsafe returns
      '@typescript-eslint/unbound-method': 'off', // Allow unbound methods (common with mocks)
    },
  }
];