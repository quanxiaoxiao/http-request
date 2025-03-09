import js from '@eslint/js';
import simpleImportSort from 'eslint-plugin-simple-import-sort';
import globals from 'globals';

export default [
  {
    ignores: [
      'node_modules/*',
    ],
  },
  js.configs.recommended,
  {
    plugins: {
      'simple-import-sort': simpleImportSort,
    },
    files: [
      'src/**/*.mjs',
      '_index.mjs',
      'scripts/**/*.mjs',
      'eslint.config.mjs',
    ],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: {
        ...globals.node,
      },
    },
    rules: {
      'simple-import-sort/imports': 'error',
      'simple-import-sort/exports': 'error',
      'no-duplicate-imports': 2,
      'array-callback-return': 2,
      'prefer-const': 2,
      'no-multi-spaces': 2,
      eqeqeq: ['error', 'always', { null: 'ignore' }],
      'block-scoped-var': 2,
      'consistent-return': 2,
      'default-case': 2,
      'no-shadow': 2,
      'object-shorthand': 2,
      'quote-props': ['error', 'as-needed'],
      quotes: [
        'error',
        'single',
      ],
      'object-curly-newline': 2,
      'no-multi-assign': 2,
      'no-else-return': 2,
      indent: [
        'error',
        2,
      ],
      'keyword-spacing': 2,
      'no-multiple-empty-lines': ['error', { max: 1, maxEOF: 0 }],
      'space-infix-ops': 2,
      'eol-last': 2,
      'space-in-parens': 2,
      'array-bracket-spacing': 2,
      'object-curly-spacing': ['error', 'always'],
      'block-spacing': 2,
      'key-spacing': 2,
      'no-trailing-spaces': 2,
      'comma-style': 2,
      'no-use-before-define': 2,
      'comma-dangle': [
        'error',
        {
          arrays: 'always-multiline',
          objects: 'always-multiline',
          imports: 'always-multiline',
          exports: 'always-multiline',
          functions: 'always-multiline',
        },
      ],
      semi: 2,
      'no-console': 0,
      'max-len': 0,
      'no-continue': 0,
      'no-bitwise': 0,
      'no-mixed-operators': 0,
      'no-underscore-dangle': 0,
      'import/prefer-default-export': 0,
      'class-methods-use-this': 0,
      'no-plusplus': 0,
      'global-require': 0,
    },
  },
];
