import js from '@eslint/js';
import stylistic from '@stylistic/eslint-plugin';
import { importX } from 'eslint-plugin-import-x';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  // Build outputs, the fixture apps' own trees, and the type-check subjects,
  // which are deliberately broken TypeScript; node_modules is ignored by
  // default.
  { ignores: ['**/dist/', '**/build/', '**/.svelte-kit/', 'tests/fixtures/**/node_modules/', 'tests/fixtures/typing/'] },
  js.configs.recommended,
  tseslint.configs.recommendedTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      // An app's i18n config is consumer code evaluated at build time: its
      // loaders, their payloads and the parser's params are all `any` to this
      // package, and the unsafe-* family would only restate that on every line
      // they flow through. Async correctness rules (no-floating-promises,
      // no-misused-promises, require-await) stay on — this package awaits a
      // module runner and a filesystem.
      '@typescript-eslint/no-unused-vars': ['error', { ignoreRestSiblings: true }],
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unsafe-argument': 'off',
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-call': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unsafe-return': 'off',
    },
  },
  {
    plugins: { 'import-x': importX },
    rules: {
      // `vite` is a peer the host app already has; everything else reachable
      // from src/ must be a real dependency or a node: builtin. The fixture
      // apps carry a `package.json` of their own, so the manifest to check
      // against has to be named — otherwise the nearest one wins and every
      // fixture import reads as undeclared.
      'import-x/no-extraneous-dependencies': ['error', {
        packageDir: import.meta.dirname,
        devDependencies: [
          '**/*.config.ts',
          '**/*.config.js',
          'tests/**',
        ],
      }],
    },
  },
  {
    // The formatting contract shared across the sveltekit-i18n repos.
    plugins: { '@stylistic': stylistic },
    rules: {
      '@stylistic/comma-dangle': ['error', 'always-multiline'],
      '@stylistic/eol-last': 'error',
      '@stylistic/indent': ['error', 2],
      '@stylistic/no-multiple-empty-lines': ['error', { max: 1 }],
      '@stylistic/no-trailing-spaces': 'error',
      '@stylistic/object-curly-spacing': ['error', 'always'],
      '@stylistic/quotes': ['error', 'single', { avoidEscape: true }],
      '@stylistic/semi': ['error', 'always'],
    },
  },
  {
    // The public type surface is namespace-shaped, as the rest of the family
    // spells its types.
    files: ['src/types.ts'],
    rules: {
      '@typescript-eslint/no-namespace': 'off',
    },
  },
  {
    // Fixture loaders are async by base's Loader contract with nothing to
    // await, and a fixture deliberately throws to exercise a diagnostic.
    files: ['tests/**'],
    rules: {
      '@typescript-eslint/require-await': 'off',
      '@typescript-eslint/only-throw-error': 'off',
    },
  },
  {
    // Plain JS (this config, the tsup config, the fixture apps' Vite and
    // Svelte configs) sits outside tsconfig's program (no allowJs) — lint it
    // untyped, with node globals so no-undef doesn't fire on process/console.
    files: ['**/*.js', '**/*.mjs', '**/*.cjs'],
    extends: [tseslint.configs.disableTypeChecked],
    languageOptions: {
      globals: globals.node,
    },
  },
);
