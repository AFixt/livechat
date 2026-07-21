import js from '@eslint/js';
import prettier from 'eslint-config-prettier';
import importX from 'eslint-plugin-import-x';
import jsdoc from 'eslint-plugin-jsdoc';
import n from 'eslint-plugin-n';
import noSecrets from 'eslint-plugin-no-secrets';
import promise from 'eslint-plugin-promise';
import react from 'eslint-plugin-react';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import security from 'eslint-plugin-security';
import sonarjs from 'eslint-plugin-sonarjs';
import unicorn from 'eslint-plugin-unicorn';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: [
      '**/dist/**',
      '**/build/**',
      '**/coverage/**',
      '**/node_modules/**',
      '**/*.generated.*',
      '**/e2e/generated/**',
      'reports/**',
      '**/.vite/**',
    ],
  },

  js.configs.recommended,
  ...tseslint.configs.strictTypeChecked,
  ...tseslint.configs.stylisticTypeChecked,

  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    plugins: {
      react,
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
      sonarjs,
      security,
      unicorn,
      'import-x': importX,
      promise,
      n,
      jsdoc,
      'no-secrets': noSecrets,
    },
    settings: {
      'react': { version: 'detect' },
      'import-x/resolver': { typescript: true, node: true },
    },
    rules: {
      // TypeScript
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/consistent-type-imports': [
        'error',
        { prefer: 'type-imports', fixStyle: 'inline-type-imports' },
      ],
      '@typescript-eslint/consistent-type-exports': 'error',
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-misused-promises': 'error',
      '@typescript-eslint/await-thenable': 'error',
      '@typescript-eslint/require-await': 'error',
      '@typescript-eslint/no-unnecessary-condition': 'error',
      '@typescript-eslint/switch-exhaustiveness-check': 'error',
      '@typescript-eslint/prefer-nullish-coalescing': 'error',
      '@typescript-eslint/prefer-optional-chain': 'error',
      '@typescript-eslint/no-non-null-assertion': 'error',
      '@typescript-eslint/explicit-module-boundary-types': 'error',
      '@typescript-eslint/naming-convention': [
        'error',
        {
          selector: 'default',
          format: ['camelCase'],
          leadingUnderscore: 'allow',
          trailingUnderscore: 'allow',
        },
        {
          selector: 'variable',
          format: ['camelCase', 'UPPER_CASE', 'PascalCase'],
          leadingUnderscore: 'allow',
        },
        {
          selector: 'function',
          format: ['camelCase', 'PascalCase'],
        },
        {
          selector: 'parameter',
          format: ['camelCase'],
          leadingUnderscore: 'allow',
        },
        {
          selector: 'objectLiteralProperty',
          format: ['camelCase', 'UPPER_CASE', 'PascalCase', 'snake_case'],
          leadingUnderscore: 'allow',
        },
        {
          selector: 'objectLiteralProperty',
          modifiers: ['requiresQuotes'],
          format: null,
        },
        {
          selector: 'typeProperty',
          format: ['camelCase', 'UPPER_CASE', 'snake_case'],
          leadingUnderscore: 'allow',
        },
        {
          selector: 'typeProperty',
          modifiers: ['requiresQuotes'],
          format: null,
        },
        { selector: 'import', format: ['camelCase', 'PascalCase'] },
        { selector: 'typeLike', format: ['PascalCase'] },
        { selector: 'enumMember', format: ['PascalCase', 'UPPER_CASE'] },
        { selector: 'typeMethod', modifiers: ['requiresQuotes'], format: null },
        { selector: 'objectLiteralMethod', format: ['camelCase', 'snake_case'] },
      ],

      // React
      'react/jsx-key': ['error', { checkFragmentShorthand: true, warnOnDuplicates: true }],
      'react/jsx-no-leaked-render': 'error',
      'react/jsx-no-target-blank': 'error',
      'react/jsx-pascal-case': 'error',
      'react/no-array-index-key': 'warn',
      'react/no-danger': 'error',
      'react/no-unstable-nested-components': 'error',
      'react/self-closing-comp': 'error',
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'error',
      'react-refresh/only-export-components': 'warn',

      // Code quality
      'sonarjs/cognitive-complexity': ['error', 15],
      'sonarjs/no-duplicate-string': ['error', { threshold: 4 }],
      'sonarjs/no-identical-functions': 'error',
      'sonarjs/no-collapsible-if': 'error',
      'sonarjs/no-redundant-boolean': 'error',
      'sonarjs/no-redundant-jump': 'error',
      'sonarjs/no-small-switch': 'error',
      'sonarjs/no-unused-collection': 'error',
      'sonarjs/no-useless-catch': 'error',
      'sonarjs/prefer-immediate-return': 'error',
      'sonarjs/prefer-single-boolean-return': 'error',

      // File/function size
      'max-lines': ['error', { max: 300, skipBlankLines: true, skipComments: true }],
      'max-lines-per-function': ['error', { max: 75, skipBlankLines: true, skipComments: true }],
      'complexity': ['error', { max: 10 }],
      'max-depth': ['error', 4],
      'max-nested-callbacks': ['error', 3],
      'max-params': ['error', 4],

      // Security — detect-object-injection is too noisy in TS-typed code
      'security/detect-object-injection': 'off',
      'security/detect-non-literal-regexp': 'error',
      'security/detect-non-literal-fs-filename': 'error',
      'security/detect-unsafe-regex': 'error',
      'security/detect-buffer-noassert': 'error',
      'security/detect-child-process': 'error',
      'security/detect-eval-with-expression': 'error',
      'security/detect-no-csrf-before-method-override': 'error',
      'security/detect-possible-timing-attacks': 'off',
      'security/detect-pseudoRandomBytes': 'error',

      // Unicorn
      'unicorn/prevent-abbreviations': 'off',
      'unicorn/no-null': 'off',
      'unicorn/filename-case': ['error', { cases: { kebabCase: true, pascalCase: true } }],
      'unicorn/no-array-for-each': 'off',
      'unicorn/prefer-top-level-await': 'off',

      // Imports
      'import-x/no-cycle': ['error', { maxDepth: 10 }],
      'import-x/no-self-import': 'error',
      'import-x/no-useless-path-segments': 'error',
      'import-x/no-duplicates': 'error',
      'import-x/no-unresolved': 'error',
      'import-x/order': [
        'error',
        {
          'groups': ['builtin', 'external', 'internal', 'parent', 'sibling', 'index', 'type'],
          'newlines-between': 'always',
          'alphabetize': { order: 'asc', caseInsensitive: true },
        },
      ],
      'import-x/no-default-export': 'error',

      // Promise correctness
      'promise/no-return-wrap': 'error',
      'promise/param-names': 'error',
      'promise/catch-or-return': 'error',
      'promise/no-nesting': 'warn',

      // Node
      'n/no-deprecated-api': 'error',
      'n/no-process-exit': 'error',
      'n/no-sync': ['error', { allowAtRootLevel: true }],
      'n/prefer-promises/fs': 'error',
      'n/prefer-promises/dns': 'error',

      // JSDoc/TSDoc
      'jsdoc/require-jsdoc': [
        'error',
        {
          publicOnly: { esm: true, window: true },
          require: {
            FunctionDeclaration: true,
            MethodDefinition: true,
            ClassDeclaration: true,
          },
          contexts: ['TSInterfaceDeclaration', 'TSTypeAliasDeclaration', 'TSEnumDeclaration'],
          checkConstructors: false,
        },
      ],
      'jsdoc/require-description': 'error',
      'jsdoc/require-param-description': 'error',
      'jsdoc/require-returns-description': 'error',
      'jsdoc/no-undefined-types': 'off',
      'jsdoc/check-tag-names': [
        'error',
        { definedTags: ['remarks', 'public', 'internal', 'beta'] },
      ],

      // Secrets
      'no-secrets/no-secrets': [
        'error',
        { tolerance: 4.5, ignoreContent: ['https?://', 'data:image/'] },
      ],
    },
  },

  // Framework-specific overrides for default exports
  {
    files: ['**/pages/**/*.{ts,tsx}', '**/routes/**/*.{ts,tsx}', '**/*.stories.tsx'],
    rules: { 'import-x/no-default-export': 'off' },
  },

  // Config + migration files: disable all type-checked rules (outside tsconfig project)
  {
    files: [
      '**/*.config.{ts,js,mjs,cjs}',
      '**/*.cjs',
      'eslint.config.js',
      'commitlint.config.js',
      'vite.config.*',
      'vitest.config.*',
      'playwright.config.*',
      '**/db/migrations/**',
      '**/db/seeders/**',
      '**/db/config.cjs',
      '**/api/scripts/**',
    ],
    extends: [tseslint.configs.disableTypeChecked],
    languageOptions: {
      globals: { ...globals.node, ...globals.commonjs },
      parserOptions: {
        projectService: false,
        project: null,
      },
    },
    rules: {
      'import-x/no-default-export': 'off',
      'jsdoc/require-jsdoc': 'off',
      'unicorn/filename-case': 'off',
      '@typescript-eslint/naming-convention': 'off',
      '@typescript-eslint/no-require-imports': 'off',
      'n/no-unpublished-require': 'off',
      'max-lines': 'off',
    },
  },

  // Factory functions (services + routes + io namespaces) — aggregators that
  // return objects with many methods; the 75-line cap and
  // explicit-module-boundary-types don't fit the pattern. Callers use
  // `ReturnType<typeof createXxx>`.
  {
    files: [
      '**/api/src/services/**/*.ts',
      '**/api/src/routes/**/*.ts',
      '**/api/src/models/**/*.ts',
      '**/api/src/io/**/*.ts',
      '**/api/src/app.ts',
    ],
    rules: {
      'max-lines-per-function': 'off',
      '@typescript-eslint/explicit-module-boundary-types': 'off',
    },
  },

  // React components — PascalCase function declarations are common, and page
  // components often exceed 75 lines. Callers rely on JSX inference.
  {
    files: ['**/ui/src/**/*.{ts,tsx}', '**/widget/src/**/*.{ts,tsx}'],
    rules: {
      'max-lines-per-function': 'off',
      '@typescript-eslint/explicit-module-boundary-types': 'off',
      // widget-element.tsx exports both a class and a helper — fast-refresh
      // doesn't apply to Web Components anyway.
      'react-refresh/only-export-components': 'off',
    },
  },

  // Socket.IO namespaces: event-name strings are API contracts, not
  // duplication — they appear once per `.on`/`.emit` by design.
  {
    files: ['**/api/src/io/**/*.ts'],
    rules: {
      'sonarjs/no-duplicate-string': 'off',
    },
  },

  // Test files
  {
    files: ['**/*.test.{ts,tsx}', '**/*.spec.{ts,tsx}', '**/test/**', '**/tests/**'],
    rules: {
      'max-lines-per-function': 'off',
      'max-lines': 'off',
      'complexity': 'off',
      'sonarjs/no-duplicate-string': 'off',
      'sonarjs/cognitive-complexity': 'off',
      '@typescript-eslint/no-non-null-assertion': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-argument': 'off',
      '@typescript-eslint/no-unsafe-return': 'off',
      '@typescript-eslint/no-unsafe-call': 'off',
      '@typescript-eslint/non-nullable-type-assertion-style': 'off',
      '@typescript-eslint/dot-notation': 'off',
      '@typescript-eslint/naming-convention': 'off',
      '@typescript-eslint/explicit-module-boundary-types': 'off',
      '@typescript-eslint/unbound-method': 'off',
      'jsdoc/require-jsdoc': 'off',
      'unicorn/filename-case': 'off',
    },
  },

  prettier,
);
