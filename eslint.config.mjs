import js from '@eslint/js';
import globals from "globals";

export default [
  {
    ignores: [
      '_resources/*',
      'static/*',
      'node_modules/*',
    ],
  },
  js.configs.recommended,
  {
    files: [
      'src/**/*.mjs',
      '_index.mjs',
      'scripts/**/*.mjs',
      'eslint.config.mjs'
    ],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: {
        ...globals.node,
      }
    },
    rules: {
      'no-console': 0,
      'max-len': 0,
      'no-continue': 0,
      'no-bitwise': 0,
      'no-mixed-operators': 0,
      'no-underscore-dangle': 0,
      'import/prefer-default-export': 0,
      'class-methods-use-this': 0,
      'no-plusplus': 0,
      'global-require': 0
    },
  },
];
