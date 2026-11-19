import js from '@eslint/js';
import { defineConfig } from 'eslint/config';
import globals from 'globals';

/**
 * Lint the authored sources, never the CI-built artifacts:
 *   - `packages/core/lib/**`, `packages/<feature>/lib/index.js` are Node ESM;
 *   - `packages/core/client/**`, `packages/<feature>/client/**` are browser ESM
 *     bundled by esbuild (shared source is imported by every feature bundle);
 *   - `packages/<feature>/lib/client.js` is the build output and is ignored.
 */
export default defineConfig([
  {
    ignores: [
      'coverage/**',
      'node_modules/**',
      'LICENSES/**',
      'packages/*/LICENSES/**',
      'packages/*/lib/client.js',
      'packages/*/lib/client.js.map',
      '*.tgz',
    ],
  },
  js.configs.recommended,
  {
    files: [
      'eslint.config.js',
      'scripts/**/*.mjs',
      'packages/core/lib/**/*.js',
      'packages/*/lib/index.js',
      'test/**/*.{js,mjs}',
    ],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: globals.nodeBuiltin,
    },
    linterOptions: { reportUnusedDisableDirectives: 'error' },
    rules: {
      'no-unused-vars': ['error', {
        argsIgnorePattern: '^_',
        caughtErrorsIgnorePattern: '^_',
        destructuredArrayIgnorePattern: '^_',
      }],
    },
  },
  {
    files: ['packages/core/client/**/*.js', 'packages/*/client/**/*.js'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: globals.browser,
    },
    linterOptions: { reportUnusedDisableDirectives: 'error' },
    rules: {
      'no-unused-vars': ['error', {
        argsIgnorePattern: '^_',
        caughtErrorsIgnorePattern: '^_',
        destructuredArrayIgnorePattern: '^_',
      }],
    },
  },
  {
    files: ['test/client-*.mjs'],
    languageOptions: {
      globals: { ...globals.nodeBuiltin, ...globals.browser },
    },
  },
]);
