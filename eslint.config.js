import tseslint from 'typescript-eslint';
import js from '@eslint/js';

export default [
  // Include the ESLint recommended rules
  js.configs.recommended,
  
  // Include the TypeScript ESLint recommended configs
  ...tseslint.configs.recommendedTypeChecked,
  
  // Your custom configurations
  {
    files: ['**/*.ts'],
    languageOptions: {
      ecmaVersion: 2020,
      sourceType: 'module',
      parser: tseslint.parser,
      parserOptions: {
        project: './tsconfig.json',
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
      '@typescript-eslint/explicit-function-return-type': 'off',
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
      'no-console': 'warn',
      'prefer-const': 'warn', 
      'eqeqeq': ['warn', 'always'],
      '@typescript-eslint/no-floating-promises': 'warn',
      '@typescript-eslint/await-thenable': 'warn',
      '@typescript-eslint/no-misused-promises': 'warn'
    },
  }
];